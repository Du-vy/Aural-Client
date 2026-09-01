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
  | "rate_limited"
  | "too_large"
  | "storage_full"
  | "uploads_disabled";

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
  MessageSearch: "message.search",
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
  uploads: UploadLimits;
  klipyApiKey?: string;
}

/**
 * What a server accepts as an attachment, told to the client before it sends
 * anything so a file that is too large is refused in the picker rather than
 * after a long transfer. Byte counts are decimal strings for the same reason
 * permission masks are.
 */
export interface UploadLimits {
  enabled: boolean;
  maxFileBytes: string;
  /** "0" means the only ceiling is the server's disk. */
  maxTotalBytes: string;
  usedBytes: string;
  maxPerMessage: number;
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
  /** Files posted with the message. They are deleted along with it. */
  attachments?: Attachment[];
}

/**
 * One file carried by a message.
 *
 * `url` is relative to the server root, so it is resolved against the address
 * this client connected to. It carries an unguessable key and needs no further
 * authentication, which is what lets it be handed straight to an `<img>`,
 * `<audio>` or `<video>` tag.
 */
export interface Attachment {
  id: number;
  filename: string;
  contentType: string;
  /** Decimal string: a file may be larger than 2^53 bytes. */
  size: string;
  url: string;
  /** Set for images whose dimensions the server could read. */
  width?: number;
  height?: number;
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
  klipyApiKey?: string;
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
  /**
   * Ids returned by `POST /upload`. A message may carry files with no text of
   * its own, which is the one case where empty content is accepted.
   */
  attachments?: number[];
}

/**
 * One page of a channel.
 *
 * The three cursors are exclusive of one another and all are exclusive of the
 * message they name. Sending none of them reads the newest page.
 */
export interface MessageHistoryRequest {
  channelId: number;
  /** Page backwards, stopping short of this id. */
  before?: number;
  /** Page forwards, starting past this id: the walk back to the present. */
  after?: number;
  /** Centre the page on this id, which is how a search result is opened. */
  around?: number;
  limit?: number;
}

/** Ordered oldest first, the order it is rendered in. */
export interface MessageHistoryResult {
  channelId: number;
  messages: Message[];
  /** Whether older messages remain before the first one here. */
  hasMore: boolean;
  /**
   * Whether newer messages remain past the last one here, which is how the
   * client knows it is holding the present rather than a window behind it.
   */
  hasMoreAfter: boolean;
}

/** How a page of search results is ordered. */
export type SearchSort = "newest" | "oldest" | "relevance";

/** Kinds of content a search can require a message to carry. */
export type SearchHas = "link" | "file" | "image" | "video" | "sound";

/**
 * A search across every channel the caller may read.
 *
 * Every field narrows the result and they are combined with AND: a query with
 * two channels and an author means "this text, by them, in either channel".
 * Entries within one field are alternatives, which is what a row of filter
 * chips reads as.
 */
export interface MessageSearchRequest {
  /**
   * Free text. Whitespace separates terms, all of which must appear in the
   * message; double quotes hold a phrase together.
   */
  query?: string;
  channelIds?: number[];
  authorIds?: number[];
  has?: SearchHas[];
  /** Unix seconds. `after` is inclusive, `before` exclusive. */
  after?: number;
  before?: number;
  sort?: SearchSort;
  limit?: number;
  offset?: number;
}

/**
 * One match and the conversation immediately around it. The neighbours travel
 * with the hit because a line of chat rarely means anything alone: what makes
 * a result recognisable is the message it was answering.
 */
export interface MessageSearchHit {
  message: Message;
  before?: Message;
  after?: Message;
}

export interface MessageSearchResult {
  hits: MessageSearchHit[];
  /** How many messages matched in all, not just on this page. */
  total: number;
  offset: number;
  limit: number;
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

import { t } from "./i18n";

/** Human wording for the error codes a user can actually act on. */
export function describeError(error: unknown): string {
  if (!(error instanceof AuralError)) {
    return error instanceof Error ? error.message : t("errors.unknown");
  }
  switch (error.code) {
    case "invalid_credentials":
      return t("errors.invalid_credentials");
    case "username_taken":
      return t("errors.username_taken");
    case "registration_closed":
      return t("errors.registration_closed");
    case "guests_disabled":
      return t("errors.guests_disabled");
    case "server_password":
      return t("errors.server_password");
    case "server_full":
      return t("errors.server_full");
    case "forbidden":
      return t("errors.forbidden");
    case "rate_limited":
      return t("errors.rate_limited");
    case "bad_request":
      return t("errors.bad_request");
    case "unauthorized":
      return t("errors.unauthorized");
    case "not_found":
      return t("errors.not_found");
    case "conflict":
      return t("errors.conflict");
    case "internal":
      return t("errors.internal");
    case "unsupported_version":
      return t("errors.unsupported_version");
    case "already_registered":
      return t("errors.already_registered");
    case "too_large":
      return t("errors.too_large");
    case "storage_full":
      return t("errors.storage_full");
    case "uploads_disabled":
      return t("errors.uploads_disabled");
    default:
      return error.message || t("errors.unknown");
  }
}

