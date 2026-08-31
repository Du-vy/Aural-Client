/**
 * The Aural wire protocol, mirroring the Go definitions in
 * `Aural-Server/internal/protocol`. That package is the contract; this file
 * follows it. The human-readable specification lives in
 * `Aural-Server/docs/PROTOCOL.md`.
 */

/** Protocol revision this client speaks. */
export const PROTOCOL_VERSION = 1;

/** The single JSON frame exchanged over the WebSocket. */
export interface Envelope<T = unknown> {
  /** Correlates a reply with its request. Events omit it. */
  id?: string;
  op: string;
  d?: T;
  error?: ProtocolError;
}

export interface ProtocolError {
  code: ErrorCode;
  message: string;
}

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "internal"
  | "unsupported_version"
  | "server_full"
  | "server_password"
  | "guests_disabled"
  | "registration_closed"
  | "invalid_credentials"
  | "username_taken"
  | "already_registered"
  | "rate_limited";

/** Reply ops. Every request receives exactly one of these. */
export const OP_RESULT = "result";
export const OP_ERROR = "error";

/** Request ops, sent by the client. */
export const Op = {
  AuthGuest: "auth.guest",
  AuthToken: "auth.token",
  AuthLogin: "auth.login",
  AuthRegister: "auth.register",
  AuthLogout: "auth.logout",

  ServerClaimAdmin: "server.claimAdmin",
  ServerUpdate: "server.update",

  UserUpdate: "user.update",
  UserMove: "user.move",
  UserKick: "user.kick",

  ChannelCreate: "channel.create",
  ChannelUpdate: "channel.update",
  ChannelDelete: "channel.delete",

  MessageSend: "message.send",
  MessageHistory: "message.history",
  MessageEdit: "message.edit",
  MessageDelete: "message.delete",

  RoleCreate: "role.create",
  RoleUpdate: "role.update",
  RoleDelete: "role.delete",
  RoleAssign: "role.assign",
  RoleUnassign: "role.unassign",
} as const;

/** Event ops, pushed by the server. */
export const Ev = {
  Hello: "hello",
  Ready: "ready",

  UserConnected: "user.connected",
  UserDisconnected: "user.disconnected",
  UserUpdated: "user.updated",
  UserMoved: "user.moved",

  ChannelCreated: "channel.created",
  ChannelUpdated: "channel.updated",
  ChannelDeleted: "channel.deleted",

  MessageCreated: "message.created",
  MessageUpdated: "message.updated",
  MessageDeleted: "message.deleted",

  RoleCreated: "role.created",
  RoleUpdated: "role.updated",
  RoleDeleted: "role.deleted",

  ServerUpdated: "server.updated",
} as const;

export type ChannelType = "category" | "text" | "voice";
export type VoiceMode = "client_host" | "server_host";
export type ManagedRole = "" | "everyone" | "registered" | "admin";

export interface ServerInfo {
  name: string;
  description: string;
  protocolVersion: number;
  softwareVersion: string;
  maxUsers: number;
  onlineUsers: number;
  passwordProtected: boolean;
  registrationEnabled: boolean;
  guestsAllowed: boolean;
  voiceMode: VoiceMode;
}

export interface User {
  id: number;
  nickname: string;
  /** null while the user is still a guest. */
  username: string | null;
  registered: boolean;
  roles: number[];
  /** null when the user is in no voice channel. */
  channelId: number | null;
  online: boolean;
}

/** Permission masks travel as decimal strings so 64 bits survive JavaScript. */
export interface Overwrite {
  roleId: number;
  allow: string;
  deny: string;
}

export interface Channel {
  id: number;
  parentId: number | null;
  name: string;
  type: ChannelType;
  topic: string;
  position: number;
  /** Voice only. 0 means unlimited. */
  userLimit: number;
  overwrites: Overwrite[];
}

export interface Role {
  id: number;
  name: string;
  /** Empty, or a #rrggbb hex colour. */
  color: string;
  permissions: string;
  position: number;
  hoist: boolean;
  managed: ManagedRole;
}

/**
 * One post in a text channel.
 *
 * `author` travels with every message because this client only knows the users
 * who are connected right now: presence is not persisted, so the author of an
 * older message is very often somebody it has never seen. The server resolves
 * it live, so a rename shows up throughout the history.
 */
export interface Message {
  id: number;
  channelId: number;
  /** null once the author's account is gone. */
  userId: number | null;
  author: string;
  content: string;
  /** Unix seconds. */
  createdAt: number;
  editedAt: number | null;
}

export interface Hello {
  server: ServerInfo;
  heartbeatMs: number;
}

/** The full state snapshot: the reply to any auth op, and a resync event. */
export interface Ready {
  /** Only returned by auth.guest and auth.login. */
  sessionToken?: string;
  user: User;
  users: User[];
  channels: Channel[];
  roles: Role[];
  /** The caller's resolved server-wide mask. */
  permissions: string;
  server: ServerInfo;
}

// --- request payloads --------------------------------------------------------

export interface AuthGuestRequest {
  nickname: string;
  serverPassword?: string;
}

export interface AuthTokenRequest {
  token: string;
  serverPassword?: string;
}

export interface AuthLoginRequest {
  username: string;
  password: string;
  serverPassword?: string;
}

export interface AuthRegisterRequest {
  username: string;
  password: string;
}

export interface AuthRegisterResult {
  user: User;
}

export interface ClaimAdminRequest {
  token: string;
}

export interface ServerUpdateRequest {
  name?: string;
  description?: string;
}

export interface UserUpdateRequest {
  userId?: number;
  nickname?: string;
}

export interface UserMoveRequest {
  userId?: number;
  /** null leaves the current channel. */
  channelId: number | null;
}

export interface UserKickRequest {
  userId: number;
  reason?: string;
}

export interface ChannelCreateRequest {
  name: string;
  type: ChannelType;
  parentId?: number | null;
  topic?: string;
  position?: number;
  userLimit?: number;
}

export interface ChannelUpdateRequest {
  channelId: number;
  name?: string;
  topic?: string;
  /** Absent leaves the parent alone; null detaches to the tree root. */
  parentId?: number | null;
  position?: number;
  userLimit?: number;
  overwrites?: Overwrite[];
}

export interface ChannelDeleteRequest {
  channelId: number;
}

export interface MessageSendRequest {
  channelId: number;
  content: string;
}

export interface MessageHistoryRequest {
  channelId: number;
  /** Page backwards from this id, exclusive. Omitted starts at the newest. */
  before?: number;
  limit?: number;
}

/** Ordered oldest first, the order it is rendered in. */
export interface MessageHistoryResult {
  channelId: number;
  messages: Message[];
  hasMore: boolean;
}

export interface MessageEditRequest {
  messageId: number;
  content: string;
}

export interface MessageDeleteRequest {
  messageId: number;
}

export interface RoleCreateRequest {
  name: string;
  color?: string;
  permissions?: string;
  hoist?: boolean;
}

export interface RoleUpdateRequest {
  roleId: number;
  name?: string;
  color?: string;
  permissions?: string;
  position?: number;
  hoist?: boolean;
}

export interface RoleDeleteRequest {
  roleId: number;
}

export interface RoleMembershipRequest {
  userId: number;
  roleId: number;
}

// --- event payloads ----------------------------------------------------------

export interface UserEvent {
  user: User;
}

export interface UserDisconnectedEvent {
  userId: number;
}

export interface UserMovedEvent {
  userId: number;
  /** Either end is null when the viewer may not see that channel. */
  from: number | null;
  to: number | null;
}

export interface ChannelEvent {
  channel: Channel;
}

export interface ChannelDeletedEvent {
  channelId: number;
  cascaded: number[];
}

export interface MessageEvent {
  message: Message;
}

export interface MessageDeletedEvent {
  messageId: number;
  channelId: number;
}

export interface RoleEvent {
  role: Role;
}

export interface RoleDeletedEvent {
  roleId: number;
}

export interface ServerUpdatedEvent {
  server: ServerInfo;
}

/** An error reply, thrown by the gateway so callers can catch it by code. */
export class AuralError extends Error {
  readonly code: ErrorCode;

  constructor(error: ProtocolError) {
    super(error.message);
    this.name = "AuralError";
    this.code = error.code;
  }
}

/** Human wording for the error codes a user can actually act on. */
export function describeError(error: unknown): string {
  if (!(error instanceof AuralError)) {
    return error instanceof Error ? error.message : "Something went wrong.";
  }
  switch (error.code) {
    case "invalid_credentials":
      return "Those credentials are not valid.";
    case "username_taken":
      return "That username is already taken.";
    case "registration_closed":
      return "This server is not accepting new accounts.";
    case "guests_disabled":
      return "This server only accepts registered accounts.";
    case "server_password":
      return "The server password is missing or wrong.";
    case "server_full":
      return "This server is full.";
    case "forbidden":
      return error.message || "You are not allowed to do that.";
    case "rate_limited":
      return "Too many attempts. Try again in a moment.";
    default:
      return error.message || "Something went wrong.";
  }
}
