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
import {
  AuralError,
  Ev,
  Op,
  PROTOCOL_VERSION,
  describeError,
  type Channel,
  type ChannelDeletedEvent,
  type ChannelEvent,
  type ChannelType,
  type Overwrite,
  type Ready,
  type Role,
  type RoleDeletedEvent,
  type RoleEvent,
  type ServerInfo,
  type ServerUpdatedEvent,
  type User,
  type UserDisconnectedEvent,
  type UserEvent,
  type UserMovedEvent,
} from "@/lib/protocol";
import {
  clearToken,
  getServer,
  listServers,
  removeServer,
  upsertServer,
  type SavedServer,
} from "@/lib/storage";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting";

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

  server: ServerInfo | null;
  self: User | null;
  users: Map<number, User>;
  channels: Map<number, Channel>;
  roles: Map<number, Role>;

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
  kickUser(userId: number, reason?: string): Promise<void>;

  register(username: string, password: string): Promise<void>;
  signIn(username: string, password: string): Promise<void>;
  claimAdmin(token: string): Promise<void>;
  updateServer(patch: { name?: string; description?: string }): Promise<void>;

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
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Reconnect bookkeeping lives outside the store: it is machinery, not state
 * the interface renders.
 */
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let lastOptions: ConnectOptions | null = null;
/** Guards against a stale socket writing over a newer connection's state. */
let connectionEpoch = 0;

function cancelReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
}

function indexById<T extends { id: number }>(items: T[]): Map<number, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export const useSession = create<SessionState>((set, get) => {
  /** Replaces everything the client knows, from a ready snapshot. */
  function applySnapshot(ready: Ready): void {
    set({
      server: ready.server,
      self: ready.user,
      users: indexById(ready.users),
      channels: indexById(ready.channels),
      roles: indexById(ready.roles),
    });
  }

  function applyEvent(op: string, payload: unknown): void {
    const state = get();

    switch (op) {
      case Ev.Ready:
        applySnapshot(payload as Ready);
        return;

      case Ev.UserConnected:
      case Ev.UserUpdated: {
        const { user } = payload as UserEvent;
        const users = new Map(state.users);
        users.set(user.id, user);
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
        channels.delete(event.channelId);
        for (const id of event.cascaded) channels.delete(id);
        set({ channels });
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

  function handleClose(epoch: number, info: CloseInfo): void {
    if (epoch !== connectionEpoch) return;

    const state = get();
    const wasConnected = state.status === "connected";
    set({ gateway: null });

    // A deliberate close, a kick, or a displacement: do not fight it.
    const permanent = info.code === 1000 || info.code === 1008;
    if (permanent || !lastOptions || reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      set({
        status: "idle",
        notice: wasConnected ? closeMessage(info.code, info.reason) : null,
        error: wasConnected ? null : closeMessage(info.code, info.reason),
        server: null,
        self: null,
        users: new Map(),
        channels: new Map(),
        roles: new Map(),
      });
      cancelReconnect();
      return;
    }

    const options = lastOptions;
    reconnectAttempt += 1;
    const delay = Math.min(1000 * 2 ** (reconnectAttempt - 1), 16_000);
    set({
      status: "reconnecting",
      notice: `Lost connection. Retrying in ${Math.round(delay / 1000)}s (${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS}).`,
    });

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // A reconnect never re-runs a password sign-in; the stored token is what
      // it resumes with, exactly as a fresh start would.
      void get()
        .connect({ ...options, credentials: undefined })
        .catch(() => {
          // connect() has already recorded the failure.
        });
    }, delay);
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
    server: null,
    self: null,
    users: new Map(),
    channels: new Map(),
    roles: new Map(),
    saved: listServers(),

    async connect(options) {
      const previous = get().gateway;
      cancelReconnect();
      previous?.close("switching servers");

      const epoch = ++connectionEpoch;
      const isRetry = get().status === "reconnecting";
      set({ status: isRetry ? "reconnecting" : "connecting", error: null, notice: null });

      let address: ServerAddress;
      try {
        address = parseAddress(options.address);
      } catch (error) {
        set({ status: "idle", error: error instanceof Error ? error.message : String(error) });
        throw error;
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
        const message = error instanceof Error ? error.message : String(error);
        set({ status: "idle", error: message });
        throw new Error(message);
      }

      if (gateway.hello.server.protocolVersion !== PROTOCOL_VERSION) {
        gateway.close("protocol mismatch");
        const theirs = gateway.hello.server.protocolVersion;
        const message =
          theirs > PROTOCOL_VERSION
            ? `That server speaks Aural protocol v${theirs}. Update this client.`
            : `That server speaks Aural protocol v${theirs}, which this client no longer supports.`;
        set({ status: "idle", error: message });
        throw new Error(message);
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
        const message = describeError(error);
        set({ status: "idle", error: message });
        throw new Error(message);
      }

      if (epoch !== connectionEpoch) {
        gateway.close("superseded");
        return;
      }

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
        saved: bookmarks,
      });
      applySnapshot(ready);
    },

    disconnect() {
      cancelReconnect();
      lastOptions = null;
      connectionEpoch += 1;
      get().gateway?.close("disconnected by the user");
      set({
        status: "idle",
        error: null,
        notice: null,
        gateway: null,
        address: null,
        savedId: null,
        server: null,
        self: null,
        users: new Map(),
        channels: new Map(),
        roles: new Map(),
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

export type { Channel, Role, ServerInfo, User };
