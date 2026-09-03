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
  | "uploads_disabled"
  | "dm_disabled"
  | "dm_blocked"
  | "voice_disabled"
  | "voice_failed";

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

  DMList: "dm.list",
  DMHistory: "dm.history",
  DMSend: "dm.send",
  DMEdit: "dm.edit",
  DMDelete: "dm.delete",
  DMRead: "dm.read",

  RoleCreate: "role.create",
  RoleUpdate: "role.update",
  RoleDelete: "role.delete",
  RoleAssign: "role.assign",
  RoleUnassign: "role.unassign",

  VoiceConnect: "voice.connect",
  VoiceLeave: "voice.leave",
  VoiceSignal: "voice.signal",
  VoiceState: "voice.state",
  VoiceModerate: "voice.moderate",
  VoiceSpeaking: "voice.speaking",
} as const;

/** Event ops, pushed by the server. */
export const Ev = {
  Hello: "hello",
  Ready: "ready",

  UserConnected: "user.connected",
  UserDisconnected: "user.disconnected",
  UserUpdated: "user.updated",
  UserMoved: "user.moved",
  UserRemoved: "user.removed",

  ChannelCreated: "channel.created",
  ChannelUpdated: "channel.updated",
  ChannelDeleted: "channel.deleted",

  MessageCreated: "message.created",
  MessageUpdated: "message.updated",
  MessageDeleted: "message.deleted",

  DMCreated: "dm.created",
  DMUpdated: "dm.updated",
  DMDeleted: "dm.deleted",

  RoleCreated: "role.created",
  RoleUpdated: "role.updated",
  RoleDeleted: "role.deleted",

  ServerUpdated: "server.updated",

  VoiceState: "voice.state",
  VoiceSpeaking: "voice.speaking",
  VoiceSignal: "voice.signal",
  VoicePeer: "voice.peer",
  VoiceHost: "voice.host",
  VoiceReset: "voice.reset",
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
  /** Absent from a server older than the audio plane. */
  voice?: VoiceConfig;
  uploads: UploadLimits;
  /**
   * Whether this server will proxy GIF and sticker lookups. The credential
   * behind it is the operator's and never reaches a client: this preview is
   * unauthenticated, so anything in it is public.
   */
  klipyEnabled?: boolean;
  /**
   * Whether this server carries private conversations. Absent from a server
   * older than they are, which is the same answer as `false`: a client that
   * offers them there has every send refused.
   */
  directMessages?: boolean;
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
  maxAvatarBytes?: string;
  maxBannerBytes?: string;
  /** "0" means the only ceiling is the server's disk. */
  maxTotalBytes: string;
  usedBytes: string;
  maxPerMessage: number;
}

/**
 * What a server will carry as audio, told to the client before it opens a
 * session so the encoder is configured once rather than by being refused.
 *
 * It carries no ICE servers on purpose: those may hold TURN credentials, and
 * this object travels in the unauthenticated preview at `GET /info`. They
 * arrive with the reply to `voice.connect`, which is behind an identity.
 */
export interface VoiceConfig {
  enabled: boolean;
  mode: VoiceMode;
  /**
   * The highest rate the encoder is asked for, in hertz. Opus always runs on a
   * 48 kHz clock, so this is a ceiling on quality rather than a change of
   * clock, and 44100 is deliberately not one of the values it can take.
   */
  sampleRate: number;
  /** Where a client starts. `minBitrate` and `maxBitrate` bound where it goes. */
  bitrate: number;
  minBitrate: number;
  maxBitrate: number;
  fec: boolean;
  dtx: boolean;
  stereo: boolean;
  /** 0 leaves the ceiling to the channel's own user limit. */
  maxParticipants: number;
}

/** One STUN or TURN server, in the shape `RTCConfiguration` expects. */
export interface ICEServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** One trickled ICE candidate, field for field as `RTCIceCandidate` serialises. */
export interface ICECandidateInitLike {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** Signalling frame kinds carried by `voice.signal`. */
export type SignalKind = "offer" | "answer" | "candidate" | "end";

/**
 * The peer id that addresses the server's own relay rather than another
 * client. It cannot collide with a user: identities start at 1.
 */
export const SERVER_PEER = 0;

/**
 * One participant's audio state.
 *
 * Sitting in a voice channel and holding a live audio session are different
 * things: somebody with no microphone is in the channel with `connected`
 * false. The channel is `User.channelId`; this is the audio on top of it.
 *
 * The mute flags come in pairs because they have different owners. `selfMute`
 * is the participant's own choice and theirs to undo; `mute` was imposed by a
 * moderator, or by not holding Speak, and is not.
 */
export interface VoiceState {
  userId: number;
  channelId: number;
  connected: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  mute: boolean;
  deaf: boolean;
  /** Set on the participant relaying a `client_host` channel. */
  host: boolean;
}

/** Whether any reason to stop this participant transmitting applies. */
export function isMuted(state: VoiceState): boolean {
  return state.selfMute || state.mute;
}

/** The same for receiving. */
export function isDeafened(state: VoiceState): boolean {
  return state.selfDeaf || state.deaf;
}

export type UserStatus = "online" | "idle" | "dnd" | "offline" | "invisible";

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
  status?: UserStatus;
  customStatus?: string;
  avatar?: string | null;
  banner?: string | null;
  /**
   * Who may write to this identity privately. It is only ever populated on
   * your own entry: what somebody accepts is theirs to read and nobody else's
   * to see, and finding out that a message will not be delivered is what
   * sending one is for.
   */
  dmPrivacy?: DMPrivacy;
}

/** Who may open a private conversation with somebody. */
export type DMPrivacy = "everyone" | "registered" | "none";

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
 * Everything a rendered message has, wherever it was written.
 *
 * `author` travels with every message because this client only knows the users
 * who are connected right now: presence is not persisted, so the author of an
 * older message is very often somebody it has never seen. The server resolves
 * it live, so a rename shows up throughout the history.
 *
 * It is a type of its own so that the message list can draw a channel and a
 * private conversation with one component: what differs between the two is
 * what the message hangs off, which is the one field nothing on screen reads.
 */
export interface MessageBase {
  id: number;
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

/** One post in a text channel. */
export interface Message extends MessageBase {
  channelId: number;
}

/**
 * One line of a private conversation.
 *
 * It carries no attachments: an upload is bound to the channel it was made
 * for, and a private conversation has no channel to bind one to.
 */
export interface DirectMessage extends MessageBase {
  conversationId: number;
}

/**
 * One private thread, as it looks to one of the two people in it.
 *
 * `userId` is therefore *the other one*. The same thread reaches the two sides
 * under two different names, which is what lets this client key conversations
 * by person and render the first frame that arrives without holding a map of
 * ids to people.
 */
export interface Conversation {
  id: number;
  userId: number;
  /** Unix seconds. A thread nobody has written in carries when it was opened. */
  lastMessageAt: number;
  /** What a list shows under the name. Absent until something is said. */
  lastMessage?: DirectMessage;
  /**
   * How much has arrived since this side last read it. The server keeps the
   * marker, so the badge survives a restart rather than being whatever this
   * client happened to see live.
   */
  unread: number;
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
  /**
   * The STUN and TURN servers to use.
   *
   * They arrive here as well as with a `voice.connect` reply because a
   * server-hosted session has to build its peer connection in order to produce
   * the offer that reply answers: the configuration is needed one step before
   * the reply that would otherwise carry it.
   */
  iceServers?: ICEServer[];
  /**
   * Every participant of every voice channel this client may see. Absent from
   * a server older than the audio plane.
   */
  voiceStates?: VoiceState[];
  /**
   * Every private conversation this identity is in, newest first. It is in the
   * snapshot because a badge is the whole reason to know a thread exists
   * before opening it. Absent from a server that carries none.
   */
  conversations?: Conversation[];
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
  /**
   * The audio plane, replaced whole. It is not a per-field patch because the
   * fields constrain one another: a bitrate range has to be read together to
   * be checked.
   */
  voice?: VoiceSettings;
}

/**
 * The part of the audio plane an administrator may change at runtime. The
 * deployment details — the public address, the port range, the ICE servers —
 * belong to the machine and are not here.
 */
export interface VoiceSettings {
  enabled: boolean;
  mode: VoiceMode;
  sampleRate: number;
  bitrate: number;
  minBitrate: number;
  maxBitrate: number;
  fec: boolean;
  dtx: boolean;
  stereo: boolean;
  maxParticipants: number;
}

export interface UserUpdateRequest {
  userId?: number;
  nickname?: string;
  status?: string;
  customStatus?: string;
  avatar?: string | null;
  banner?: string | null;
  /** Your own setting, and never anybody else's whatever you hold. */
  dmPrivacy?: DMPrivacy;
}

export interface UserMoveRequest {
  userId?: number;
  /** null leaves the current channel. */
  channelId: number | null;
}

export interface UserKickRequest {
  userId: number;
  reason?: string;
  deleteMessages?: "none" | "1d" | "7d" | "30d" | "all";
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

// --- private conversations ---------------------------------------------------

/** Reads every conversation the caller is in. It takes nothing. */
export type DMListRequest = Record<string, never>;

export interface DMListResult {
  conversations: Conversation[];
}

/**
 * One page of the conversation with somebody.
 *
 * It names the person rather than the thread, because a name in the member
 * list is all this client has to start from: the thread may not exist yet, and
 * asking for its history is a perfectly good way to find that out.
 */
export interface DMHistoryRequest {
  userId: number;
  before?: number;
  after?: number;
  around?: number;
  limit?: number;
}

/**
 * Ordered oldest first. A conversation nobody has opened yet comes back with a
 * zero `conversationId` and no messages rather than as an error.
 */
export interface DMHistoryResult {
  userId: number;
  conversationId: number;
  messages: DirectMessage[];
  hasMore: boolean;
  hasMoreAfter: boolean;
}

export interface DMSendRequest {
  userId: number;
  content: string;
}

export interface DMEditRequest {
  messageId: number;
  content: string;
}

export interface DMDeleteRequest {
  messageId: number;
}

/** Moves your own read marker up. It never moves backwards. */
export interface DMReadRequest {
  userId: number;
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

export interface UserRemovedEvent {
  userId: number;
  reason?: string;
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

/**
 * One private line, delivered to the two people in it. The conversation
 * travels with it because the receiving side may never have heard of it: the
 * first thing somebody says to you is also how you learn the thread exists.
 */
export interface DMCreatedEvent {
  conversation: Conversation;
  message: DirectMessage;
}

export interface DMUpdatedEvent {
  /** The other participant, as everywhere. */
  userId: number;
  message: DirectMessage;
}

export interface DMDeletedEvent {
  userId: number;
  conversationId: number;
  messageId: number;
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

// --- voice -------------------------------------------------------------------

export interface VoiceConnectRequest {
  channelId: number;
  /** The client's offer in `server_host` mode, and absent otherwise. */
  sdp?: string;
}

export interface VoiceConnectResult {
  channelId: number;
  mode: VoiceMode;
  /** The server's answer in `server_host` mode. */
  sdp?: string;
  /**
   * The peer relaying this channel in `client_host` mode. It is this client
   * when it was the one elected, which is how a first arrival learns that
   * everybody else will be dialling it.
   */
  hostUserId?: number;
  /** Increments on every election, so stale signalling can be dropped. */
  hostEpoch?: number;
  iceServers: ICEServer[];
  voice: VoiceConfig;
  /** The voice state of everybody already in the channel. */
  participants: VoiceState[];
}

export interface VoiceSignalRequest {
  /** `SERVER_PEER` addresses the relay, which is the only target in `server_host`. */
  targetId: number;
  kind: SignalKind;
  sdp?: string;
  candidate?: ICECandidateInitLike;
  /**
   * Maps an SDP media id to the user whose audio it carries. It travels with
   * an offer in `client_host` mode only.
   *
   * The server-hosted relay needs none of this: it names each participant in
   * the stream id, so a receiver reads the identity off the track. A relaying
   * browser cannot — forwarding somebody else's track gives no way to rename
   * it — so the host says which media id is whose.
   */
  tracks?: Record<string, number>;
}

export interface VoiceStateRequest {
  selfMute?: boolean;
  selfDeaf?: boolean;
}

export interface VoiceModerateRequest {
  userId: number;
  mute?: boolean;
  deaf?: boolean;
}

export interface VoiceSpeakingRequest {
  speaking: boolean;
}

export interface VoiceStateEvent {
  state: VoiceState;
}

export interface VoiceSpeakingEvent {
  userId: number;
  channelId: number;
  speaking: boolean;
}

export interface VoiceSignalEvent {
  /** `SERVER_PEER` when the server's own relay sent it. */
  fromUserId: number;
  channelId: number;
  kind: SignalKind;
  sdp?: string;
  candidate?: ICECandidateInitLike;
  /** The media-id map described on `VoiceSignalRequest`, relayed unread. */
  tracks?: Record<string, number>;
}

export interface VoicePeerEvent {
  channelId: number;
  userId: number;
  action: "add" | "remove";
  epoch: number;
}

export interface VoiceHostEvent {
  channelId: number;
  hostUserId: number | null;
  epoch: number;
}

/** Why a media session was reset. None of them is an error. */
export type VoiceResetReason = "host_changed" | "config_changed" | "failed" | "disabled";

export interface VoiceResetEvent {
  channelId: number;
  reason: VoiceResetReason;
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
    case "dm_disabled":
      return t("errors.dm_disabled");
    case "dm_blocked":
      return t("errors.dm_blocked");
    case "voice_disabled":
      return t("errors.voice_disabled");
    case "voice_failed":
      return t("errors.voice_failed");
    default:
      return error.message || t("errors.unknown");
  }
}

