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
import { mentionsSelf } from "@/lib/mentions";
import {
  AuralError,
  Ev,
  Op,
  PROTOCOL_VERSION,
  describeError,
  type Attachment,
  type Channel,
  type ChannelDeletedEvent,
  type ChannelEvent,
  type ChannelType,
  type ChannelUpdateRequest,
  type ICEServer,
  type Message,
  type MessageDeletedEvent,
  type MessageEvent,
  type MessageHistoryResult,
  type MessageSearchHit,
  type MessageSearchResult,
  type Ready,
  type Role,
  type RoleDeletedEvent,
  type RoleEvent,
  type SearchSort,
  type ServerInfo,
  type ServerUpdatedEvent,
  type User,
  type UserDisconnectedEvent,
  type UserEvent,
  type UserMovedEvent,
  type VoiceConfig,
  type VoiceSettings,
  type VoiceSpeakingEvent,
  type VoiceState,
  type VoiceStateEvent,
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
  type RunningUpload,
} from "@/lib/uploads";

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
 * How much of a channel survives being left.
 *
 * A channel stops being read the moment another one is opened, and what makes
 * coming back to it feel instant is the page under the composer, not the four
 * pages above it. Cutting the rest is the difference between a client holding
 * one full window and one holding a full window per channel ever looked at.
 */
export const IDLE_CHANNEL_WINDOW = 50;

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
  /** What is waiting, per channel. Held whether or not the messages are. */
  unread: Map<number, Unread>;
  /** The channel being read on this connection, or null. */
  activeChannelId: number | null;

  /**
   * Everybody's voice state on this server, across every channel this client
   * can see. It is per connection rather than in the voice store because user
   * ids are per server: one map for all of them would draw the mute icon of
   * whoever happened to share an id somewhere else.
   */
  voiceStates: Map<number, VoiceState>;
  /** Who is transmitting on this server right now. */
  speaking: Set<number>;

  search: SearchState;
  /** The message the view should move to, set by a jump and cleared by it. */
  jump: JumpTarget | null;

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
  updateProfile(patch: {
    nickname?: string;
    status?: string;
    customStatus?: string;
    avatar?: string | null;
    banner?: string | null;
    userId?: number;
  }): Promise<void>;
  uploadAvatar(file: File, onProgress?: (fraction: number) => void): Promise<{ url: string }>;
  uploadBanner(file: File, onProgress?: (fraction: number) => void): Promise<{ url: string }>;
  kickUser(userId: number, reason?: string): Promise<void>;

  register(username: string, password: string): Promise<void>;
  signIn(username: string, password: string): Promise<void>;
  claimAdmin(token: string): Promise<void>;
  updateServer(patch: {
    name?: string;
    description?: string;
    klipyApiKey?: string;
    /** The audio plane, replaced whole. See `VoiceSettings`. */
    voice?: VoiceSettings;
  }): Promise<void>;

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
  sendMessage(channelId: number, content: string, attachments?: number[]): Promise<void>;
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

  createRole(input: { name: string; color?: string; permissions?: string; hoist?: boolean }): Promise<void>;
  updateRole(input: {
    roleId: number;
    name?: string;
    color?: string;
    permissions?: string;
    hoist?: boolean;
  }): Promise<void>;
  deleteRole(roleId: number): Promise<void>;
  setRoleMembership(userId: number, roleId: number, granted: boolean): Promise<void>;
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
  return { ...user, online: false, status: "offline", customStatus: "", channelId: null };
}

/**
 * Combines two runs of messages into one ordered, duplicate-free list.
 *
 * A fetched page and the live event stream overlap whenever a message arrives
 * while a request is in flight, and ids are monotonic, so sorting by id both
 * orders the result and makes the overlap easy to drop.
 */
function mergeMessages(...runs: Message[][]): Message[] {
  const byId = new Map<number, Message>();
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
export function clampWindow(
  messages: Message[],
  keep: "newest" | "oldest",
  limit: number = CHANNEL_WINDOW,
): Partial<ChannelHistory> & { messages: Message[] } {
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
      useVoice.getState().exit();
      host.dropVoice();
    }

    /** Tears the media session down entirely, because the socket under it went. */
    function abandonVoice(): void {
      if (!host.ownsVoice()) return;
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

    /** Replaces everything the client knows, from a ready snapshot. */
    function applySnapshot(ready: Ready): void {
      const channels = indexById(ready.channels);

      // A snapshot can arrive mid-session as a resync, which is how the server
      // reports that what this user may see has changed. History for a channel
      // that is no longer visible goes with it; the rest is kept, so an
      // ordinary permission edit elsewhere does not blank the conversation
      // being read.
      const history = new Map(
        [...get().history].filter(([channelId]) => channels.has(channelId)),
      );
      const unread = new Map([...get().unread].filter(([channelId]) => channels.has(channelId)));
      for (const channelId of [...readAt.keys()]) {
        if (!channels.has(channelId)) readAt.delete(channelId);
      }

      // A resync can add or remove voice channels, and with them the people in
      // them. Taking the whole snapshot is the same answer the rest of the
      // state gives: rebuilding is cheaper than reconciling, and cannot drift.
      const voiceStates = new Map((ready.voiceStates ?? []).map((state) => [state.userId, state]));
      const speaking = new Set([...get().speaking].filter((userId) => voiceStates.has(userId)));

      set({
        server: ready.server,
        self: ready.user,
        users: indexById(ready.users),
        channels,
        roles: indexById(ready.roles),
        history,
        unread,
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
      if (watching) return;

      const current = state.unread.get(message.channelId) ?? { count: 0, mention: false };
      const unread = new Map(state.unread);
      unread.set(message.channelId, {
        count: current.count + 1,
        // Roles are passed as well as the user, so a message that names a
        // group this member is in counts as naming them.
        mention: current.mention || mentionsSelf(message.content, state.self, state.roles),
      });
      set({ unread });
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
          applySnapshot(payload as Ready);
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
          // The event says a connection ended, not that a person left. A member
          // drops into the offline part of the list they were always in; a guest,
          // whose identity goes with the connection, drops out of it.
          const gone = users.get(userId);
          if (gone?.registered) {
            users.set(userId, asOffline(gone));
          } else {
            users.delete(userId);
          }
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
            if (destination?.type === "voice") enterVoice(destination.id);
            else exitVoice();
          } else if (
            !host.ownsVoice() ||
            event.to === null ||
            event.to !== useVoice.getState().channelId
          ) {
            participantGone(event.userId);
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
          const unread = new Map(state.unread);
          const forgotten = [event.channelId, ...event.cascaded];
          for (const channelId of forgotten) {
            channels.delete(channelId);
            history.delete(channelId);
            unread.delete(channelId);
            readAt.delete(channelId);
          }
          set({ channels, history, unread });

          const open = host.ownsVoice() ? useVoice.getState().channelId : null;
          if (open !== null && forgotten.includes(open)) exitVoice();
          return;
        }

        case Ev.MessageCreated: {
          const { message } = payload as MessageEvent;
          noteUnread(message);

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
          const current = state.history.get(event.channelId);
          if (!current) return;

          const history = new Map(state.history);
          history.set(event.channelId, {
            ...current,
            messages: current.messages.filter((held) => held.id !== event.messageId),
          });
          set({ history });
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

        case Ev.ServerUpdated: {
          const { server } = payload as ServerUpdatedEvent;
          set({ server });
          host.savedChanged(upsertServer({ id, name: server.name }));
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
        unread: new Map(),
        activeChannelId: null,
        voiceStates: new Map(),
        speaking: new Set(),
        search: EMPTY_SEARCH,
        jump: null,
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
      unread: new Map(),
      activeChannelId: null,
      voiceStates: new Map(),
      speaking: new Set(),
      search: EMPTY_SEARCH,
      jump: null,

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

        if (gateway.hello.server.protocolVersion !== PROTOCOL_VERSION) {
          gateway.close("protocol mismatch");
          const theirs = gateway.hello.server.protocolVersion;
          const message =
            theirs > PROTOCOL_VERSION
              ? `That server speaks Aural protocol v${theirs}. Update this client.`
              : `That server speaks Aural protocol v${theirs}, which this client no longer supports.`;
          // Retrying cannot make two versions agree.
          throw fail(message, true);
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
            });
          } else if (token) {
            try {
              ready = await gateway.request<Ready>(Op.AuthToken, {
                token,
                serverPassword: options.serverPassword,
              });
            } catch (error) {
              if (!(error instanceof AuralError) || error.code !== "invalid_credentials") throw error;
              clearToken(id);
              ready = await gateway.request<Ready>(Op.AuthGuest, {
                nickname,
                serverPassword: options.serverPassword,
              });
            }
          } else {
            ready = await gateway.request<Ready>(Op.AuthGuest, {
              nickname,
              serverPassword: options.serverPassword,
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
        applySnapshot(ready);

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
          unread: new Map(),
          activeChannelId: null,
          voiceStates: new Map(),
          speaking: new Set(),
          search: EMPTY_SEARCH,
          jump: null,
        });
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
      },

      enterBackground() {
        // What a connection in the background is worth holding is presence, the
        // roster and the badges. Messages are not on that list: they are one
        // request away, stale by the time somebody looks at them, and the only
        // part of a connection whose size has no bound of its own.
        readAt.clear();
        set({
          history: new Map(),
          activeChannelId: null,
          search: EMPTY_SEARCH,
          jump: null,
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

      async kickUser(userId, reason) {
        await requireGateway().request(Op.UserKick, { userId, reason });
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
        await requireGateway().request(Op.ServerUpdate, patch);
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
          if (channelId !== null) clearUnread(channelId);
          return;
        }
        set({ activeChannelId: channelId });
        // Whatever was being read a moment ago keeps the page under its
        // composer and nothing above it. Coming back to it is instant; going
        // further back is a request, which is what it was before it was read.
        if (previous !== null) trimIdle(previous);
        if (channelId !== null) {
          touch(channelId);
          clearUnread(channelId);
        }
        pruneChannels();
      },

      markRead(channelId) {
        clearUnread(channelId);
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

      async sendMessage(channelId, content, attachments) {
        await requireGateway().request(Op.MessageSend, {
          channelId,
          content,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
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

      async editMessage(messageId, content) {
        await requireGateway().request(Op.MessageEdit, { messageId, content });
      },

      async deleteMessage(messageId) {
        await requireGateway().request(Op.MessageDelete, { messageId });
      },

      async createRole(input) {
        await requireGateway().request(Op.RoleCreate, input);
      },

      async updateRole(input) {
        await requireGateway().request(Op.RoleUpdate, input);
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
    };
  });
}

export type { Attachment, Channel, Message, MessageSearchHit, Role, ServerInfo, User };
