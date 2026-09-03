/**
 * The permission bitmask and its resolution rules, mirroring
 * `Aural-Server/internal/permissions`.
 *
 * The client resolves permissions itself so the interface can disable what a
 * user cannot do instead of letting them try and be refused. The server remains
 * the authority: every check here is repeated there.
 *
 * Masks are bigints because the wire format is a 64-bit value carried as a
 * decimal string, which a JavaScript number cannot represent past 2^53.
 */

import type { Channel, Role } from "./protocol";

export const Perm = {
  ViewChannel: 1n << 0n,
  Connect: 1n << 1n,
  Speak: 1n << 2n,
  SendMessages: 1n << 3n,
  ChangeNickname: 1n << 4n,
  Register: 1n << 5n,
  AttachFiles: 1n << 6n,
  /**
   * Private conversations. They are between two people rather than in any
   * channel, so no overwrite reaches them and this bit is only ever read from
   * the server-wide mask.
   */
  SendDirectMessages: 1n << 7n,

  ManageChannels: 1n << 8n,
  ManageRoles: 1n << 9n,
  ManageServer: 1n << 10n,
  ManageNicknames: 1n << 11n,
  /** Other people's messages. Deleting your own needs no permission. */
  ManageMessages: 1n << 12n,

  KickUsers: 1n << 16n,
  MoveUsers: 1n << 17n,
  MuteUsers: 1n << 18n,
  DeafenUsers: 1n << 19n,

  /** Bypasses every other check. */
  Administrator: 1n << 31n,
} as const;

export type PermissionName = keyof typeof Perm;

export const NONE = 0n;

/** Declaration order, used wherever permissions are listed to a user. */
export const PERMISSION_ORDER: PermissionName[] = [
  "ViewChannel",
  "Connect",
  "Speak",
  "SendMessages",
  "ChangeNickname",
  "Register",
  "AttachFiles",
  "SendDirectMessages",
  "ManageChannels",
  "ManageRoles",
  "ManageServer",
  "ManageNicknames",
  "ManageMessages",
  "KickUsers",
  "MoveUsers",
  "MuteUsers",
  "DeafenUsers",
  "Administrator",
];

import { t } from "./i18n";

/** One-line explanations, shown beside each permission in the role editor. */
export const PERMISSION_HELP: Record<PermissionName, string> = {
  ViewChannel: "See a channel and who is in it",
  Connect: "Join a voice channel",
  Speak: "Transmit in a voice channel",
  SendMessages: "Send messages in a text channel",
  ChangeNickname: "Change their own nickname",
  Register: "Claim their identity as an account",
  AttachFiles: "Post files alongside a message",
  SendDirectMessages: "Write to another member privately",
  ManageChannels: "Create, edit and delete channels",
  ManageRoles: "Manage roles and channel permissions",
  ManageServer: "Rename the server",
  ManageNicknames: "Change other members' nicknames",
  ManageMessages: "Delete other members' messages",
  KickUsers: "Disconnect a member",
  MoveUsers: "Move a member between voice channels",
  MuteUsers: "Mute a member in voice",
  DeafenUsers: "Deafen a member in voice",
  Administrator: "Every permission, unconditionally",
};

export function getPermissionName(name: PermissionName): string {
  return t(`permissions.names.${name}` as any);
}

export function getPermissionHelp(name: PermissionName): string {
  return t(`permissions.help.${name}` as any);
}


export const ALL: bigint = PERMISSION_ORDER.reduce((mask, name) => mask | Perm[name], NONE);

/** Reads a decimal string mask. Anything unparseable resolves to no permissions. */
export function parse(mask: string | undefined | null): bigint {
  if (!mask) return NONE;
  try {
    return BigInt(mask) & ALL;
  } catch {
    return NONE;
  }
}

/** Renders a mask as the decimal string the wire format expects. */
export function format(mask: bigint): string {
  return (mask & ALL).toString(10);
}

/** Whether every bit in `want` is set. Administrator satisfies any request. */
export function has(mask: bigint, want: bigint): boolean {
  if (mask & Perm.Administrator) return true;
  return (mask & want) === want;
}

/** Whether a specific bit is literally set, ignoring Administrator. */
export function isSet(mask: bigint, bit: bigint): boolean {
  return (mask & bit) === bit;
}

/** The set bits, in declaration order. */
export function names(mask: bigint): PermissionName[] {
  return PERMISSION_ORDER.filter((name) => (mask & Perm[name]) !== NONE);
}

/** Unions the masks of a set of roles. */
export function resolve(roles: Role[]): bigint {
  let base = NONE;
  for (const role of roles) base |= parse(role.permissions);
  return base & Perm.Administrator ? ALL : base;
}

/**
 * Applies the overwrites of one channel on top of a mask.
 *
 * The everyone overwrite lands first, then the union of the overwrites of every
 * other role held, denies before allows at each step. An explicit allow on any
 * role therefore beats a deny on another.
 */
export function resolveInChannel(
  base: bigint,
  everyoneRoleId: number,
  roleIds: readonly number[],
  channel: Pick<Channel, "overwrites">,
): bigint {
  if (base & Perm.Administrator) return ALL;

  const byRole = new Map(channel.overwrites.map((ow) => [ow.roleId, ow]));
  let mask = base;

  const everyone = byRole.get(everyoneRoleId);
  if (everyone) {
    mask &= ~parse(everyone.deny);
    mask |= parse(everyone.allow);
  }

  let allow = NONE;
  let deny = NONE;
  for (const roleId of roleIds) {
    if (roleId === everyoneRoleId) continue;
    const ow = byRole.get(roleId);
    if (!ow) continue;
    allow |= parse(ow.allow);
    deny |= parse(ow.deny);
  }
  mask &= ~deny;
  mask |= allow;

  // A channel nobody may see is a channel nobody may act in.
  return mask & Perm.ViewChannel ? mask : NONE;
}

/**
 * Walks the channel tree from the outermost category down to `channelId`,
 * applying overwrites at every level. Overwrites therefore inherit downwards:
 * denying ViewChannel on a category hides everything inside it.
 */
export function resolveChannelPermissions(
  base: bigint,
  everyoneRoleId: number,
  roleIds: readonly number[],
  channelId: number,
  channels: ReadonlyMap<number, Channel>,
): bigint {
  const chain: Channel[] = [];
  let cursor: number | null = channelId;
  // The tree is shallow by construction; the bound only guards against a cycle.
  for (let depth = 0; depth < 32 && cursor !== null; depth += 1) {
    const channel: Channel | undefined = channels.get(cursor);
    if (!channel) break;
    chain.unshift(channel);
    cursor = channel.parentId;
  }

  let mask = base;
  for (const channel of chain) {
    mask = resolveInChannel(mask, everyoneRoleId, roleIds, channel);
    if (mask === NONE) return NONE;
  }
  return mask;
}

/** The top of a role stack, which is what decides who may act on whom. */
export function highestPosition(roles: Role[]): number {
  return roles.reduce((highest, role) => Math.max(highest, role.position), 0);
}
