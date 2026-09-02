/**
 * The session store: one server connection and everything the client knows
 * about it.
 *
 * State is driven almost entirely by server events. An action sends its request
 * and then does nothing with the reply, because the server broadcasts the
 * resulting change back to everyone, the caller included. That keeps one code
 * path for "something changed" instead of two that can disagree.
 */

import { create } from "zustand";

import { parseAddress, type ServerAddress } from "@/lib/address";
import { Gateway, closeMessage, type CloseInfo } from "@/lib/gateway";
import { t } from "@/lib/i18n";
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
  type Message,
  type MessageDeletedEvent,
  type MessageEvent,
  type MessageHistoryResult,
  type MessageSearchHit,
  type MessageSearchResult,
  type Overwrite,
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
  type VoiceSettings,
} from "@/lib/protocol";
import {
  clearToken,
  getServer,
  listServers,
  removeServer,
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

export interface ConnectOptions {
  address: string;
  nickname?: string;
  serverPassword?: string;
  credentials?: { username: string; password: string };
  /** Ignore any stored token and take a fresh guest identity. */
  asNewGuest?: boolean;
}

interface SessionState {
  status: ConnectionStatus;
  /** Why the last connection attempt failed, for the connect screen. */
  error: string | null;
  /** Transient message about the live connection, such as a kick reason. */
  notice: string | null;

  address: ServerAddress | null;
  savedId: string | null;
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
  /** Per text channel, keyed by channel id. Absent until first opened. */
  history: Map<number, ChannelHistory>;

  search: SearchState;
  /** The message the view should move to, set by a jump and cleared by it. */
  jump: JumpTarget | null;

  /** Saved server bookmarks, mirrored from localStorage. */
  saved: SavedServer[];

  connect(options: ConnectOptions): Promise<void>;
  disconnect(): void;
  forget(id: string): void;
  dismissNotice(): void;

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
  updateChannel(input: {
    channelId: number;
    name?: string;
    topic?: string;
    userLimit?: number;
    overwrites?: Overwrite[];
  }): Promise<void>;
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
 * Reconnect bookkeeping lives outside the store: it is machinery, not state
 * the interface renders.
 */
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let lastOptions: ConnectOptions | null = null;
/**
 * The channel to re-enter once a dropped connection comes back.
 *
 * Channel membership is not persisted by the server — a user is in a channel
 * for as long as their connection lasts — so a reconnected session arrives
 * sitting nowhere. Remembering it here is what makes a dropped call resume
 * instead of quietly ending.
 */
let resumeChannelId: number | null = null;
/** Guards against a stale socket writing over a newer connection's state. */
let connectionEpoch = 0;
/**
 * The connection a retry has already been programmed for.
 *
 * One lost connection can report itself twice — the socket closes, and the
 * request that was in flight on it then rejects — and both reports are honest.
 * Counting the attempt once per connection is what keeps a single drop from
 * spending two of them.
 */
let scheduledEpoch = 0;
/** Distinguishes one jump from the next, including a repeat of the same one. */
let jumpNonce = 1;

/**
 * Clears a pending retry without forgetting how many have been made.
 *
 * This is what a reconnect attempt itself uses. Forgetting the count here is
 * what would flatten the backoff to its first step and put the attempt ceiling
 * out of reach, since every retry runs through connect().
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

export const useSession = create<SessionState>((set, get) => {
  /** Replaces everything the client knows, from a ready snapshot. */
  function applySnapshot(ready: Ready): void {
    const channels = indexById(ready.channels);

    // A snapshot can arrive mid-session as a resync, which is how the server
    // reports that what this user may see has changed. History for a channel
    // that is no longer visible goes with it; the rest is kept, so an ordinary
    // permission edit elsewhere does not blank the conversation being read.
    const history = new Map(
      [...get().history].filter(([channelId]) => channels.has(channelId)),
    );

    set({
      server: ready.server,
      self: ready.user,
      users: indexById(ready.users),
      channels,
      roles: indexById(ready.roles),
      history,
    });

    // A resync can add or remove voice channels, and with them the people in
    // them. Handing the whole snapshot over is the same answer the rest of the
    // state gives: rebuilding is cheaper than reconciling, and cannot drift.
    useVoice.getState().attach(
      {
        selfId: ready.user.id,
        serverId: get().savedId,
        request: (op, payload) => requireGateway().request(op, payload),
      },
      ready.server.voice,
      ready.iceServers ?? [],
      ready.voiceStates ?? [],
    );
    const own = ready.user.channelId === null ? null : channels.get(ready.user.channelId);
    if (own?.type === "voice") useVoice.getState().enter(own.id);
  }

  /** Applies a patch to one channel's history entry, creating it if needed. */
  function patchHistory(channelId: number, patch: Partial<ChannelHistory>): void {
    const history = new Map(get().history);
    history.set(channelId, { ...(history.get(channelId) ?? EMPTY_HISTORY), ...patch });
    set({ history });
  }

  function applyEvent(op: string, payload: unknown): void {
    const state = get();

    // The audio plane keeps its own state. Everything about it arrives here
    // because there is one socket, and goes straight on because there is
    // nothing in this store that needs to know.
    if (op.startsWith("voice.")) {
      useVoice.getState().handleEvent(op, payload);
      return;
    }

    switch (op) {
      case Ev.Ready:
        applySnapshot(payload as Ready);
        return;

      case Ev.UserConnected:
      case Ev.UserUpdated: {
        const { user } = payload as UserEvent;
        const users = new Map(state.users);
        // This map holds who is connected, and nobody else: a genuinely
        // offline user never reaches it. So an entry that looks offline could
        // only ever be somebody hiding, which is exactly what it would give
        // away. A server that masks presence properly never sends one; this is
        // what keeps an older or patched one from undoing the hiding.
        if (user.id !== state.self?.id && (user.status === "offline" || !user.online)) {
          users.delete(user.id);
        } else {
          users.set(user.id, user);
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
        users.delete(userId);
        set({ users });
        useVoice.getState().participantGone(userId);
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
        // asked to or a moderator moved it. There is one path either way.
        const voice = useVoice.getState();
        const destination = event.to === null ? null : state.channels.get(event.to);
        if (state.self?.id === event.userId) {
          if (destination?.type === "voice") voice.enter(destination.id);
          else voice.exit();
        } else if (event.to === null || event.to !== voice.channelId) {
          voice.participantGone(event.userId);
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
        channels.delete(event.channelId);
        history.delete(event.channelId);
        for (const id of event.cascaded) {
          channels.delete(id);
          history.delete(id);
        }
        set({ channels, history });

        const open = useVoice.getState().channelId;
        if (open !== null && (open === event.channelId || event.cascaded.includes(open))) {
          useVoice.getState().exit();
        }
        return;
      }

      case Ev.MessageCreated: {
        const { message } = payload as MessageEvent;
        // A channel this client has never opened is left alone: it will fetch
        // the newest page, this message included, when it is first opened.
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
          messages: [...current.messages, message],
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
        for (const [id, user] of users) {
          if (user.roles.includes(roleId)) {
            users.set(id, { ...user, roles: user.roles.filter((r) => r !== roleId) });
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
        if (state.savedId) {
          set({ saved: upsertServer({ id: state.savedId, name: server.name }) });
        }
        return;
      }

      default:
        // An event from a newer server than this client understands.
        return;
    }
  }

  /**
   * Drops everything this connection held and returns to the connect screen.
   *
   * `wasConnected` decides where the message goes: a session that was up
   * reports what ended it as a notice over the connect screen, while one that
   * never came up reports it as the error of the attempt.
   */
  function endSession(message: string, wasConnected: boolean): void {
    cancelReconnect();
    resumeChannelId = null;
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
      search: EMPTY_SEARCH,
      jump: null,
    });
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
    useVoice.getState().detach();

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
    if (!get().channels.has(channelId)) return;
    try {
      await requireGateway().request(Op.UserMove, { channelId });
    } catch {
      // The channel is gone, full, or no longer visible. Coming back to the
      // server at all was the part worth insisting on.
    }
  }

  /** The gateway of a live connection, or a thrown error explaining why not. */
  function requireGateway(): Gateway {
    const { gateway } = get();
    if (!gateway || !gateway.isOpen) {
      throw new Error("Not connected.");
    }
    return gateway;
  }

  return {
    status: "idle",
    error: null,
    notice: null,
    address: null,
    savedId: null,
    gateway: null,
    token: null,
    server: null,
    self: null,
    users: new Map(),
    channels: new Map(),
    roles: new Map(),
    history: new Map(),
    search: EMPTY_SEARCH,
    jump: null,
    saved: listServers(),

    async connect(options) {
      const previous = get().gateway;
      // The timer goes, the attempt count stays: this call may well be the
      // retry that timer was going to make.
      clearReconnectTimer();
      previous?.close("switching servers");

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

      let address: ServerAddress;
      try {
        address = parseAddress(options.address);
      } catch (error) {
        // A malformed address is not something a retry can improve on.
        throw fail(error instanceof Error ? error.message : String(error), true);
      }

      const saved = getServer(address.label);
      const nickname = options.nickname?.trim() || saved?.nickname || "Guest";
      lastOptions = { ...options, address: address.raw, nickname };

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
            clearToken(address.label);
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
      const bookmarks = upsertServer({
        id: address.label,
        address: address.raw,
        name: ready.server.name,
        nickname: ready.user.nickname,
        lastConnectedAt: Date.now(),
        ...(ready.sessionToken ? { token: ready.sessionToken } : {}),
        ...(ready.user.username ? { username: ready.user.username } : {}),
      });

      set({
        status: "connected",
        error: null,
        notice: null,
        address,
        savedId: address.label,
        gateway,
        token: ready.sessionToken ?? token ?? null,
        saved: bookmarks,
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
      useVoice.getState().detach();
      get().gateway?.close("disconnected by the user");
      set({
        status: "idle",
        error: null,
        notice: null,
        gateway: null,
        address: null,
        savedId: null,
        token: null,
        server: null,
        self: null,
        users: new Map(),
        channels: new Map(),
        roles: new Map(),
        history: new Map(),
        search: EMPTY_SEARCH,
        jump: null,
      });
    },

    forget(id) {
      set({ saved: removeServer(id) });
    },

    dismissNotice() {
      set({ notice: null });
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
      const { savedId, self } = get();
      if (savedId && (userId === undefined || userId === self?.id)) {
        set({ saved: upsertServer({ id: savedId, nickname }) });
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
      const { savedId, self } = get();
      if (patch.nickname && savedId && (patch.userId === undefined || patch.userId === self?.id)) {
        set({ saved: upsertServer({ id: savedId, nickname: patch.nickname }) });
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
      const { savedId } = get();
      if (savedId) set({ saved: upsertServer({ id: savedId, username }) });
    },

    async signIn(username, password) {
      const { address } = get();
      if (!address) throw new Error("Not connected.");
      // Signing in as somebody else is a new session, not a change to this one.
      await get().connect({ address: address.raw, credentials: { username, password } });
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
          messages: mergeMessages(page.messages, held),
          hasMore: page.hasMore,
          hasMoreAfter: false,
          loading: false,
          error: null,
        });
      } catch (error) {
        patchHistory(channelId, { loading: false, error: describeError(error) });
      }
    },

    async loadOlder(channelId) {
      const current = get().history.get(channelId);
      if (!current || current.loading || !current.hasMore) return;
      const oldest = current.messages[0];
      if (!oldest) return;

      patchHistory(channelId, { loading: true, error: null });
      try {
        const page = await requireGateway().request<MessageHistoryResult>(Op.MessageHistory, {
          channelId,
          before: oldest.id,
        });
        const held = get().history.get(channelId)?.messages ?? [];
        // hasMoreAfter is left alone: this page says nothing about the end of
        // the channel the reader is not at.
        patchHistory(channelId, {
          messages: mergeMessages(page.messages, held),
          hasMore: page.hasMore,
          loading: false,
          error: null,
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

      patchHistory(channelId, { loading: true, error: null });
      try {
        const page = await requireGateway().request<MessageHistoryResult>(Op.MessageHistory, {
          channelId,
          after: newest.id,
        });
        const held = get().history.get(channelId)?.messages ?? [];
        patchHistory(channelId, {
          messages: mergeMessages(held, page.messages),
          hasMoreAfter: page.hasMoreAfter,
          loading: false,
          error: null,
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

    async jumpToMessage(channelId, messageId) {
      set({ jump: { channelId, messageId, nonce: jumpNonce++ } });

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
          search: { ...get().search, hits: [], total: 0, loading: false, error: describeError(error) },
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
      const { address, savedId, token: live } = get();
      // The upload endpoint authenticates with the same token the WebSocket
      // resumes with. The live one is preferred over the stored one, which may
      // never have been written where storage is unavailable.
      const token = live ?? (savedId ? getServer(savedId)?.token : undefined);
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
      await requireGateway().request(granted ? Op.RoleAssign : Op.RoleUnassign, { userId, roleId });
    },
  };
});

export type { Attachment, Channel, Message, MessageSearchHit, Role, ServerInfo, User };
