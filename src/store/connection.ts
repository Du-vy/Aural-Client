/**
 * One server connection: the socket, and everything this client knows about
 * the server on the other end of it.
 *
 * This is a store per connection rather than a slice of one global store,
 * because the client holds several at once and only one of them is on screen.
 * `servers.ts` owns the set and decides which that is; nothing here reaches
 * back to it except through the small `ConnectionHost` it is handed, which is
 * what keeps the two files from importing each other.
 *
 * State is driven almost entirely by server events. An action sends its request
 * and then does nothing with the reply, because the server broadcasts the
 * resulting change back to everyone, the caller included. That keeps one code
 * path for "something changed" instead of two that can disagree.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import { parseAddress, type ServerAddress } from "@/lib/address";
import { Gateway, closeMessage, type CloseInfo } from "@/lib/gateway";
import { t } from "@/lib/i18n";
import { mentionReach, mentionsSelf, repliesToSelf, type MentionReach } from "@/lib/mentions";
import { shouldNotifyHere } from "@/lib/muting";
import { announce } from "@/lib/notifications";
import {
  AuralError,
  Ev,
  Op,
  describeError,
  isPostChannel,
  protocolFit,
  type Activity,
  type Attachment,
  type Channel,
  type ChannelDeletedEvent,
  type AuditEntry,
  type AuditListResult,
  type AutoModConfig,
  type Ban,
  type BanCreateRequest,
  type ChannelEvent,
  type ChannelType,
  type ChannelUpdateRequest,
  type Conversation,
  type DirectMessage,
  type DMCreatedEvent,
  type DMDeletedEvent,
  type DMHistoryResult,
  type DMListResult,
  type DMPrivacy,
  type DMUpdatedEvent,
  type Expression,
  type ExpressionKind,
  type ICEServer,
  type Message,
  type MessageBase,
  type MessageDeletedEvent,
  type MessageEvent,
  type MessageHistoryResult,
  type MessageSearchHit,
  type MessageSearchResult,
  type Post,
  type PostCreateRequest,
  type PostDeletedEvent,
  type PostEvent,
  type PostListResult,
  type PostRSVPEvent,
  type PostUpdateRequest,
  type Ready,
  type RelayDirection,
  type RelayState,
  type Role,
  type RoleDeletedEvent,
  type RoleEvent,
  type SearchSort,
  type ServerInfo,
  type ServerMetricsResponse,
  type ServerUpdatedEvent,
  type Sound,
  type SoundPlayedEvent,
  type User,
  type UserDisconnectedEvent,
  type UserEvent,
  type UserMovedEvent,
  type UserRemovedEvent,
  type VoiceConfig,
  type VoiceSettings,
  type VoiceSpeakingEvent,
  type VoiceState,
  type VoiceStateEvent,
  type Webhook,
  type WebhookEvent,
  type WebhookListResult,
} from "@/lib/protocol";
import {
  clearToken,
  getServer,
  upsertServer,
  type SavedServer,
} from "@/lib/storage";
import {
  buildDirectory,
  buildSearchRequest,
  parseSearchInput,
  type SearchToken,
} from "@/lib/search";
import { useVoice } from "./voice";
import {
  uploadFile,
  uploadAvatar as uploadAvatarRequest,
  uploadBanner as uploadBannerRequest,
  uploadServerIcon as uploadServerIconRequest,
  uploadExpression as uploadExpressionRequest,
  uploadSound as uploadSoundRequest,
  serverOrigin,
  type RunningUpload,
} from "@/lib/uploads";
import { deviceIdentifier } from "@/lib/device";
import { forgetSoundCache, playSoundClip, stopAllSounds } from "@/lib/soundboard";
import { playVoiceSound } from "@/lib/voiceSounds";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting";

/**
 * What this client holds for one text channel. History is fetched on demand
 * and paged backwards, so a channel that has never been opened has no entry
 * at all rather than an empty one.
 */
export interface ChannelHistory {
  /** The window held, oldest first, never longer than `CHANNEL_WINDOW`. */
  messages: Message[];
  /** Whether older messages remain before the oldest one held. */
  hasMore: boolean;
  /**
   * Whether newer messages remain past the newest one held, which is true only
   * after jumping into the middle of a channel. While it is set the client is
   * looking at a window rather than at the present, so arriving messages are
   * left for the walk back rather than appended after a gap.
   */
  hasMoreAfter: boolean;
  loading: boolean;
  /** Set when a history request failed, so the view can offer a retry. */
  error: string | null;
}

export const EMPTY_HISTORY: ChannelHistory = {
  messages: [],
  hasMore: false,
  hasMoreAfter: false,
  loading: false,
  error: null,
};

/**
 * What this client holds for one private conversation.
 *
 * It is the channel shape with the channel taken out, and it is held under the
 * other person's id rather than the thread's: a name in the member list is
 * what somebody starts a conversation from, and the thread may not exist yet.
 */
export interface DirectHistory {
  messages: DirectMessage[];
  hasMore: boolean;
  hasMoreAfter: boolean;
  loading: boolean;
  error: string | null;
}

export const EMPTY_DIRECT_HISTORY: DirectHistory = {
  messages: [],
  hasMore: false,
  hasMoreAfter: false,
  loading: false,
  error: null,
};

/**
 * How many messages one channel keeps.
 *
 * Without a bound the two ordinary ways of using a chat client both grow the
 * array forever: reading backwards through a busy channel, and leaving a busy
 * one open. Every message held is also a row rendered, so the cost is paid
 * twice. Four pages is wide enough that neither end is ever one scroll from
 * the other, which is what stops a reader bouncing between them.
 */
export const CHANNEL_WINDOW = 200;

/**
 * Takes one message out of a window, and marks every reply that pointed at it.
 *
 * A reply outlives what it answered, and the reference on it is what says so.
 * Left alone it would go on naming a message that is no longer there — the
 * server already renders the reference as deleted, but only to whoever reads
 * the window again, which is nobody who was already looking at it.
 */
function withoutMessage<T extends MessageBase>(messages: readonly T[], messageId: number): T[] {
  return messages
    .filter((held) => held.id !== messageId)
    .map((held) =>
      held.replyTo?.id === messageId
        ? { ...held, replyTo: { id: messageId, author: "", content: "", deleted: true } }
        : held,
    );
}

/**
 * How much of a channel survives being left.
 *
 * A channel stops being read the moment another one is opened, and what makes
 * coming back to it feel instant is the page under the composer, not the four
 * pages above it. Cutting the rest is the difference between a client holding
 * one full window and one holding a full window per channel ever looked at.
 */
export const IDLE_CHANNEL_WINDOW = 50;

/**
 * How often one channel's read marker is sent while it is being read.
 *
 * Sitting in a busy channel reads a message a second, and each one moves the
 * marker; sending that is one round trip per message to say the same thing.
 * The interval is what a burst collapses into. It is short enough that closing
 * the client a moment after reading loses nothing worth a badge, and long
 * enough that a lively channel costs one request rather than fifty.
 */
const READ_MARKER_INTERVAL_MS = 3_000;

/**
 * How many channels of one connection keep any messages at all.
 *
 * The window bounds one channel; this bounds how many there are. An entry is
 * created the first time a channel is opened and, without this, dropped only
 * when the channel is deleted, when it stops being visible, or when the
 * connection ends — so somebody who walks through fifty channels holds fifty
 * windows and is reading one of them. The cut falls on whichever were read
 * longest ago, and never on the one on screen.
 */
export const OPEN_CHANNEL_LIMIT = 8;

/** How many results one page of the search panel holds. */
export const SEARCH_PAGE_SIZE = 25;

/**
 * The one search this client is showing. It lives here rather than in the
 * search box because the results panel, the box and a jump into a channel are
 * three views of the same thing.
 */
export interface SearchState {
  /** Whether the results panel is showing. */
  open: boolean;
  /** The line as typed, which is what the box renders. */
  input: string;
  /**
   * The line the held results came from. It is kept apart from `input` so the
   * box can be edited without the results underneath it changing to match a
   * query that has not been run.
   */
  ran: string;
  sort: SearchSort;
  offset: number;
  /**
   * Bumped every time the box is asked for, which is how a keyboard shortcut
   * reaches an input the shortcut's own component does not own.
   */
  focus: number;
  hits: MessageSearchHit[];
  total: number;
  /** Filters naming something this client could not resolve. */
  unresolved: SearchToken[];
  loading: boolean;
  error: string | null;
}

export const EMPTY_SEARCH: SearchState = {
  open: false,
  input: "",
  ran: "",
  sort: "newest",
  offset: 0,
  focus: 0,
  hits: [],
  total: 0,
  unresolved: [],
  loading: false,
  error: null,
};

/**
 * Where the reader has asked to be taken. The nonce is what makes jumping to
 * the same message twice move the view twice, rather than looking to the
 * interface like nothing changed.
 */
export interface JumpTarget {
  channelId: number;
  messageId: number;
  nonce: number;
}

/**
 * The same, for a private conversation, which is addressed by the other person
 * rather than by a channel id. The two are kept apart because a client can be
 * reading a channel and a conversation at once, and one jump must not move the
 * other list.
 */
export interface DirectJumpTarget {
  userId: number;
  messageId: number;
  nonce: number;
}

/**
 * What a channel has waiting in it.
 *
 * This is all a connection in the background holds about its messages, and it
 * is why holding one is worth anything: a badge is a number and a flag, where
 * the messages behind it are a request away and stale by the time somebody
 * looks at them.
 */
export interface Unread {
  count: number;
  /** Whether any of them named this user. */
  mention: boolean;
}

export interface ConnectOptions {
  /**
   * Only for the first dial. A reconnect re-uses the address the connection
   * was made for, because that address is what the connection is.
   */
  address?: string;
  nickname?: string;
  serverPassword?: string;
  credentials?: { username: string; password: string };
  /** Ignore any stored token and take a fresh guest identity. */
  asNewGuest?: boolean;
}

/**
 * What one connection needs from whoever is holding it.
 *
 * Everything here is a question about the other connections — am I the one on
 * screen, may I take the microphone — which is precisely what a connection
 * cannot answer for itself.
 */
export interface ConnectionHost {
  /** Whether this connection is the one being rendered. */
  foreground(): boolean;
  /** Whether this connection holds the one media session. */
  ownsVoice(): boolean;
  /** Whether some other connection is in a call right now. */
  callElsewhere(): boolean;
  /**
   * Takes the media session. Whoever held it is left first, because there is
   * one microphone: being in two calls is not something to be arranged.
   */
  takeVoice(): void;
  /** Gives the media session up, if this connection had it. */
  dropVoice(): void;
  /** The bookmarks changed, because this connection wrote to them. */
  savedChanged(saved: SavedServer[]): void;
  /** This connection ended and holds nothing. */
  ended(message: string, wasConnected: boolean): void;
  /**
   * Brings this connection to the front, on the given side of the client.
   *
   * Only ever called from a notification somebody clicked, which is the one
   * place a message can move the whole client to where it was sent.
   */
  reveal(section: "server" | "dms"): void;
}

export interface ConnectionState {
  status: ConnectionStatus;
  /** Why the last connection attempt failed, for the connect screen. */
  error: string | null;
  /** Transient message about the live connection, such as a kick reason. */
  notice: string | null;

  /** `host:port`: what a bookmark, a volume and a rail entry are all keyed by. */
  serverId: string;
  address: ServerAddress | null;
  gateway: Gateway | null;
  /**
   * The session token this connection is running on.
   *
   * It is held here as well as in storage because the HTTP endpoints
   * authenticate with it, and storage is not always there to read it back
   * from: a private window, cleared site data, or a browser set to refuse it
   * all leave the bookmark unwritten while the connection itself is fine.
   */
  token: string | null;

  server: ServerInfo | null;
  self: User | null;
  users: Map<number, User>;
  channels: Map<number, Channel>;
  roles: Map<number, Role>;
  /**
   * Per text channel, keyed by channel id. Absent until first opened, dropped
   * when the channel falls out of the least-recently-read window, and empty
   * throughout for a connection in the background.
   */
  history: Map<number, ChannelHistory>;
  /** Posts for announcement, calendar, forum, and media channels, keyed by channel id. */
  posts: Map<number, { posts: Post[]; hasMore: boolean; loading: boolean; error: string | null }>;
  /** Comments for open post threads, keyed by post id. */
  postComments: Map<number, { messages: Message[]; hasMore: boolean; loading: boolean; error: string | null }>;
  /** What is waiting, per channel. Held whether or not the messages are. */
  unread: Map<number, Unread>;
  /** The channel being read on this connection, or null. */
  activeChannelId: number | null;

  /**
   * Every private conversation on this server, keyed by the other person.
   *
   * Held whether or not the messages in it are: this is what a badge is drawn
   * from, and it is the whole of what a connection in the background keeps
   * about its private threads. An entry with a zero `id` is one this client
   * opened and nobody has written in yet, which the server has never heard of.
   */
  conversations: Map<number, Conversation>;
  /**
   * The lines of each conversation, keyed the same way. Absent until first
   * opened, and empty throughout for a connection in the background.
   */
  directHistory: Map<number, DirectHistory>;
  /** The conversation being read on this connection, or null. */
  activeConversationId: number | null;

  /**
   * Everybody's voice state on this server, across every channel this client
   * can see. It is per connection rather than in the voice store because user
   * ids are per server: one map for all of them would draw the mute icon of
   * whoever happened to share an id somewhere else.
   */
  /**
   * Every custom emoji and sticker this server carries, by id. It arrives with
   * the snapshot rather than being fetched, because a message cannot be
   * rendered without it.
   */
  expressions: Map<number, Expression>;
  /** The soundboard, by id, in the order the panel draws it. */
  sounds: Map<number, Sound>;
  /**
   * The ban list, fetched by the settings screen and kept in step by events.
   * Null until it has been asked for: an empty list and a list nobody has
   * loaded are different things to a screen that has to say which.
   */
  bans: Ban[] | null;
  /** One page of the audit log, oldest-last, with whether more remain. */
  audit: { entries: AuditEntry[]; hasMore: boolean; loading: boolean; error: string | null };
  /** The automatic moderation rules, or null until they have been fetched. */
  automod: AutoModConfig | null;
  /**
   * The Discord relay, or null until it has been asked for.
   *
   * It only ever arrives for somebody who may manage the server — it names
   * webhook URLs, which are credentials — so on everybody else's client this
   * stays null for the whole session.
   */
  relay: RelayState | null;

  voiceStates: Map<number, VoiceState>;
  /** Who is transmitting on this server right now. */
  speaking: Set<number>;

  search: SearchState;
  /** The message the view should move to, set by a jump and cleared by it. */
  jump: JumpTarget | null;
  /** The same, for the conversation being read. */
  directJump: DirectJumpTarget | null;

  connect(options?: ConnectOptions): Promise<void>;
  disconnect(): void;
  dismissNotice(): void;

  /** This connection came to the front, or went behind another one. */
  enterForeground(): void;
  enterBackground(): void;

  joinChannel(channelId: number): Promise<void>;
  leaveChannel(): Promise<void>;
  moveUser(userId: number, channelId: number | null): Promise<void>;
  setNickname(nickname: string, userId?: number): Promise<void>;
  setStatus(status: "online" | "idle" | "dnd" | "invisible"): Promise<void>;
  /**
   * Reports what this machine says its owner is doing outside Aural, or `null`
   * to clear it.
   *
   * Nothing is set locally: the server answers with the view it broadcast, and
   * the `user.updated` that carries it is what puts it on screen, exactly as
   * for everybody else's. Rejections are the caller's to swallow — this is
   * driven by a watcher on a timer, not by a person who could be told.
   */
  reportActivity(activity: Activity | null): Promise<void>;
  updateProfile(patch: {
    nickname?: string;
    status?: string;
    customStatus?: string;
    avatar?: string | null;
    banner?: string | null;
    dmPrivacy?: DMPrivacy;
    userId?: number;
  }): Promise<void>;
  /** Sets who may write to you privately. Your own setting, never anybody's else. */
  setDMPrivacy(privacy: DMPrivacy): Promise<void>;
  uploadAvatar(file: File, onProgress?: (fraction: number) => void): Promise<{ url: string }>;
  uploadBanner(file: File, onProgress?: (fraction: number) => void): Promise<{ url: string }>;
  /**
   * Replaces this server's picture. Needs ManageServer; the new one reaches
   * every client as a `ServerUpdated` event, this one included, so nothing is
   * set locally from the reply.
   */
  uploadServerIcon(file: File, onProgress?: (fraction: number) => void): Promise<{ url: string }>;
  kickUser(userId: number, reason?: string, deleteMessages?: "none" | "1d" | "7d" | "30d" | "all"): Promise<void>;

  /** Bans a member, and by default the address and machine behind them. */
  banUser(input: BanCreateRequest): Promise<void>;
  /** Loads the ban list into `bans`. */
  listBans(): Promise<void>;
  /** Lifts one ban. */
  deleteBan(banId: number): Promise<void>;

  /**
   * Loads a page of the audit log. Without `before` it replaces what is held;
   * with it, the page is appended, which is what scrolling asks for.
   */
  loadAudit(options?: { before?: number; actorId?: number; action?: string }): Promise<void>;

  /** Fetches the automatic moderation rules into `automod`. */
  loadAutoMod(): Promise<void>;
  /** Replaces the whole rule set. */
  updateAutoMod(config: AutoModConfig): Promise<void>;

  /** Fetches the whole relay state into `relay`. */
  loadRelay(): Promise<void>;
  /**
   * Switches the relay on or off, and sets the bot token when one is given.
   * Omitting the token keeps the one already stored, which is what lets this
   * screen toggle the relay without ever holding a credential.
   */
  configureRelay(enabled: boolean, botToken?: string): Promise<void>;
  createRelayLink(request: {
    channelId: number;
    webhookUrl: string;
    discordChannelId?: string;
    direction: RelayDirection;
    attachments: boolean;
    edits: boolean;
  }): Promise<void>;
  updateRelayLink(request: {
    id: number;
    channelId?: number;
    webhookUrl?: string;
    direction?: RelayDirection;
    enabled?: boolean;
    attachments?: boolean;
    edits?: boolean;
  }): Promise<void>;
  deleteRelayLink(id: number): Promise<void>;

  /** Uploads a custom emoji or sticker. */
  uploadExpression(
    kind: ExpressionKind,
    name: string,
    file: File,
    onProgress?: (fraction: number) => void,
  ): Promise<Expression>;
  renameExpression(expressionId: number, name: string): Promise<void>;
  deleteExpression(expressionId: number): Promise<void>;

  /** Uploads a soundboard clip. The file has already been cut to WAV. */
  uploadSound(
    name: string,
    emoji: string,
    file: File,
    onProgress?: (fraction: number) => void,
  ): Promise<Sound>;
  updateSound(input: { soundId: number; name?: string; emoji?: string; volume?: number }): Promise<void>;
  deleteSound(soundId: number): Promise<void>;
  /** Plays a clip at the voice channel this identity is sitting in. */
  playSound(soundId: number): Promise<void>;

  register(username: string, password: string): Promise<void>;
  signIn(username: string, password: string): Promise<void>;
  claimAdmin(token: string): Promise<void>;
  updateServer(patch: {
    name?: string;
    description?: string;
    /** Only ever `""`, which takes the server's picture away. */
    icon?: string;
    klipyApiKey?: string;
    /** The audio plane, replaced whole. See `VoiceSettings`. */
    voice?: VoiceSettings;
  }): Promise<void>;
  fetchServerMetrics(force?: boolean): Promise<ServerMetricsResponse>;

  createChannel(input: {
    name: string;
    type: ChannelType;
    parentId?: number | null;
    userLimit?: number;
  }): Promise<void>;
  updateChannel(input: ChannelUpdateRequest): Promise<void>;
  deleteChannel(channelId: number): Promise<void>;

  /** Loads the newest page of a channel, or does nothing if already held. */
  openChannel(channelId: number): Promise<void>;
  /** Loads the page before the oldest message held. */
  loadOlder(channelId: number): Promise<void>;
  /** Loads the page after the newest message held, walking back to the present. */
  loadNewer(channelId: number): Promise<void>;
  /** Drops the window being held and returns to the newest page. */
  returnToPresent(channelId: number): Promise<void>;
  /**
   * Names the channel being read, which is what decides where an arriving
   * message counts as unread, which channel keeps its full window, and what
   * the least-recently-read cut is allowed to take.
   */
  setActiveChannel(channelId: number | null): void;
  /** Clears the badge of one channel. */
  markRead(channelId: number): void;
  /**
   * Moves the view to one message, loading the page around it when it is not
   * already held. The channel it lives in is selected by the view watching
   * `jump`, so this works from anywhere.
   */
  jumpToMessage(channelId: number, messageId: number): Promise<void>;
  /** Clears a jump once the view has moved to it. */
  clearJump(nonce: number): void;

  openSearch(prefill?: string): void;
  closeSearch(): void;
  setSearchInput(input: string): void;
  /**
   * Runs the search. With no argument it re-runs what the box holds from the
   * first page; the sort and offset are how the panel re-reads the same query.
   */
  runSearch(options?: { input?: string; sort?: SearchSort; offset?: number }): Promise<void>;
  /** Posts a message, optionally carrying files already uploaded. */
  sendMessage(
    channelId: number,
    content: string,
    attachments?: number[],
    replyToId?: number,
  ): Promise<void>;
  /**
   * Sends one file to a channel and resolves with the attachment it became.
   * The returned handle can cancel an upload still in flight.
   */
  uploadAttachment(
    channelId: number,
    file: File,
    onProgress?: (fraction: number) => void,
  ): RunningUpload;
  editMessage(messageId: number, content: string): Promise<void>;
  deleteMessage(messageId: number): Promise<void>;

  /** Opens an announcement, calendar, forum, or media channel and loads its posts. */
  openPostChannel(channelId: number, options?: { from?: number; to?: number }): Promise<void>;
  loadOlderPosts(channelId: number): Promise<void>;
  createPost(input: PostCreateRequest): Promise<Post>;
  updatePost(input: PostUpdateRequest): Promise<void>;
  deletePost(postId: number): Promise<void>;
  rsvpPost(postId: number, response: string): Promise<void>;
  openPostComments(channelId: number, postId: number): Promise<void>;
  loadOlderPostComments(channelId: number, postId: number): Promise<void>;
  sendPostComment(
    channelId: number,
    postId: number,
    content: string,
    attachments?: number[],
    replyToId?: number,
  ): Promise<void>;

  /**
   * Opens the conversation with somebody: loads its newest page, and puts it
   * in the list even when nothing has been said in it yet.
   */
  openConversation(userId: number): Promise<void>;
  /** Loads the page before the oldest line held. */
  loadOlderDirect(userId: number): Promise<void>;
  /** Loads the page after the newest line held, walking a jumped-into window
   * forwards. Does nothing while the window already ends at the present. */
  loadNewerDirect(userId: number): Promise<void>;
  /** Drops a jumped-into window and reads the newest page again. */
  returnToPresentDirect(userId: number): Promise<void>;
  /**
   * Moves the conversation to one line, fetching the window around it when it
   * is not among the ones held. It is what a reply preview follows.
   */
  jumpToDirectMessage(userId: number, messageId: number): Promise<void>;
  /** Clears a conversation jump once the view has moved to it. */
  clearDirectJump(nonce: number): void;
  sendDirectMessage(userId: number, content: string, replyToId?: number): Promise<void>;
  editDirectMessage(messageId: number, content: string): Promise<void>;
  deleteDirectMessage(messageId: number): Promise<void>;
  /**
   * Names the conversation being read, which is what decides where an arriving
   * private message does not count as unread.
   */
  setActiveConversation(userId: number | null): void;
  /** Re-reads the whole list, which a client only needs after a long gap. */
  refreshConversations(): Promise<void>;
  /** Drops one conversation from the held list. */
  closeConversation(userId: number): void;

  /**
   * Webhooks. They are read on demand rather than held in the store: the list
   * carries the token that is the whole of a webhook's authentication, only
   * reaches somebody who may manage it, and is only ever looked at from one
   * settings screen. Keeping it in every connection's state would put a set of
   * live credentials in memory for the whole session to no end.
   */
  listWebhooks(channelId?: number): Promise<Webhook[]>;
  createWebhook(input: { channelId: number; name: string; avatar?: string }): Promise<Webhook>;
  updateWebhook(input: {
    webhookId: number;
    name?: string;
    avatar?: string;
    channelId?: number;
  }): Promise<Webhook>;
  deleteWebhook(webhookId: number): Promise<void>;

  createRole(input: { name: string; color?: string; permissions?: string; hoist?: boolean }): Promise<void>;
  updateRole(input: {
    roleId: number;
    name?: string;
    color?: string;
    permissions?: string;
    hoist?: boolean;
  }): Promise<void>;
  /**
   * Restacks the hierarchy.
   *
   * `roleIds` is the whole stack from the bottom up, without the everyone
   * role, which is beneath everything and is not part of the order. The server
   * takes it as one decision and refuses it as one, so a move that would lift
   * a role to or above the caller's own leaves the stack exactly as it was.
   */
  reorderRoles(roleIds: number[]): Promise<void>;
  deleteRole(roleId: number): Promise<void>;
  setRoleMembership(userId: number, roleId: number, granted: boolean): Promise<void>;
  handleEvent(op: string, payload: unknown): void;
}

export type ConnectionStore = StoreApi<ConnectionState>;

/** How many times an unexpected drop is retried before giving up. */
const MAX_RECONNECT_ATTEMPTS = 8;
/**
 * The backoff ceiling. A server that is coming back — a home machine
 * rebooting, an address that has just rotated — is usually gone for tens of
 * seconds, not for one, so the wait is allowed to grow well past the first
 * retry before the attempts run out.
 */
const RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Whether an authentication failure is one that retrying cannot fix.
 *
 * A full server or an internal error is worth coming back to; a refused
 * credential or a closed door is not, and hammering it would only turn a clear
 * message into eight of them.
 */
function isPermanentAuthFailure(error: unknown): boolean {
  if (!(error instanceof AuralError)) return false;
  switch (error.code) {
    case "invalid_credentials":
    case "guests_disabled":
    case "registration_closed":
    case "unauthorized":
    case "forbidden":
    // Retrying a ban is not a reconnection, it is a knock on a door that has
    // been shut. The reason travels with the error, so the connect screen has
    // something to say rather than counting down to another refusal.
    case "banned":
      return true;
    default:
      return false;
  }
}

function indexById<T extends { id: number }>(items: T[]): Map<number, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * The shape a member takes once their connection ends.
 *
 * It is the entry the server sends for somebody who was already away, rebuilt
 * from the copy the client is holding: a departure carries an id and nothing
 * else, and the member has to stay in the list either way. Clearing the channel
 * and the custom status is what makes the two entries the same, which is what
 * leaves an invisible member indistinguishable from an absent one.
 */
function asOffline(user: User): User {
  return {
    ...user,
    online: false,
    status: "offline",
    customStatus: "",
    // An activity belongs to the connection that reported it. The server drops
    // it from every offline entry it sends; this is the same rule applied to
    // the entry this client keeps when a connection simply ends.
    activity: null,
    channelId: null,
  };
}

/**
 * Combines two runs of messages into one ordered, duplicate-free list.
 *
 * A fetched page and the live event stream overlap whenever a message arrives
 * while a request is in flight, and ids are monotonic, so sorting by id both
 * orders the result and makes the overlap easy to drop.
 */
function mergeMessages<T extends { id: number }>(...runs: T[][]): T[] {
  const byId = new Map<number, T>();
  for (const run of runs) {
    for (const message of run) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * Cuts a run of messages down to a window, dropping from whichever end the
 * reader is furthest from: `keep` names the end to hold on to.
 *
 * A trim raises the flag for the end it cut, because downstream a message let
 * go and a message never fetched are the same thing — there is more that way,
 * and reaching it costs a request. That the flags are the patch rather than
 * something set beside it is deliberate: spreading the result last is what
 * makes a trim override the page's own account of where the channel ends,
 * which after a cut is no longer the client's.
 */
export function clampWindow<T extends { id: number }>(
  messages: T[],
  keep: "newest" | "oldest",
  limit: number = CHANNEL_WINDOW,
): { messages: T[]; hasMore?: boolean; hasMoreAfter?: boolean } {
  if (messages.length <= limit) return { messages };
  return keep === "newest"
    ? { messages: messages.slice(-limit), hasMore: true }
    : { messages: messages.slice(0, limit), hasMoreAfter: true };
}

/**
 * Whether a message names this user.
 *
 * Kept as an export here because this is where it has always been read from,
 * but the rule itself belongs with the rest of what a mention is, in
 * `lib/mentions`.
 */
export { mentionsSelf };

/** Whether nobody is looking at this window, so nothing in it counts as read. */
function windowHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export interface ConnectionOptions {
  /** `host:port`, decided by whoever created this connection. */
  id: string;
  /** Exactly what was typed, which is what a reconnect re-dials. */
  address: string;
  host: ConnectionHost;
}

/**
 * Builds one connection.
 *
 * Everything that used to live in module scope — the backoff, the epoch
 * counter, the channel to walk back into — lives in this closure instead. Two
 * connections sharing one retry timer and one epoch counter is the kind of
 * fault that looks like a server problem, so there is one of each per
 * connection and no way to reach the wrong one.
 */
export function createConnection({
  id,
  address: rawAddress,
  host,
}: ConnectionOptions): ConnectionStore {
  return createStore<ConnectionState>((set, get) => {
    /** The address this connection dials, as typed. Signing in never changes it. */
    let dialAddress = rawAddress;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let lastOptions: ConnectOptions | null = null;
    /**
     * The channel to re-enter once a dropped connection comes back.
     *
     * Channel membership is not persisted by the server — a user is in a
     * channel for as long as their connection lasts — so a reconnected session
     * arrives sitting nowhere. Remembering it here is what makes a dropped call
     * resume instead of quietly ending.
     */
    let resumeChannelId: number | null = null;
    /** Guards against a stale socket writing over a newer connection's state. */
    let connectionEpoch = 0;
    /**
     * The connection a retry has already been programmed for.
     *
     * One lost connection can report itself twice — the socket closes, and the
     * request that was in flight on it then rejects — and both reports are
     * honest. Counting the attempt once per connection is what keeps a single
     * drop from spending two of them.
     */
    let scheduledEpoch = 0;
    /** Distinguishes one jump from the next, including a repeat of the same one. */
    let jumpNonce = 1;
    /** When each held channel was last read, which is what the LRU cut sorts on. */
    const readAt = new Map<number, number>();
    /**
     * The read markers owed to the server: when each channel's was last sent,
     * which ones are waiting, and the timer that will send them.
     */
    const readSentAt = new Map<number, number>();
    const readDue = new Set<number>();
    let readTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * What the media session would need, kept from the last snapshot so that
     * taking the microphone is one call rather than another handshake.
     */
    let voiceConfig: VoiceConfig | undefined;
    let iceServers: ICEServer[] = [];

    /**
     * Clears a pending retry without forgetting how many have been made.
     *
     * This is what a reconnect attempt itself uses. Forgetting the count here
     * is what would flatten the backoff to its first step and put the attempt
     * ceiling out of reach, since every retry runs through connect().
     */
    function clearReconnectTimer(): void {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    /** Ends the backoff: no retry pending, and the next drop starts over. */
    function cancelReconnect(): void {
      clearReconnectTimer();
      reconnectAttempt = 0;
      scheduledEpoch = 0;
    }

    /** The gateway of a live connection, or a thrown error explaining why not. */
    function requireGateway(): Gateway {
      const { gateway } = get();
      if (!gateway || !gateway.isOpen) {
        throw new Error("Not connected.");
      }
      return gateway;
    }

    /** Marks somebody as speaking on this server, or not. */
    function markSpeaking(userId: number, speaking: boolean): void {
      const current = get().speaking;
      if (current.has(userId) === speaking) return;
      const next = new Set(current);
      if (speaking) next.add(userId);
      else next.delete(userId);
      set({ speaking: next });
    }

    /** Hands the one media session this connection's socket to talk over. */
    function attachVoice(): void {
      const self = get().self;
      if (!self) return;
      useVoice.getState().attach(
        {
          selfId: self.id,
          serverId: id,
          request: (op, payload) => requireGateway().request(op, payload),
          onSelfSpeaking: (speaking) => markSpeaking(self.id, speaking),
        },
        voiceConfig,
        iceServers,
        get().voiceStates.get(self.id) ?? null,
      );
    }

    /**
     * Opens audio in a channel of this server, taking the microphone from
     * whichever connection had it.
     *
     * Whether that is a reasonable thing to do to somebody who is mid-call is a
     * question for the interface, which asks before it ever gets here.
     */
    function enterVoice(channelId: number): void {
      host.takeVoice();
      attachVoice();
      useVoice.getState().enter(channelId);
    }

    /** Closes audio, if this connection was the one carrying it. */
    function exitVoice(): void {
      if (!host.ownsVoice()) return;
      if (useVoice.getState().channelId !== null) {
        void playVoiceSound("leave");
      }
      useVoice.getState().exit();
      host.dropVoice();
    }

    /** Tears the media session down entirely, because the socket under it went. */
    function abandonVoice(): void {
      if (!host.ownsVoice()) return;
      if (useVoice.getState().channelId !== null) {
        void playVoiceSound("leave");
      }
      useVoice.getState().detach();
      host.dropVoice();
    }

    /** Somebody is no longer in a voice channel of this server. */
    function participantGone(userId: number): void {
      if (host.ownsVoice()) useVoice.getState().participantGone(userId);
      const voiceStates = new Map(get().voiceStates);
      voiceStates.delete(userId);
      set({ voiceStates });
      markSpeaking(userId, false);
    }

    /**
     * The server's picture as an absolute URL, for the saved entry. The rail
     * draws that entry before there is a connection to resolve a relative path
     * against, so the origin is folded in while one is still open.
     */
    function iconURL(icon: string | undefined): string {
      const at = get().address;
      return icon && at ? `${serverOrigin(at)}${icon}` : "";
    }

    /**
     * Rebuilds the channel badges from what the server counted, which is what
     * a badge that outlives the client is made of.
     *
     * The counts are the server's, taken from a read marker it keeps. The
     * colour is not: whether a message names this user is decided here, from
     * the words, exactly as it is decided for a message arriving live — see
     * the header of `lib/mentions` for why that decision cannot live on the
     * other side. The sample of words is capped by the server, so a channel
     * with more waiting than the cap reaches keeps its count and loses only
     * the highlight on its oldest end.
     */
    function restoreUnread(ready: Ready, channels: Map<number, Channel>): Map<number, Unread> {
      const restored = new Map<number, Unread>();
      const counts = ready.unread ?? [];
      if (counts.length === 0) return restored;

      const self = ready.user;
      const roles = indexById(ready.roles);
      const named = new Set<number>();
      for (const message of ready.unreadMentions ?? []) {
        if (named.has(message.channelId)) continue;
        // Own words never name their writer, and the marker moved past them
        // when they were sent; this only guards against counting them twice.
        if (message.userId === self.id) continue;
        const reach =
          message.replyToUserId === self.id
            ? "direct"
            : mentionReach(message.content, self, roles);
        if (reach !== "none") named.add(message.channelId);
      }

      for (const entry of counts) {
        if (entry.count <= 0 || !channels.has(entry.channelId)) continue;
        restored.set(entry.channelId, {
          count: entry.count,
          mention: named.has(entry.channelId),
        });
      }
      return restored;
    }

    /**
     * Carries the badges through a resync.
     *
     * What is already held wins, because this client has been watching all
     * along: it has seen what is on screen being read, which the server learns
     * a moment later, and taking the snapshot's word for it would light a
     * badge back up on the channel somebody is reading.
     *
     * A channel that has just become visible is the exception. There is no
     * memory of it to prefer — a permission change is what made it appear —
     * so what the server counted is the only answer there is.
     */
    function mergeUnread(ready: Ready, channels: Map<number, Channel>): Map<number, Unread> {
      const held = get().channels;
      const merged = new Map([...get().unread].filter(([channelId]) => channels.has(channelId)));
      for (const [channelId, entry] of restoreUnread(ready, channels)) {
        if (!held.has(channelId)) merged.set(channelId, entry);
      }
      return merged;
    }

    /**
     * Replaces everything the client knows, from a ready snapshot.
     *
     * `fresh` separates the two snapshots this receives. One is the first of a
     * connection, where the server's count of what is waiting is the only
     * answer there is. The other is a resync mid-session, where this client
     * has been watching all along and knows better: it has seen what is on
     * screen being read, which the server learns a moment later.
     */
    function applySnapshot(ready: Ready, fresh: boolean): void {
      const channels = indexById(ready.channels);

      // A snapshot can arrive mid-session as a resync, which is how the server
      // reports that what this user may see has changed. History for a channel
      // that is no longer visible goes with it; the rest is kept, so an
      // ordinary permission edit elsewhere does not blank the conversation
      // being read.
      const history = new Map(
        [...get().history].filter(([channelId]) => channels.has(channelId)),
      );
      const unread = fresh ? restoreUnread(ready, channels) : mergeUnread(ready, channels);
      for (const channelId of [...readAt.keys()]) {
        if (!channels.has(channelId)) readAt.delete(channelId);
      }

      // A resync can add or remove voice channels, and with them the people in
      // them. Taking the whole snapshot is the same answer the rest of the
      // state gives: rebuilding is cheaper than reconciling, and cannot drift.
      const voiceStates = new Map((ready.voiceStates ?? []).map((state) => [state.userId, state]));
      const speaking = new Set([...get().speaking].filter((userId) => voiceStates.has(userId)));

      // Private threads survive a resync whole. They hang off a pair of
      // identities rather than off the channel tree, so nothing a permission
      // change does can take one away, and the snapshot's own list is the
      // authority on what is waiting in each.
      set({
        server: ready.server,
        self: ready.user,
        users: indexById(ready.users),
        channels,
        roles: indexById(ready.roles),
        history,
        unread,
        conversations: new Map(
          (ready.conversations ?? []).map((conversation) => [conversation.userId, conversation]),
        ),
        expressions: indexById(ready.expressions ?? []),
        sounds: indexById(ready.sounds ?? []),
        voiceStates,
        speaking,
      });

      voiceConfig = ready.server.voice;
      iceServers = ready.iceServers ?? [];

      const own = ready.user.channelId === null ? null : channels.get(ready.user.channelId);
      if (own?.type === "voice") {
        enterVoice(own.id);
      } else if (host.ownsVoice()) {
        // A resync on the connection carrying the call: the link is refreshed
        // so the engine keeps talking over a socket it still has. Rebuilding it
        // here would cut off everybody's call because somebody renamed a role.
        attachVoice();
      }
    }

    /**
     * Applies a patch to one channel's history entry, creating it if needed.
     *
     * A connection that has gone behind another one holds no messages, and a
     * page that was in flight when it went is the one thing that could hand it
     * a window it has already let go of. It is dropped rather than kept: the
     * request will be made again on the way back in.
     */
    function patchHistory(channelId: number, patch: Partial<ChannelHistory>): void {
      if (!host.foreground()) return;
      const history = new Map(get().history);
      history.set(channelId, { ...(history.get(channelId) ?? EMPTY_HISTORY), ...patch });
      set({ history });
    }

    /**
     * Applies a patch to one conversation's held lines, creating the entry if
     * needed. A connection in the background holds none, for the same reason it
     * holds no channel: the badge is what is worth keeping, and the lines
     * behind it are one request away.
     */
    function patchDirect(userId: number, patch: Partial<DirectHistory>): void {
      if (!host.foreground()) return;
      const directHistory = new Map(get().directHistory);
      directHistory.set(userId, {
        ...(directHistory.get(userId) ?? EMPTY_DIRECT_HISTORY),
        ...patch,
      });
      set({ directHistory });
    }

    /** Puts one conversation in the list, or replaces what was there. */
    function upsertConversation(conversation: Conversation): void {
      const conversations = new Map(get().conversations);
      conversations.set(conversation.userId, conversation);
      set({ conversations });
    }

    /** Whether somebody is actually looking at this conversation right now. */
    function watchingConversation(userId: number): boolean {
      return (
        host.foreground() && get().activeConversationId === userId && !windowHidden()
      );
    }

    /**
     * Clears a conversation's badge and tells the server how far this side has
     * read, so the badge stays cleared across a restart.
     *
     * The marker is the server's and only ever moves forwards, so a failed
     * request costs nothing: the next read sends a newer id.
     */
    function markConversationRead(userId: number, messageId: number): void {
      const conversation = get().conversations.get(userId);
      if (conversation && conversation.unread > 0) {
        upsertConversation({ ...conversation, unread: 0 });
      }
      if (messageId <= 0) return;
      const gateway = get().gateway;
      if (!gateway?.isOpen) return;
      void gateway.request(Op.DMRead, { userId, messageId }).catch(() => {
        // The badge is already clear here, and the marker catches up on the
        // next line read in this conversation.
      });
    }

    /** Records that a channel was read just now, which is what the cut sorts on. */
    function touch(channelId: number): void {
      readAt.set(channelId, Date.now());
    }

    /**
     * Drops the channels read longest ago once too many are held.
     *
     * The channel on screen is never a candidate, and neither is one with a
     * request in flight: dropping either would take the entry the reply is
     * about to be merged into.
     */
    function pruneChannels(): void {
      const { history, activeChannelId } = get();
      if (history.size <= OPEN_CHANNEL_LIMIT) return;

      const droppable = [...history.entries()]
        .filter(([channelId, entry]) => channelId !== activeChannelId && !entry.loading)
        .map(([channelId]) => channelId)
        .sort((a, b) => (readAt.get(a) ?? 0) - (readAt.get(b) ?? 0));

      const dropped = droppable.slice(0, history.size - OPEN_CHANNEL_LIMIT);
      if (dropped.length === 0) return;

      const next = new Map(history);
      for (const channelId of dropped) {
        next.delete(channelId);
        readAt.delete(channelId);
      }
      set({ history: next });
    }

    /** Cuts a channel nobody is reading back to the page under its composer. */
    function trimIdle(channelId: number): void {
      const current = get().history.get(channelId);
      if (!current || current.loading) return;
      if (current.messages.length <= IDLE_CHANNEL_WINDOW) return;
      patchHistory(channelId, clampWindow(current.messages, "newest", IDLE_CHANNEL_WINDOW));
    }

    /** Clears the badge of one channel. */
    function clearUnread(channelId: number): void {
      if (!get().unread.has(channelId)) return;
      const unread = new Map(get().unread);
      unread.delete(channelId);
      set({ unread });
    }

    /**
     * Tells the server a channel has been read, which is what makes clearing a
     * badge outlive the client rather than only the session.
     *
     * The marker is the server's and only ever moves forwards, so a failed
     * request costs nothing and a stale one cannot undo a newer read: the next
     * one to be sent covers everything the lost one would have.
     */
    function sendChannelRead(channelId: number): void {
      const gateway = get().gateway;
      if (!gateway?.isOpen) return;
      // A category or a voice channel holds no messages and carries no marker,
      // so asking to read one is a round trip that can only be refused.
      const channel = get().channels.get(channelId);
      if (!channel || !(channel.type === "text" || isPostChannel(channel.type))) return;
      readSentAt.set(channelId, Date.now());
      void gateway.request(Op.ChannelRead, { channelId }).catch(() => {
        // Also the answer for a server too old to know the op. The badge is
        // clear on this client either way; only its survival is lost, which
        // is what those servers did before this existed.
      });
    }

    /**
     * Records that a channel has been read, at most once every few seconds.
     *
     * Reading is not one event. Somebody sitting in a busy channel reads every
     * message that lands in it, and a request per message would spend a round
     * trip on saying the same thing over and over. So the first read of a
     * channel goes immediately — that is the one that follows opening it — and
     * the rest of a burst is collapsed into one that follows.
     */
    function noteChannelRead(channelId: number): void {
      const since = Date.now() - (readSentAt.get(channelId) ?? 0);
      if (since >= READ_MARKER_INTERVAL_MS) {
        sendChannelRead(channelId);
        return;
      }
      readDue.add(channelId);
      if (readTimer !== null) return;
      readTimer = setTimeout(() => {
        readTimer = null;
        const due = [...readDue];
        readDue.clear();
        for (const id of due) sendChannelRead(id);
      }, READ_MARKER_INTERVAL_MS - since);
    }

    /** Clears a channel's badge here and records the read with the server. */
    function markChannelRead(channelId: number): void {
      clearUnread(channelId);
      noteChannelRead(channelId);
    }

    /** Drops what is owed to a connection that is going away. */
    function forgetReadMarkers(): void {
      if (readTimer !== null) clearTimeout(readTimer);
      readTimer = null;
      readDue.clear();
      readSentAt.clear();
    }

    /**
     * Counts an arriving message against the channel it landed in.
     *
     * A message is read only where somebody could have read it: the channel
     * open on the connection that is on screen, in a window that is actually
     * visible. Everything else — another channel, another server, a window
     * behind something — is a badge.
     */
    function noteUnread(message: Message): void {
      const state = get();
      if (!state.channels.has(message.channelId)) return;
      if (state.self && message.userId === state.self.id) {
        clearUnread(message.channelId);
        return;
      }
      const watching =
        host.foreground() && state.activeChannelId === message.channelId && !windowHidden();
      if (watching) {
        // Read as it lands, which the marker has to be told about: without it
        // an evening spent watching one channel would be waiting unread the
        // next time the client starts.
        noteChannelRead(message.channelId);
        return;
      }

      // Roles are passed as well as the user, so a message that names a group
      // this member is in counts as naming them. Answering somebody names them
      // too, and does it without spelling anything — so it is checked first
      // and reaches as far as writing the name out would.
      const reach = repliesToSelf(message.replyTo, state.self)
        ? "direct"
        : mentionReach(message.content, state.self, state.roles);
      const mention = reach !== "none";
      const current = state.unread.get(message.channelId) ?? { count: 0, mention: false };
      const unread = new Map(state.unread);
      unread.set(message.channelId, {
        count: current.count + 1,
        mention: current.mention || mention,
      });
      set({ unread });

      announceMessage({
        author: message.author,
        content: message.content,
        // The channel rather than the server: with the client already open,
        // "who said it and where" is what identifies a message, and a toast
        // has one line to say it in.
        channel: state.channels.get(message.channelId)?.name ?? "",
        channelId: message.channelId,
        reach,
        direct: false,
        tag: `channel:${message.channelId}`,
        open: () => {
          host.reveal("server");
          const ch = get().channels.get(message.channelId);
          if (ch && isPostChannel(ch.type)) {
            void get().openPostChannel(message.channelId);
          } else {
            void get().openChannel(message.channelId);
          }
        },
      });
    }

    /** Counts an arriving post against the channel it landed in. */
    function notePostUnread(post: Post): void {
      const state = get();
      if (!state.channels.has(post.channelId)) return;
      if (state.self && post.userId === state.self.id) {
        clearUnread(post.channelId);
        return;
      }
      const watching =
        host.foreground() && state.activeChannelId === post.channelId && !windowHidden();
      if (watching) {
        noteChannelRead(post.channelId);
        return;
      }

      const bodyText = post.body?.content ?? "";
      const content = bodyText ? `${post.title}: ${bodyText}` : post.title;
      const reach = mentionReach(content, state.self, state.roles);
      const mention = reach !== "none";
      const current = state.unread.get(post.channelId) ?? { count: 0, mention: false };
      const unread = new Map(state.unread);
      unread.set(post.channelId, {
        count: current.count + 1,
        mention: current.mention || mention,
      });
      set({ unread });

      announceMessage({
        author: post.author,
        content,
        channel: state.channels.get(post.channelId)?.name ?? "",
        channelId: post.channelId,
        reach,
        direct: false,
        tag: `channel:${post.channelId}:post:${post.id}`,
        open: () => {
          host.reveal("server");
          void get().openPostChannel(post.channelId);
        },
      });
    }

    /**
     * Hands one counted message to the notification layer.
     *
     * The badge is decided above and none of this is conditional on it the
     * other way round: a channel with something in it is unread whether or not
     * the settings let a sound or a toast leave the window.
     */
    function announceMessage(message: {
      author: string;
      content: string;
      /** The channel it landed in, or empty for a private conversation. */
      channel: string;
      /** The channel's id, or null for a private conversation. */
      channelId: number | null;
      /** How far it reached towards this user, which the rules are written in. */
      reach: MentionReach;
      direct: boolean;
      /** Unique within this connection; the server id is added here. */
      tag: string;
      open(): void;
    }): void {
      if (
        !shouldNotifyHere({
          serverId: id,
          channelId: message.channelId,
          reach: message.reach,
          direct: message.direct,
        })
      ) {
        return;
      }
      announce({
        title: message.channel ? `${message.author} — #${message.channel}` : message.author,
        body: message.content,
        mention: message.reach !== "none",
        tag: `${id}:${message.tag}`,
        activate: message.open,
      });
    }

    function applyEvent(op: string, payload: unknown): void {
      const state = get();

      // The audio plane is split the way the ids are. Who is in which voice
      // channel, muted, speaking, is per server and belongs here; the
      // signalling belongs to the one media session, and only the connection
      // carrying it has anything to do with it.
      if (op.startsWith("voice.")) {
        switch (op) {
          case Ev.VoiceState: {
            const { state: voiceState } = payload as VoiceStateEvent;
            const voiceStates = new Map(state.voiceStates);
            if (voiceState.connected || voiceState.channelId !== 0) {
              voiceStates.set(voiceState.userId, voiceState);
            } else {
              voiceStates.delete(voiceState.userId);
            }
            set({ voiceStates });
            if (voiceState.userId === state.self?.id && host.ownsVoice()) {
              useVoice.getState().setOwnState(voiceStates.get(voiceState.userId) ?? null);
            }
            if (!voiceState.connected) markSpeaking(voiceState.userId, false);
            return;
          }
          case Ev.VoiceSpeaking: {
            const event = payload as VoiceSpeakingEvent;
            // This client's own indicator is driven by its own microphone,
            // which knows sooner and more accurately than a round trip does.
            if (event.userId === state.self?.id && host.ownsVoice()) return;
            markSpeaking(event.userId, event.speaking);
            return;
          }
          default:
            if (host.ownsVoice()) useVoice.getState().handleEvent(op, payload);
            return;
        }
      }

      switch (op) {
        case Ev.Ready:
          applySnapshot(payload as Ready, false);
          return;

        case Ev.UserConnected:
        case Ev.UserUpdated: {
          const { user } = payload as UserEvent;
          const users = new Map(state.users);
          // This map is the whole roster, so a member belongs in it whether or
          // not they are here — the offline part of the list is where somebody
          // away is shown, and where somebody hiding disappears to.
          //
          // A guest has no such entry: the identity lasts no longer than the
          // connection that made it, so one who looks offline is either gone or
          // hiding, and both mean the same thing — leave them out. A server that
          // masks presence properly never sends one; this is what keeps an older
          // or patched one from undoing the hiding.
          const connected = user.online && user.status !== "offline";
          if (user.registered || connected || user.id === state.self?.id) {
            users.set(user.id, user);
          } else {
            users.delete(user.id);
          }
          set({
            users,
            self: state.self?.id === user.id ? user : state.self,
          });
          return;
        }

        case Ev.UserDisconnected: {
          const { userId } = payload as UserDisconnectedEvent;
          const users = new Map(state.users);
          const gone = users.get(userId);
          if (host.ownsVoice()) {
            const ourVoiceChannelId = useVoice.getState().channelId;
            if (ourVoiceChannelId !== null && gone?.channelId === ourVoiceChannelId) {
              void playVoiceSound("user-leave");
            }
          }
          // The event says a connection ended, not that a person left. A member
          // drops into the offline part of the list they were always in; a guest,
          // whose identity goes with the connection, drops out of it.
          if (gone?.registered) {
            users.set(userId, asOffline(gone));
          } else {
            users.delete(userId);
          }
          set({ users });
          participantGone(userId);
          return;
        }

        case Ev.UserRemoved: {
          const { userId } = payload as UserRemovedEvent;
          const users = new Map(state.users);
          const gone = users.get(userId);
          if (host.ownsVoice()) {
            const ourVoiceChannelId = useVoice.getState().channelId;
            if (ourVoiceChannelId !== null && gone?.channelId === ourVoiceChannelId) {
              void playVoiceSound("user-leave");
            }
          }
          users.delete(userId);
          set({ users });
          participantGone(userId);
          return;
        }

        case Ev.UserMoved: {
          const event = payload as UserMovedEvent;
          const existing = state.users.get(event.userId);
          if (!existing) return;
          const moved: User = { ...existing, channelId: event.to };
          const users = new Map(state.users);
          users.set(moved.id, moved);
          set({
            users,
            self: state.self?.id === moved.id ? moved : state.self,
          });

          // Sitting in a voice channel is what opens audio, whether this client
          // asked to, a moderator moved it, or it walked back in after a drop.
          // There is one path either way.
          const destination = event.to === null ? null : state.channels.get(event.to);
          if (state.self?.id === event.userId) {
            const prevChannel = existing.channelId !== null ? state.channels.get(existing.channelId) : null;
            const wasInVoice = prevChannel?.type === "voice";

            if (destination?.type === "voice") {
              if (!wasInVoice || existing.channelId !== event.to) {
                void playVoiceSound("join");
              }
              enterVoice(destination.id);
            } else {
              if (wasInVoice) {
                void playVoiceSound("leave");
              }
              exitVoice();
            }
          } else {
            if (host.ownsVoice()) {
              const ourVoiceChannelId = useVoice.getState().channelId;
              if (ourVoiceChannelId !== null) {
                const wasInOurChannel = existing.channelId === ourVoiceChannelId;
                const isNowInOurChannel = event.to === ourVoiceChannelId;
                if (!wasInOurChannel && isNowInOurChannel) {
                  void playVoiceSound("user-join");
                } else if (wasInOurChannel && !isNowInOurChannel) {
                  void playVoiceSound("user-leave");
                }
              }
            }
            if (
              !host.ownsVoice() ||
              event.to === null ||
              event.to !== useVoice.getState().channelId
            ) {
              participantGone(event.userId);
            }
          }
          return;
        }

        case Ev.ChannelCreated:
        case Ev.ChannelUpdated: {
          const { channel } = payload as ChannelEvent;
          const channels = new Map(state.channels);
          channels.set(channel.id, channel);
          set({ channels });
          return;
        }

        case Ev.ChannelDeleted: {
          const event = payload as ChannelDeletedEvent;
          const channels = new Map(state.channels);
          const history = new Map(state.history);
          const posts = new Map(state.posts);
          const unread = new Map(state.unread);
          const cascaded = Array.isArray(event.cascaded) ? event.cascaded : [];
          const forgotten = [event.channelId, ...cascaded];
          for (const channelId of forgotten) {
            channels.delete(channelId);
            history.delete(channelId);
            posts.delete(channelId);
            unread.delete(channelId);
            readAt.delete(channelId);
          }
          set({
            channels,
            history,
            posts,
            unread,
            activeChannelId:
              state.activeChannelId !== null && forgotten.includes(state.activeChannelId)
                ? null
                : state.activeChannelId,
          });

          const open = host.ownsVoice() ? useVoice.getState().channelId : null;
          if (open !== null && forgotten.includes(open)) exitVoice();
          return;
        }

        case Ev.PostCreated: {
          const { post } = payload as PostEvent;
          notePostUnread(post);
          const current = state.posts.get(post.channelId);
          if (!current) return;
          if (current.posts.some((p) => p.id === post.id)) return;
          const posts = new Map(state.posts);
          posts.set(post.channelId, {
            ...current,
            posts: [post, ...current.posts],
          });
          set({ posts });
          return;
        }

        case Ev.PostUpdated: {
          const { post } = payload as PostEvent;
          const current = state.posts.get(post.channelId);
          if (!current) return;
          const posts = new Map(state.posts);
          posts.set(post.channelId, {
            ...current,
            posts: current.posts.map((p) => {
              if (p.id !== post.id) return p;
              return {
                ...post,
                rsvp: post.rsvp ? { ...post.rsvp, own: post.rsvp.own || p.rsvp?.own || "" } : undefined,
              };
            }),
          });
          set({ posts });
          return;
        }

        case Ev.PostDeleted: {
          const event = payload as PostDeletedEvent;
          const current = state.posts.get(event.channelId);
          const posts = new Map(state.posts);
          if (current) {
            posts.set(event.channelId, {
              ...current,
              posts: current.posts.filter((p) => p.id !== event.postId),
            });
          }
          const postComments = new Map(state.postComments);
          postComments.delete(event.postId);
          set({ posts, postComments });
          return;
        }

        case Ev.PostRSVP: {
          const event = payload as PostRSVPEvent;
          const current = state.posts.get(event.channelId);
          if (!current) return;
          const posts = new Map(state.posts);
          posts.set(event.channelId, {
            ...current,
            posts: current.posts.map((p) => {
              if (p.id !== event.postId) return p;
              const isSelf = event.userId === state.self?.id;
              const ownAnswer = isSelf ? event.response : (p.rsvp?.own ?? "");
              return {
                ...p,
                rsvp: {
                  going: event.rsvp.going,
                  maybe: event.rsvp.maybe,
                  declined: event.rsvp.declined,
                  own: ownAnswer,
                },
              };
            }),
          });
          set({ posts });
          return;
        }

        case Ev.MessageCreated: {
          const { message } = payload as MessageEvent;
          noteUnread(message);

          if (message.postId) {
            // A comment under a post
            const currentChannel = state.posts.get(message.channelId);
            if (currentChannel) {
              const posts = new Map(state.posts);
              posts.set(message.channelId, {
                ...currentChannel,
                posts: currentChannel.posts.map((p) =>
                  p.id === message.postId
                    ? { ...p, comments: p.comments + 1, lastCommentAt: message.createdAt }
                    : p,
                ),
              });
              set({ posts });
            }

            const held = state.postComments.get(message.postId);
            if (held && !held.messages.some((m) => m.id === message.id)) {
              const postComments = new Map(state.postComments);
              postComments.set(message.postId, {
                ...held,
                messages: [...held.messages, message],
              });
              set({ postComments });
            }
            return;
          }

          // A channel this client has never opened is left alone: it will fetch
          // the newest page, this message included, when it is first opened. A
          // connection in the background holds no channel at all, which is the
          // whole of what makes holding one cheap.
          const current = state.history.get(message.channelId);
          if (!current) return;
          // Nor is one whose reader has jumped back into the middle of it: the
          // message belongs after a gap, and appending it would draw it as if it
          // followed what is on screen. The walk back to the present collects it.
          if (current.hasMoreAfter) return;
          if (current.messages.some((held) => held.id === message.id)) return;

          const history = new Map(state.history);
          history.set(message.channelId, {
            ...current,
            ...clampWindow([...current.messages, message], "newest"),
          });
          set({ history });
          return;
        }

        case Ev.MessageUpdated: {
          const { message } = payload as MessageEvent;
          if (message.postId) {
            const held = state.postComments.get(message.postId);
            if (held) {
              const postComments = new Map(state.postComments);
              postComments.set(message.postId, {
                ...held,
                messages: held.messages.map((m) => (m.id === message.id ? message : m)),
              });
              set({ postComments });
            }
            return;
          }

          const current = state.history.get(message.channelId);
          if (!current) return;

          const history = new Map(state.history);
          history.set(message.channelId, {
            ...current,
            messages: current.messages.map((held) => (held.id === message.id ? message : held)),
          });
          set({ history });
          return;
        }

        case Ev.MessageDeleted: {
          const event = payload as MessageDeletedEvent;
          for (const [postId, held] of state.postComments.entries()) {
            if (held.messages.some((m) => m.id === event.messageId)) {
              const postComments = new Map(state.postComments);
              postComments.set(postId, {
                ...held,
                messages: withoutMessage(held.messages, event.messageId),
              });
              const currentChannel = state.posts.get(event.channelId);
              let posts = state.posts;
              if (currentChannel) {
                posts = new Map(state.posts);
                posts.set(event.channelId, {
                  ...currentChannel,
                  posts: currentChannel.posts.map((p) =>
                    p.id === postId ? { ...p, comments: Math.max(0, p.comments - 1) } : p,
                  ),
                });
              }
              set({ postComments, posts });
              return;
            }
          }

          const current = state.history.get(event.channelId);
          if (!current) return;

          const history = new Map(state.history);
          history.set(event.channelId, {
            ...current,
            messages: withoutMessage(current.messages, event.messageId),
          });
          set({ history });
          return;
        }

        case Ev.DMCreated: {
          const { conversation, message } = payload as DMCreatedEvent;
          // The badge the server counted stands, unless the reader is looking
          // at this very conversation — in which case the line is read the
          // moment it arrives, and saying so is what keeps the marker with it.
          const watching = watchingConversation(conversation.userId);
          upsertConversation(watching ? { ...conversation, unread: 0 } : conversation);

          const current = state.directHistory.get(conversation.userId);
          if (current && !current.hasMoreAfter && !current.messages.some((h) => h.id === message.id)) {
            patchDirect(conversation.userId, clampWindow([...current.messages, message], "newest"));
          }
          if (watching) markConversationRead(conversation.userId, message.id);
          else if (message.userId !== state.self?.id) {
            // The event reaches both sides of the conversation, and the side
            // that sent it does not need to be told what it just said.
            announceMessage({
              author: message.author,
              content: message.content,
              channel: "",
              channelId: null,
              // A line addressed to one person is a mention of them whether or
              // not it spells their name, so it flashes the taskbar like one.
              reach: "direct",
              direct: true,
              tag: `dm:${conversation.userId}`,
              open: () => {
                host.reveal("dms");
                void get().openConversation(conversation.userId);
              },
            });
          }
          return;
        }

        case Ev.DMUpdated: {
          const { userId, message } = payload as DMUpdatedEvent;
          const conversation = state.conversations.get(userId);
          if (conversation?.lastMessage?.id === message.id) {
            upsertConversation({ ...conversation, lastMessage: message });
          }
          const current = state.directHistory.get(userId);
          if (!current) return;
          patchDirect(userId, {
            messages: current.messages.map((held) => (held.id === message.id ? message : held)),
          });
          return;
        }

        case Ev.DMDeleted: {
          const { userId, messageId } = payload as DMDeletedEvent;
          const current = state.directHistory.get(userId);
          const remaining = current ? withoutMessage(current.messages, messageId) : [];
          if (current) patchDirect(userId, { messages: remaining });

          // The preview under a name is the last thing that was said, so a
          // deleted last line falls back to whatever is still held. With
          // nothing held there is nothing to show until the list is re-read.
          const conversation = state.conversations.get(userId);
          if (conversation?.lastMessage?.id === messageId) {
            upsertConversation({ ...conversation, lastMessage: remaining.at(-1) });
          }
          return;
        }

        case Ev.RoleCreated:
        case Ev.RoleUpdated: {
          const { role } = payload as RoleEvent;
          const roles = new Map(state.roles);
          roles.set(role.id, role);
          set({ roles });
          return;
        }

        case Ev.RoleDeleted: {
          const { roleId } = payload as RoleDeletedEvent;
          const roles = new Map(state.roles);
          roles.delete(roleId);

          // A deleted role is gone from everyone who held it, and the server
          // does not send a user event per member.
          const users = new Map(state.users);
          for (const [userId, user] of users) {
            if (user.roles.includes(roleId)) {
              users.set(userId, { ...user, roles: user.roles.filter((r) => r !== roleId) });
            }
          }
          const self = state.self?.roles.includes(roleId)
            ? { ...state.self, roles: state.self.roles.filter((r) => r !== roleId) }
            : state.self;

          set({ roles, users, self });
          return;
        }

        case Ev.BanCreated: {
          const { ban } = payload as { ban: Ban };
          // Only a screen that has already loaded the list keeps it in step. A
          // client that never asked has nothing to patch, and asking for the
          // whole list because somebody else banned somebody would be a fetch
          // nobody is looking at.
          if (state.bans) set({ bans: [ban, ...state.bans.filter((b) => b.id !== ban.id)] });
          return;
        }

        case Ev.BanDeleted: {
          const { banId } = payload as { banId: number };
          if (state.bans) set({ bans: state.bans.filter((ban) => ban.id !== banId) });
          return;
        }

        case Ev.AuditEntry: {
          const { entry } = payload as { entry: AuditEntry };
          // Prepended only when the newest page is what is held: a screen that
          // has scrolled back is looking at a window, and dropping a new entry
          // into the top of it would put it out of order.
          if (state.audit.entries.length === 0 && !state.audit.hasMore) {
            set({ audit: { ...state.audit, entries: [entry] } });
            return;
          }
          set({ audit: { ...state.audit, entries: [entry, ...state.audit.entries] } });
          return;
        }

        case Ev.AutoModUpdated: {
          const { config } = payload as { config: AutoModConfig };
          set({ automod: config });
          return;
        }

        case Ev.RelayUpdated: {
          // Only sessions that may manage the server are sent this at all, so
          // arriving is the whole of the authorisation check.
          const { relay } = payload as { relay: RelayState };
          set({ relay });
          return;
        }

        case Ev.ExpressionCreated:
        case Ev.ExpressionUpdated: {
          const { expression } = payload as { expression: Expression };
          const expressions = new Map(state.expressions);
          expressions.set(expression.id, expression);
          set({ expressions });
          return;
        }

        case Ev.ExpressionDeleted: {
          const { expressionId } = payload as { expressionId: number };
          const expressions = new Map(state.expressions);
          expressions.delete(expressionId);
          set({ expressions });
          return;
        }

        case Ev.SoundCreated:
        case Ev.SoundUpdated: {
          const { sound } = payload as { sound: Sound };
          const sounds = new Map(state.sounds);
          sounds.set(sound.id, sound);
          set({ sounds });
          return;
        }

        case Ev.SoundDeleted: {
          const { soundId } = payload as { soundId: number };
          const sounds = new Map(state.sounds);
          sounds.delete(soundId);
          set({ sounds });
          return;
        }

        case Ev.SoundPlayed: {
          const event = payload as SoundPlayedEvent;
          const sound = state.sounds.get(event.soundId);
          if (!sound || !state.address) return;
          // Deafening silences the soundboard exactly as it silences everybody
          // else in the room: it is the same room and the same output.
          const own = state.self ? state.voiceStates.get(state.self.id) : undefined;
          if (own && (own.selfDeaf || own.deaf)) return;
          void playSoundClip(`${serverOrigin(state.address)}${sound.url}`, sound.volume);
          return;
        }

        case Ev.ServerUpdated: {
          const { server } = payload as ServerUpdatedEvent;
          set({ server });
          // An operator can change what this server carries — including which
          // side relays audio — while people are sitting in a voice channel,
          // and a client still holding the mode it was told at connect would
          // open the next session the wrong way round.
          voiceConfig = server.voice;
          if (host.ownsVoice()) useVoice.getState().serverConfigChanged(voiceConfig);
          host.savedChanged(
            upsertServer({
              id,
              name: server.name,
              icon: iconURL(server.icon),
            }),
          );
          return;
        }

        default:
          // An event from a newer server than this client understands.
          return;
      }
    }

    /**
     * Drops everything this connection held and hands it back to the registry.
     *
     * `wasConnected` decides how the message reads: a session that was up
     * reports what ended it, while one that never came up reports why the
     * attempt failed.
     */
    function endSession(message: string, wasConnected: boolean): void {
      cancelReconnect();
      resumeChannelId = null;
      readAt.clear();
      forgetReadMarkers();
      abandonVoice();
      set({
        status: "idle",
        notice: wasConnected ? message : null,
        error: wasConnected ? null : message,
        gateway: null,
        token: null,
        server: null,
        self: null,
        users: new Map(),
        channels: new Map(),
        roles: new Map(),
        history: new Map(),
        posts: new Map(),
        postComments: new Map(),
        unread: new Map(),
        activeChannelId: null,
        conversations: new Map(),
        directHistory: new Map(),
        activeConversationId: null,
        voiceStates: new Map(),
        speaking: new Set(),
        search: EMPTY_SEARCH,
        jump: null,
        directJump: null,
      });
      host.ended(message, wasConnected);
    }

    /**
     * Programs the next retry, or ends the session when there will not be one.
     *
     * Every way of losing a connection arrives here, including the one where no
     * socket ever opened: a server that has not finished restarting refuses the
     * connection rather than closing it, and refusal is the case reconnecting
     * exists for. Routing only genuine closes here is what would make the retry
     * chain stop on the first attempt, precisely when the server is still down.
     */
    function scheduleReconnect(epoch: number, message: string, wasConnected: boolean): void {
      if (epoch !== connectionEpoch) return;
      // The socket closing and the request on it rejecting are one drop reported
      // twice. The first report is the one that counts.
      if (epoch === scheduledEpoch) return;

      const options = lastOptions;
      if (!options || reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        endSession(message, wasConnected);
        return;
      }

      scheduledEpoch = epoch;
      reconnectAttempt += 1;
      // Jitter spreads the retries of everybody who was on a server when it went
      // down, so it is not met by the whole room at the same instant.
      const backoff = Math.min(1000 * 2 ** (reconnectAttempt - 1), RECONNECT_MAX_DELAY_MS);
      const delay = Math.round(backoff * (0.8 + Math.random() * 0.4));

      set({
        status: "reconnecting",
        error: null,
        notice: t("connect.retryingIn", {
          seconds: Math.max(1, Math.round(delay / 1000)),
          attempt: reconnectAttempt,
          total: MAX_RECONNECT_ATTEMPTS,
        }),
      });

      clearReconnectTimer();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        // A reconnect never re-runs a password sign-in; the stored token is what
        // it resumes with, exactly as a fresh start would.
        void get()
          .connect({ ...options, credentials: undefined })
          .catch(() => {
            // connect() has already routed the failure back here.
          });
      }, delay);
    }

    function handleClose(epoch: number, info: CloseInfo): void {
      if (epoch !== connectionEpoch) return;

      const state = get();
      const wasConnected = state.status === "connected";
      // Where to come back to. It is read before the teardown, because the
      // teardown is what forgets it.
      if (wasConnected && state.self?.channelId != null) {
        resumeChannelId = state.self.channelId;
      }
      set({ gateway: null });
      // Signalling travels on the socket that just went, so nothing about the
      // media session can be recovered without a new one. It is torn down here
      // rather than left to time out.
      abandonVoice();

      const message = closeMessage(info.code, info.reason);
      // A deliberate close, a kick, or a displacement: do not fight it.
      if (info.code === 1000 || info.code === 1008) {
        endSession(message, wasConnected);
        return;
      }
      scheduleReconnect(epoch, message, wasConnected);
    }

    /**
     * Walks back into the channel a dropped connection was in.
     *
     * It is a plain user.move, so everything downstream of one happens as usual:
     * the server answers with the move event this client already treats as the
     * one thing that opens audio, so a call resumes without a second path.
     */
    async function restoreChannel(epoch: number, channelId: number): Promise<void> {
      if (epoch !== connectionEpoch) return;
      const channel = get().channels.get(channelId);
      if (!channel) return;
      // Coming back must not take the microphone from a call that started
      // while this connection was down. Whoever is in one now chose to be,
      // and more recently than whoever was in this one.
      if (channel.type === "voice" && !host.ownsVoice() && host.callElsewhere()) return;
      try {
        await requireGateway().request(Op.UserMove, { channelId });
      } catch {
        // The channel is gone, full, or no longer visible. Coming back to the
        // server at all was the part worth insisting on.
      }
    }

    return {
      status: "idle",
      error: null,
      notice: null,
      serverId: id,
      address: null,
      gateway: null,
      token: null,
      server: null,
      self: null,
      users: new Map(),
      channels: new Map(),
      roles: new Map(),
      history: new Map(),
      posts: new Map(),
      postComments: new Map(),
      unread: new Map(),
      activeChannelId: null,
      conversations: new Map(),
      directHistory: new Map(),
      activeConversationId: null,
      expressions: new Map(),
      sounds: new Map(),
      bans: null,
      audit: { entries: [], hasMore: false, loading: false, error: null },
      automod: null,
      relay: null,
      voiceStates: new Map(),
      speaking: new Set(),
      search: EMPTY_SEARCH,
      jump: null,
      directJump: null,

      async connect(options = {}) {
        const previous = get().gateway;
        // The timer goes, the attempt count stays: this call may well be the
        // retry that timer was going to make.
        clearReconnectTimer();
        previous?.close("reconnecting");

        const epoch = ++connectionEpoch;
        // A retry is any attempt made while a backoff is running, whatever the
        // store is rendering at the moment.
        const isRetry = reconnectAttempt > 0;
        set({ status: isRetry ? "reconnecting" : "connecting", error: null, notice: null });

        /**
         * Reports a failed attempt. During a reconnection it feeds the backoff;
         * on a first attempt it is the end of it, which is what keeps the
         * connect screen answering a bad address immediately.
         */
        const fail = (message: string, permanent: boolean): Error => {
          if (isRetry && !permanent) scheduleReconnect(epoch, message, false);
          else endSession(message, false);
          return new Error(message);
        };

        if (options.address) dialAddress = options.address;

        let address: ServerAddress;
        try {
          address = parseAddress(dialAddress);
        } catch (error) {
          // A malformed address is not something a retry can improve on.
          throw fail(error instanceof Error ? error.message : String(error), true);
        }

        const saved = getServer(id);
        const nickname = options.nickname?.trim() || saved?.nickname || "Guest";
        lastOptions = { ...options, address: dialAddress, nickname };

        let gateway: Gateway;
        try {
          gateway = await Gateway.open(address, {
            onEvent: (op, payload) => {
              if (epoch === connectionEpoch) applyEvent(op, payload);
            },
            onClose: (info) => handleClose(epoch, info),
          });
        } catch (error) {
          // A socket that never opened never closes either, so this is the only
          // report that a server which is still down produces. It is the case
          // reconnecting is for, so it feeds the backoff rather than ending it.
          throw fail(error instanceof Error ? error.message : String(error), false);
        }

        // Both ends carry a range of protocol revisions, and they talk as long
        // as the two ranges overlap.
        const fit = protocolFit(gateway.hello.server);
        if (fit !== "ok") {
          gateway.close("protocol mismatch");
          const version = gateway.hello.server.protocolVersion;
          const message =
            fit === "server_too_new"
              ? t("connect.serverTooNew", { version })
              : t("connect.serverTooOld", { version });
          // Retrying cannot make two versions agree.
          throw fail(message, true);
        }

        // The machine identifier this server's bans are matched on. It is
        // hashed with a salt the server sent in `hello`, so the same machine
        // presents a different value to every server and nothing here can be
        // used to follow somebody around. A server that sends no salt gets no
        // identifier, and a failure to compute one is not a reason to refuse
        // to connect: it matches no ban, which is where everybody starts.
        let device = "";
        try {
          device = await deviceIdentifier(gateway.hello.deviceSalt);
        } catch {
          device = "";
        }

        // Sign in with credentials when given, otherwise resume the stored token,
        // otherwise take a fresh guest identity. A token the server no longer
        // recognises falls back to being a guest rather than dead-ending.
        const token = options.asNewGuest ? undefined : saved?.token;
        let ready: Ready;
        try {
          if (options.credentials) {
            ready = await gateway.request<Ready>(Op.AuthLogin, {
              ...options.credentials,
              serverPassword: options.serverPassword,
              device,
            });
          } else if (token) {
            try {
              ready = await gateway.request<Ready>(Op.AuthToken, {
                token,
                serverPassword: options.serverPassword,
                device,
              });
            } catch (error) {
              if (!(error instanceof AuralError) || error.code !== "invalid_credentials") throw error;
              clearToken(id);
              ready = await gateway.request<Ready>(Op.AuthGuest, {
                nickname,
                serverPassword: options.serverPassword,
                device,
              });
            }
          } else {
            ready = await gateway.request<Ready>(Op.AuthGuest, {
              nickname,
              serverPassword: options.serverPassword,
              device,
            });
          }
        } catch (error) {
          gateway.close("authentication failed");
          throw fail(describeError(error), isPermanentAuthFailure(error));
        }

        if (epoch !== connectionEpoch) {
          gateway.close("superseded");
          return;
        }

        // The session is up: the backoff has done its job and starts over.
        cancelReconnect();
        host.savedChanged(
          upsertServer({
            id,
            address: address.raw,
            name: ready.server.name,
            icon: iconURL(ready.server.icon),
            nickname: ready.user.nickname,
            lastConnectedAt: Date.now(),
            ...(ready.sessionToken ? { token: ready.sessionToken } : {}),
            ...(ready.user.username ? { username: ready.user.username } : {}),
          }),
        );

        set({
          status: "connected",
          error: null,
          notice: null,
          address,
          gateway,
          token: ready.sessionToken ?? token ?? null,
        });
        applySnapshot(ready, true);

        // Walk back into the channel the dropped connection was in. The server
        // holds membership only for the life of a connection, so a reconnected
        // session always arrives sitting nowhere and has to ask again.
        const resume = resumeChannelId;
        resumeChannelId = null;
        if (resume !== null && ready.user.channelId === null) {
          void restoreChannel(epoch, resume);
        }
      },

      disconnect() {
        cancelReconnect();
        resumeChannelId = null;
        lastOptions = null;
        connectionEpoch += 1;
        abandonVoice();
        readAt.clear();
        forgetReadMarkers();
        get().gateway?.close("disconnected by the user");
        set({
          status: "idle",
          error: null,
          notice: null,
          gateway: null,
          address: null,
          token: null,
          server: null,
          self: null,
          users: new Map(),
          channels: new Map(),
          roles: new Map(),
          history: new Map(),
          posts: new Map(),
          postComments: new Map(),
          unread: new Map(),
          activeChannelId: null,
          conversations: new Map(),
          directHistory: new Map(),
          activeConversationId: null,
          expressions: new Map(),
          sounds: new Map(),
          bans: null,
          audit: { entries: [], hasMore: false, loading: false, error: null },
          automod: null,
          relay: null,
          voiceStates: new Map(),
          speaking: new Set(),
          search: EMPTY_SEARCH,
          jump: null,
          directJump: null,
        });
        stopAllSounds();
        forgetSoundCache();
        // Leaving on purpose is not news. The registry takes the connection
        // out of the rail, and there is nothing to tell anybody about it.
        host.ended("", true);
      },

      dismissNotice() {
        set({ notice: null });
      },

      enterForeground() {
        // Nothing is fetched here. The view mounts, asks for the channel it is
        // opening, and that one request is what coming back to a server costs.
        const active = get().activeChannelId;
        if (active !== null) get().markRead(active);
        const conversation = get().activeConversationId;
        if (conversation !== null) {
          const newest = get().directHistory.get(conversation)?.messages.at(-1);
          markConversationRead(conversation, newest?.id ?? 0);
        }
      },

      enterBackground() {
        // What a connection in the background is worth holding is presence, the
        // roster and the badges. Messages are not on that list: they are one
        // request away, stale by the time somebody looks at them, and the only
        // part of a connection whose size has no bound of its own.
        readAt.clear();
        forgetReadMarkers();
        set({
          history: new Map(),
          posts: new Map(),
          postComments: new Map(),
          activeChannelId: null,
          directHistory: new Map(),
          activeConversationId: null,
          search: EMPTY_SEARCH,
          jump: null,
          directJump: null,
        });
      },

      async joinChannel(channelId) {
        await requireGateway().request(Op.UserMove, { channelId });
      },

      async leaveChannel() {
        await requireGateway().request(Op.UserMove, { channelId: null });
      },

      async moveUser(userId, channelId) {
        await requireGateway().request(Op.UserMove, { userId, channelId });
      },

      async setNickname(nickname, userId) {
        await requireGateway().request(Op.UserUpdate, { nickname, userId });
        const self = get().self;
        if (userId === undefined || userId === self?.id) {
          host.savedChanged(upsertServer({ id, nickname }));
        }
      },

      async setStatus(status) {
        await requireGateway().request(Op.UserUpdate, { status });
      },

      async reportActivity(activity) {
        await requireGateway().request(Op.UserActivity, { activity });
      },

      async updateProfile(patch) {
        // A picture is removed by sending an empty string, never null: the server
        // decodes a JSON null into the same absent field as a missing key, so a
        // null would silently leave the picture exactly where it was.
        const request = {
          ...patch,
          ...(patch.avatar === null ? { avatar: "" } : {}),
          ...(patch.banner === null ? { banner: "" } : {}),
        };
        await requireGateway().request(Op.UserUpdate, request);
        const self = get().self;
        if (patch.nickname && (patch.userId === undefined || patch.userId === self?.id)) {
          host.savedChanged(upsertServer({ id, nickname: patch.nickname }));
        }
      },

      async uploadAvatar(file, onProgress) {
        const { address, token } = get();
        if (!address || !token) throw new Error("Not connected.");
        const upload = uploadAvatarRequest({ address, token, file, onProgress });
        const res = await upload.done;
        return { url: res.url };
      },

      async uploadBanner(file, onProgress) {
        const { address, token } = get();
        if (!address || !token) throw new Error("Not connected.");
        const upload = uploadBannerRequest({ address, token, file, onProgress });
        const res = await upload.done;
        return { url: res.url };
      },

      async uploadServerIcon(file, onProgress) {
        const { address, token } = get();
        if (!address || !token) throw new Error("Not connected.");
        const upload = uploadServerIconRequest({ address, token, file, onProgress });
        const res = await upload.done;
        return { url: res.url };
      },

      async kickUser(userId, reason, deleteMessages) {
        await requireGateway().request(Op.UserKick, { userId, reason, deleteMessages });
      },

      async banUser(input) {
        await requireGateway().request(Op.BanCreate, input);
      },

      async listBans() {
        const result = await requireGateway().request<{ bans: Ban[] }>(Op.BanList, {});
        set({ bans: result.bans ?? [] });
      },

      async deleteBan(banId) {
        await requireGateway().request(Op.BanDelete, { banId });
        const held = get().bans;
        if (held) set({ bans: held.filter((ban) => ban.id !== banId) });
      },

      async loadAudit(options = {}) {
        const { before } = options;
        set({ audit: { ...get().audit, loading: true, error: null } });
        try {
          const result = await requireGateway().request<AuditListResult>(Op.AuditList, {
            before,
            actorId: options.actorId,
            action: options.action,
          });
          const held = get().audit;
          set({
            audit: {
              // Without a cursor this is the newest page, which replaces what
              // is held; with one it is the page after it.
              entries: before ? [...held.entries, ...result.entries] : result.entries,
              hasMore: result.hasMore,
              loading: false,
              error: null,
            },
          });
        } catch (error) {
          set({ audit: { ...get().audit, loading: false, error: describeError(error) } });
        }
      },

      async loadAutoMod() {
        const result = await requireGateway().request<{ config: AutoModConfig }>(Op.AutoModGet, {});
        set({ automod: result.config });
      },

      async updateAutoMod(config) {
        const result = await requireGateway().request<{ config: AutoModConfig }>(
          Op.AutoModUpdate,
          { config },
        );
        // The server normalises what it was sent — bounds, duplicates, actions
        // a rule cannot perform — so what comes back is what is now in force,
        // and that is what the screen has to show.
        set({ automod: result.config });
      },

      async loadRelay() {
        const result = await requireGateway().request<{ relay: RelayState }>(Op.RelayGet, {});
        set({ relay: result.relay });
      },

      async configureRelay(enabled, botToken) {
        // The token is only sent when there is one to send. A request without
        // it means "leave what you have", which is what the toggle needs.
        const payload: { enabled: boolean; botToken?: string } = { enabled };
        if (botToken !== undefined) payload.botToken = botToken;
        const result = await requireGateway().request<{ relay: RelayState }>(
          Op.RelayConfigure,
          payload,
        );
        set({ relay: result.relay });
      },

      async createRelayLink(request) {
        const result = await requireGateway().request<{ relay: RelayState }>(
          Op.RelayCreate,
          request,
        );
        set({ relay: result.relay });
      },

      async updateRelayLink(request) {
        const result = await requireGateway().request<{ relay: RelayState }>(
          Op.RelayUpdate,
          request,
        );
        set({ relay: result.relay });
      },

      async deleteRelayLink(id) {
        const result = await requireGateway().request<{ relay: RelayState }>(
          Op.RelayDelete,
          { id },
        );
        set({ relay: result.relay });
      },

      async uploadExpression(kind, name, file, onProgress) {
        const { address, token } = get();
        if (!address || !token) throw new Error("Not connected.");
        const upload = uploadExpressionRequest({ address, token, file, name, onProgress }, kind);
        const created = await upload.done;
        // The broadcast puts it in the map as well. Doing it here too is what
        // lets the caller render the new emoji without waiting for a round
        // trip it has already made.
        const expressions = new Map(get().expressions);
        expressions.set(created.id, created);
        set({ expressions });
        return created;
      },

      async renameExpression(expressionId, name) {
        await requireGateway().request(Op.ExpressionUpdate, { expressionId, name });
      },

      async deleteExpression(expressionId) {
        await requireGateway().request(Op.ExpressionDelete, { expressionId });
      },

      async uploadSound(name, emoji, file, onProgress) {
        const { address, token } = get();
        if (!address || !token) throw new Error("Not connected.");
        const upload = uploadSoundRequest({ address, token, file, name, emoji, onProgress });
        const created = await upload.done;
        const sounds = new Map(get().sounds);
        sounds.set(created.id, created);
        set({ sounds });
        return created;
      },

      async updateSound(input) {
        await requireGateway().request(Op.SoundUpdate, input);
      },

      async deleteSound(soundId) {
        await requireGateway().request(Op.SoundDelete, { soundId });
      },

      async playSound(soundId) {
        await requireGateway().request(Op.SoundPlay, { soundId });
      },

      async register(username, password) {
        await requireGateway().request(Op.AuthRegister, { username, password });
        host.savedChanged(upsertServer({ id, username }));
      },

      async signIn(username, password) {
        // Signing in as somebody else is a new session on the same server, not
        // a change to this one.
        await get().connect({ credentials: { username, password } });
      },

      async claimAdmin(token) {
        await requireGateway().request(Op.ServerClaimAdmin, { token });
      },

      async updateServer(patch) {
        const res = await requireGateway().request<ServerUpdatedEvent>(Op.ServerUpdate, patch);
        if (res?.server) {
          set({ server: res.server });
          host.savedChanged(
            upsertServer({
              id,
              name: res.server.name,
              icon: iconURL(res.server.icon),
            }),
          );
        }
      },

      async fetchServerMetrics(force = false) {
        return await requireGateway().request<ServerMetricsResponse>(Op.ServerMetrics, { force });
      },

      async createChannel(input) {
        await requireGateway().request(Op.ChannelCreate, input);
      },

      async updateChannel(input) {
        await requireGateway().request(Op.ChannelUpdate, input);
      },

      async deleteChannel(channelId) {
        await requireGateway().request(Op.ChannelDelete, { channelId });
      },

      async openChannel(channelId) {
        touch(channelId);
        // Already held, or already on its way: opening a channel twice is the
        // normal case, because every render of the view asks.
        const existing = get().history.get(channelId);
        if (existing && (existing.loading || existing.error === null)) return;

        patchHistory(channelId, { loading: true, error: null });
        try {
          const page = await requireGateway().request<MessageHistoryResult>(Op.MessageHistory, {
            channelId,
          });
          // Events that landed while the page was in flight are already held,
          // so the two are merged rather than one replacing the other.
          const held = get().history.get(channelId)?.messages ?? [];
          patchHistory(channelId, {
            hasMore: page.hasMore,
            hasMoreAfter: false,
            loading: false,
            error: null,
            ...clampWindow(mergeMessages(page.messages, held), "newest"),
          });
          pruneChannels();
        } catch (error) {
          patchHistory(channelId, { loading: false, error: describeError(error) });
        }
      },

      async loadOlder(channelId) {
        const current = get().history.get(channelId);
        if (!current || current.loading || !current.hasMore) return;
        const oldest = current.messages[0];
        if (!oldest) return;

        touch(channelId);
        patchHistory(channelId, { loading: true, error: null });
        try {
          const page = await requireGateway().request<MessageHistoryResult>(Op.MessageHistory, {
            channelId,
            before: oldest.id,
          });
          const held = get().history.get(channelId)?.messages ?? [];
          // hasMoreAfter is left to the trim: this page says nothing about the
          // end of the channel the reader is not at, but cutting the window back
          // to size is what can put that end out of reach.
          patchHistory(channelId, {
            hasMore: page.hasMore,
            loading: false,
            error: null,
            ...clampWindow(mergeMessages(page.messages, held), "oldest"),
          });
        } catch (error) {
          patchHistory(channelId, { loading: false, error: describeError(error) });
        }
      },

      async loadNewer(channelId) {
        const current = get().history.get(channelId);
        if (!current || current.loading || !current.hasMoreAfter) return;
        const newest = current.messages.at(-1);
        if (!newest) return;

        touch(channelId);
        patchHistory(channelId, { loading: true, error: null });
        try {
          const page = await requireGateway().request<MessageHistoryResult>(Op.MessageHistory, {
            channelId,
            after: newest.id,
          });
          const held = get().history.get(channelId)?.messages ?? [];
          patchHistory(channelId, {
            hasMoreAfter: page.hasMoreAfter,
            loading: false,
            error: null,
            ...clampWindow(mergeMessages(held, page.messages), "newest"),
          });
        } catch (error) {
          patchHistory(channelId, { loading: false, error: describeError(error) });
        }
      },

      async returnToPresent(channelId) {
        // The window being held is dropped rather than paged forward through:
        // the present is one request away, and everything between is history the
        // reader can scroll back into.
        const history = new Map(get().history);
        history.delete(channelId);
        set({ history });
        await get().openChannel(channelId);
      },

      setActiveChannel(channelId) {
        const previous = get().activeChannelId;
        if (previous === channelId) {
          if (channelId !== null) markChannelRead(channelId);
          return;
        }
        set({ activeChannelId: channelId });
        // Whatever was being read a moment ago keeps the page under its
        // composer and nothing above it. Coming back to it is instant; going
        // further back is a request, which is what it was before it was read.
        if (previous !== null) trimIdle(previous);
        if (channelId !== null) {
          touch(channelId);
          markChannelRead(channelId);
        }
        pruneChannels();
      },

      markRead(channelId) {
        markChannelRead(channelId);
      },

      async jumpToMessage(channelId, messageId) {
        set({ jump: { channelId, messageId, nonce: jumpNonce++ } });
        touch(channelId);

        const current = get().history.get(channelId);
        if (current && current.messages.some((held) => held.id === messageId)) return;

        patchHistory(channelId, { loading: true, error: null });
        try {
          const page = await requireGateway().request<MessageHistoryResult>(Op.MessageHistory, {
            channelId,
            around: messageId,
          });
          // The window replaces whatever was held rather than merging into it:
          // the two runs need not touch, and a merge would draw them as if they
          // did.
          patchHistory(channelId, {
            messages: page.messages,
            hasMore: page.hasMore,
            hasMoreAfter: page.hasMoreAfter,
            loading: false,
            error: null,
          });
          pruneChannels();
        } catch (error) {
          patchHistory(channelId, { loading: false, error: describeError(error) });
        }
      },

      clearJump(nonce) {
        if (get().jump?.nonce === nonce) set({ jump: null });
      },

      openSearch(prefill) {
        const { search } = get();
        set({
          search: {
            ...search,
            open: true,
            focus: search.focus + 1,
            ...(prefill === undefined ? {} : { input: prefill }),
          },
        });
      },

      closeSearch() {
        set({ search: EMPTY_SEARCH });
      },

      setSearchInput(input) {
        set({ search: { ...get().search, input } });
      },

      async runSearch(options = {}) {
        const state = get();
        const input = options.input ?? state.search.input;
        const sort = options.sort ?? state.search.sort;
        const offset = options.offset ?? 0;

        const parsed = parseSearchInput(input);
        const directory = buildDirectory(state.channels, state.users, state.history);
        const { request, unresolved, empty } = buildSearchRequest(parsed, directory, {
          sort,
          offset,
          limit: SEARCH_PAGE_SIZE,
        });

        const base: SearchState = {
          ...state.search,
          open: true,
          input,
          ran: input,
          sort,
          offset,
          unresolved,
        };

        // A line that names nothing is not a failed search, it is one that has
        // not been written yet: the panel opens on the filter help instead.
        if (empty) {
          set({ search: { ...base, hits: [], total: 0, loading: false, error: null } });
          return;
        }

        set({ search: { ...base, loading: true, error: null } });
        try {
          const result = await requireGateway().request<MessageSearchResult>(
            Op.MessageSearch,
            request,
          );
          // A newer search may have been started while this one was in flight.
          if (get().search.ran !== input || get().search.offset !== offset) return;
          set({
            search: {
              ...get().search,
              hits: result.hits,
              total: result.total,
              loading: false,
              error: null,
            },
          });
        } catch (error) {
          set({
            search: {
              ...get().search,
              hits: [],
              total: 0,
              loading: false,
              error: describeError(error),
            },
          });
        }
      },

      async sendMessage(channelId, content, attachments, replyToId) {
        await requireGateway().request(Op.MessageSend, {
          channelId,
          content,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
          ...(replyToId ? { replyToId } : {}),
        });
      },

      uploadAttachment(channelId, file, onProgress) {
        const { address, token: live } = get();
        // The upload endpoint authenticates with the same token the WebSocket
        // resumes with. The live one is preferred over the stored one, which may
        // never have been written where storage is unavailable.
        const token = live ?? getServer(id)?.token;
        if (!address || !token) {
          return {
            done: Promise.reject(new Error("Not connected.")),
            cancel: () => {},
          };
        }
        return uploadFile({ address, token, channelId, file, onProgress });
      },

      async setDMPrivacy(privacy) {
        await requireGateway().request(Op.UserUpdate, { dmPrivacy: privacy });
      },

      async openConversation(userId) {
        // A thread the server has never heard of still belongs in the list the
        // moment somebody opens it: that is what an empty conversation is, and
        // the first message sent replaces this entry with the real one.
        if (!get().conversations.has(userId)) {
          upsertConversation({
            id: 0,
            userId,
            lastMessageAt: Math.floor(Date.now() / 1000),
            unread: 0,
          });
        }

        // Already held, or already on its way: opening a conversation twice is
        // the normal case, because every render of the view asks.
        const existing = get().directHistory.get(userId);
        if (existing && (existing.loading || existing.error === null)) return;

        patchDirect(userId, { loading: true, error: null });
        try {
          const page = await requireGateway().request<DMHistoryResult>(Op.DMHistory, { userId });
          const held = get().directHistory.get(userId)?.messages ?? [];
          patchDirect(userId, {
            hasMore: page.hasMore,
            hasMoreAfter: false,
            loading: false,
            error: null,
            ...clampWindow(mergeMessages(page.messages, held), "newest"),
          });
          const newest = get().directHistory.get(userId)?.messages.at(-1);
          if (newest && watchingConversation(userId)) markConversationRead(userId, newest.id);
        } catch (error) {
          patchDirect(userId, { loading: false, error: describeError(error) });
        }
      },

      async loadOlderDirect(userId) {
        const current = get().directHistory.get(userId);
        if (!current || current.loading || !current.hasMore) return;
        const oldest = current.messages[0];
        if (!oldest) return;

        patchDirect(userId, { loading: true, error: null });
        try {
          const page = await requireGateway().request<DMHistoryResult>(Op.DMHistory, {
            userId,
            before: oldest.id,
          });
          const held = get().directHistory.get(userId)?.messages ?? [];
          patchDirect(userId, {
            hasMore: page.hasMore,
            loading: false,
            error: null,
            ...clampWindow(mergeMessages(page.messages, held), "oldest"),
          });
        } catch (error) {
          patchDirect(userId, { loading: false, error: describeError(error) });
        }
      },

      async loadNewerDirect(userId) {
        const current = get().directHistory.get(userId);
        if (!current || current.loading || !current.hasMoreAfter) return;
        const newest = current.messages.at(-1);
        if (!newest) return;

        patchDirect(userId, { loading: true, error: null });
        try {
          const page = await requireGateway().request<DMHistoryResult>(Op.DMHistory, {
            userId,
            after: newest.id,
          });
          const held = get().directHistory.get(userId)?.messages ?? [];
          patchDirect(userId, {
            hasMoreAfter: page.hasMoreAfter,
            loading: false,
            error: null,
            ...clampWindow(mergeMessages(held, page.messages), "newest"),
          });
        } catch (error) {
          patchDirect(userId, { loading: false, error: describeError(error) });
        }
      },

      async returnToPresentDirect(userId) {
        // The window being held is dropped rather than paged forward through:
        // the present is one request away, and everything between is history
        // the reader can scroll back into.
        const directHistory = new Map(get().directHistory);
        directHistory.delete(userId);
        set({ directHistory });
        await get().openConversation(userId);
      },

      async jumpToDirectMessage(userId, messageId) {
        set({ directJump: { userId, messageId, nonce: jumpNonce++ } });

        const current = get().directHistory.get(userId);
        if (current && current.messages.some((held) => held.id === messageId)) return;

        patchDirect(userId, { loading: true, error: null });
        try {
          const page = await requireGateway().request<DMHistoryResult>(Op.DMHistory, {
            userId,
            around: messageId,
          });
          // The window replaces whatever was held rather than merging into it:
          // the two runs need not touch, and a merge would draw them as if
          // they did.
          patchDirect(userId, {
            messages: page.messages,
            hasMore: page.hasMore,
            hasMoreAfter: page.hasMoreAfter,
            loading: false,
            error: null,
          });
        } catch (error) {
          patchDirect(userId, { loading: false, error: describeError(error) });
        }
      },

      clearDirectJump(nonce) {
        if (get().directJump?.nonce === nonce) set({ directJump: null });
      },

      async sendDirectMessage(userId, content, replyToId) {
        await requireGateway().request(Op.DMSend, {
          userId,
          content,
          ...(replyToId ? { replyToId } : {}),
        });
      },

      async editDirectMessage(messageId, content) {
        await requireGateway().request(Op.DMEdit, { messageId, content });
      },

      async deleteDirectMessage(messageId) {
        await requireGateway().request(Op.DMDelete, { messageId });
      },

      setActiveConversation(userId) {
        set({ activeConversationId: userId });
        if (userId === null) return;
        const newest = get().directHistory.get(userId)?.messages.at(-1);
        markConversationRead(userId, newest?.id ?? 0);
      },

      async refreshConversations() {
        const result = await requireGateway().request<DMListResult>(Op.DMList, {});
        const conversations = new Map(
          result.conversations.map((conversation) => [conversation.userId, conversation]),
        );
        // A thread this client opened and nobody has written in yet is not one
        // the server knows about, so it would be dropped by a list that only
        // held what came back.
        for (const [userId, held] of get().conversations) {
          if (held.id === 0 && !conversations.has(userId)) conversations.set(userId, held);
        }
        set({ conversations });
      },

      closeConversation(userId) {
        const conversations = new Map(get().conversations);
        conversations.delete(userId);
        const directHistory = new Map(get().directHistory);
        directHistory.delete(userId);
        const patch: Partial<ConnectionState> = { conversations, directHistory };
        if (get().activeConversationId === userId) {
          patch.activeConversationId = null;
        }
        set(patch);
      },

      async editMessage(messageId, content) {
        await requireGateway().request(Op.MessageEdit, { messageId, content });
      },

      async deleteMessage(messageId) {
        await requireGateway().request(Op.MessageDelete, { messageId });
      },

      async openPostChannel(channelId, options) {
        touch(channelId);
        const current = get().posts.get(channelId);
        if (current && current.loading) return;

        const postsMap = new Map(get().posts);
        postsMap.set(channelId, {
          posts: current?.posts ?? [],
          hasMore: current?.hasMore ?? false,
          loading: true,
          error: null,
        });
        set({ posts: postsMap });

        try {
          const res = await requireGateway().request<PostListResult>(Op.PostList, {
            channelId,
            from: options?.from,
            to: options?.to,
          });
          const nextMap = new Map(get().posts);
          nextMap.set(channelId, {
            posts: res.posts,
            hasMore: res.hasMore,
            loading: false,
            error: null,
          });
          set({ posts: nextMap });
        } catch (error) {
          const nextMap = new Map(get().posts);
          nextMap.set(channelId, {
            posts: current?.posts ?? [],
            hasMore: current?.hasMore ?? false,
            loading: false,
            error: describeError(error),
          });
          set({ posts: nextMap });
        }
      },

      async loadOlderPosts(channelId) {
        const current = get().posts.get(channelId);
        if (!current || current.loading || !current.hasMore) return;
        const oldest = current.posts.at(-1);
        if (!oldest) return;

        const postsMap = new Map(get().posts);
        postsMap.set(channelId, { ...current, loading: true, error: null });
        set({ posts: postsMap });

        try {
          const res = await requireGateway().request<PostListResult>(Op.PostList, {
            channelId,
            before: oldest.id,
          });
          const nextMap = new Map(get().posts);
          const seen = new Set(current.posts.map((p) => p.id));
          const newPosts = res.posts.filter((p) => !seen.has(p.id));
          nextMap.set(channelId, {
            posts: [...current.posts, ...newPosts],
            hasMore: res.hasMore,
            loading: false,
            error: null,
          });
          set({ posts: nextMap });
        } catch (error) {
          const nextMap = new Map(get().posts);
          nextMap.set(channelId, { ...current, loading: false, error: describeError(error) });
          set({ posts: nextMap });
        }
      },

      async createPost(input) {
        const res = await requireGateway().request<PostEvent>(Op.PostCreate, input);
        const current = get().posts.get(input.channelId);
        if (current) {
          const postsMap = new Map(get().posts);
          if (!current.posts.some((p) => p.id === res.post.id)) {
            postsMap.set(input.channelId, {
              ...current,
              posts: [res.post, ...current.posts],
            });
            set({ posts: postsMap });
          }
        }
        return res.post;
      },

      async updatePost(input) {
        const res = await requireGateway().request<PostEvent>(Op.PostUpdate, input);
        const post = res.post;
        const current = get().posts.get(post.channelId);
        if (current) {
          const postsMap = new Map(get().posts);
          postsMap.set(post.channelId, {
            ...current,
            posts: current.posts.map((p) => (p.id === post.id ? post : p)),
          });
          set({ posts: postsMap });
        }
      },

      async deletePost(postId) {
        const res = await requireGateway().request<PostDeletedEvent>(Op.PostDelete, { postId });
        const current = get().posts.get(res.channelId);
        if (current) {
          const postsMap = new Map(get().posts);
          postsMap.set(res.channelId, {
            ...current,
            posts: current.posts.filter((p) => p.id !== postId),
          });
          set({ posts: postsMap });
        }
        const postComments = new Map(get().postComments);
        postComments.delete(postId);
        set({ postComments });
      },

      async rsvpPost(postId, response) {
        const res = await requireGateway().request<PostRSVPEvent>(Op.PostRSVP, { postId, response });
        const current = get().posts.get(res.channelId);
        if (current) {
          const postsMap = new Map(get().posts);
          postsMap.set(res.channelId, {
            ...current,
            posts: current.posts.map((p) => {
              if (p.id !== postId) return p;
              return {
                ...p,
                rsvp: {
                  going: res.rsvp.going,
                  maybe: res.rsvp.maybe,
                  declined: res.rsvp.declined,
                  own: res.rsvp.own || response,
                },
              };
            }),
          });
          set({ posts: postsMap });
        }
      },

      async openPostComments(channelId, postId) {
        const current = get().postComments.get(postId);
        if (current && current.loading) return;

        const commentsMap = new Map(get().postComments);
        commentsMap.set(postId, {
          messages: current?.messages ?? [],
          hasMore: current?.hasMore ?? false,
          loading: true,
          error: null,
        });
        set({ postComments: commentsMap });

        try {
          const res = await requireGateway().request<MessageHistoryResult>(Op.MessageHistory, {
            channelId,
            postId,
          });
          const nextMap = new Map(get().postComments);
          nextMap.set(postId, {
            messages: res.messages,
            hasMore: res.hasMore,
            loading: false,
            error: null,
          });
          set({ postComments: nextMap });
        } catch (error) {
          const nextMap = new Map(get().postComments);
          nextMap.set(postId, {
            messages: current?.messages ?? [],
            hasMore: current?.hasMore ?? false,
            loading: false,
            error: describeError(error),
          });
          set({ postComments: nextMap });
        }
      },

      async loadOlderPostComments(channelId, postId) {
        const current = get().postComments.get(postId);
        if (!current || current.loading || !current.hasMore) return;
        const oldest = current.messages[0];
        if (!oldest) return;

        const commentsMap = new Map(get().postComments);
        commentsMap.set(postId, { ...current, loading: true, error: null });
        set({ postComments: commentsMap });

        try {
          const res = await requireGateway().request<MessageHistoryResult>(Op.MessageHistory, {
            channelId,
            postId,
            before: oldest.id,
          });
          const nextMap = new Map(get().postComments);
          const held = current.messages;
          const merged = mergeMessages(res.messages, held);
          nextMap.set(postId, {
            messages: merged,
            hasMore: res.hasMore,
            loading: false,
            error: null,
          });
          set({ postComments: nextMap });
        } catch (error) {
          const nextMap = new Map(get().postComments);
          nextMap.set(postId, { ...current, loading: false, error: describeError(error) });
          set({ postComments: nextMap });
        }
      },

      async sendPostComment(channelId, postId, content, attachments, replyToId) {
        await requireGateway().request<MessageEvent>(Op.MessageSend, {
          channelId,
          postId,
          content,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
          ...(replyToId ? { replyToId } : {}),
        });
      },

      async listWebhooks(channelId) {
        const result = await requireGateway().request<WebhookListResult>(Op.WebhookList, {
          channelId,
        });
        return result.webhooks;
      },

      async createWebhook(input) {
        const result = await requireGateway().request<WebhookEvent>(Op.WebhookCreate, input);
        return result.webhook;
      },

      async updateWebhook(input) {
        const result = await requireGateway().request<WebhookEvent>(Op.WebhookUpdate, input);
        return result.webhook;
      },

      async deleteWebhook(webhookId) {
        await requireGateway().request(Op.WebhookDelete, { webhookId });
      },

      async createRole(input) {
        await requireGateway().request(Op.RoleCreate, input);
      },

      async updateRole(input) {
        await requireGateway().request(Op.RoleUpdate, input);
      },

      async reorderRoles(roleIds) {
        await requireGateway().request(Op.RoleReorder, { roleIds });
      },

      async deleteRole(roleId) {
        await requireGateway().request(Op.RoleDelete, { roleId });
      },

      async setRoleMembership(userId, roleId, granted) {
        await requireGateway().request(granted ? Op.RoleAssign : Op.RoleUnassign, {
          userId,
          roleId,
        });
      },

      handleEvent(op, payload) {
        applyEvent(op, payload);
      },
    };
  });
}

export type {
  Activity,
  Attachment,
  Channel,
  Conversation,
  DirectMessage,
  Message,
  MessageSearchHit,
  Role,
  ServerInfo,
  User,
};
