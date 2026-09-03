/**
 * Derived views over the session state. The client resolves permissions itself
 * so the interface can disable what a user cannot do rather than letting them
 * try and be refused; the server checks everything again regardless.
 */

import {
  ALL,
  NONE,
  Perm,
  has,
  parse,
  resolve,
  resolveChannelPermissions,
} from "@/lib/permissions";
import type { Channel, Role, User } from "@/lib/protocol";
import type { Unread } from "./connection";
import { useSession } from "./session";

export interface ChannelNode {
  channel: Channel;
  children: Channel[];
}

/**
 * Builds the render order of the tree: loose channels first, then categories
 * with their children, each group ordered by position.
 */
export function buildChannelTree(channels: ReadonlyMap<number, Channel>): ChannelNode[] {
  const byPosition = (a: Channel, b: Channel) => a.position - b.position || a.id - b.id;

  const roots: Channel[] = [];
  const children = new Map<number, Channel[]>();

  for (const channel of channels.values()) {
    if (channel.parentId === null) {
      roots.push(channel);
      continue;
    }
    // A child whose parent is not visible is promoted rather than hidden: the
    // server already decided the child itself may be seen.
    if (!channels.has(channel.parentId)) {
      roots.push(channel);
      continue;
    }
    const siblings = children.get(channel.parentId) ?? [];
    siblings.push(channel);
    children.set(channel.parentId, siblings);
  }

  roots.sort((a, b) => {
    const aCategory = a.type === "category" ? 1 : 0;
    const bCategory = b.type === "category" ? 1 : 0;
    return aCategory - bCategory || byPosition(a, b);
  });

  return roots.map((channel) => ({
    channel,
    children: (children.get(channel.id) ?? []).sort(byPosition),
  }));
}

/** The managed everyone role, which every user holds implicitly. */
export function everyoneRoleId(roles: ReadonlyMap<number, Role>): number {
  for (const role of roles.values()) {
    if (role.managed === "everyone") return role.id;
  }
  return 0;
}

function rolesOf(user: User | null, roles: ReadonlyMap<number, Role>): Role[] {
  if (!user) return [];
  return user.roles.map((id) => roles.get(id)).filter((role): role is Role => role !== undefined);
}

/**
 * The rank of whoever owns the server. It sits above every role position, which
 * is what puts the owner out of everybody's reach: no role can be moved high
 * enough to match it, so nobody may act on the owner and no role is above the
 * owner's reach — the managed `admin` role included.
 */
export const OWNER_RANK = Number.POSITIVE_INFINITY;

/**
 * What one member may do, which is everything when they own the server.
 *
 * Ownership is a property of the identity rather than a role it holds, exactly
 * as in Discord: it grants every permission, and stripping the owner of every
 * role changes none of it.
 */
export function permissionsOf(user: User | null, roles: ReadonlyMap<number, Role>): bigint {
  if (!user) return NONE;
  if (user.owner) return ALL;
  return resolve(rolesOf(user, roles));
}

/** A member's rank, which is what decides who they may act on. */
export function rankOf(user: User | null, roles: ReadonlyMap<number, Role>): number {
  if (!user) return 0;
  if (user.owner) return OWNER_RANK;
  return rolesOf(user, roles).reduce((highest, role) => Math.max(highest, role.position), 0);
}

/** The caller's resolved server-wide mask. */
export function useMyPermissions(): bigint {
  return useSession((state) => permissionsOf(state.self, state.roles));
}

/** The caller's mask inside one channel, overwrites and inheritance included. */
export function useChannelPermissions(channelId: number | null): bigint {
  return useSession((state) => {
    if (!state.self) return NONE;
    const base = permissionsOf(state.self, state.roles);
    if (channelId === null) return base;
    return resolveChannelPermissions(
      base,
      everyoneRoleId(state.roles),
      state.self.roles,
      channelId,
      state.channels,
    );
  });
}

/**
 * The text channels a user may create a webhook in.
 *
 * A webhook belongs to one channel, so the permission is asked per channel
 * rather than server-wide: somebody may hold it in one place and nowhere else,
 * and the picker must offer exactly the places they hold it.
 *
 * It is a plain function rather than a hook because it builds a fresh array,
 * and a selector that does that hands React a new snapshot on every render.
 * Callers hold it behind a `useMemo`, exactly as they do `buildChannelTree`.
 */
export function manageableWebhookChannels(
  self: User | null,
  roles: ReadonlyMap<number, Role>,
  channels: ReadonlyMap<number, Channel>,
): Channel[] {
  if (!self) return [];
  const base = permissionsOf(self, roles);
  const everyone = everyoneRoleId(roles);

  const out: Channel[] = [];
  for (const channel of channels.values()) {
    if (channel.type !== "text") continue;
    const mask = resolveChannelPermissions(base, everyone, self.roles, channel.id, channels);
    if (has(mask, Perm.ManageWebhooks)) out.push(channel);
  }
  return out.sort((a, b) => a.position - b.position || a.id - b.id);
}

/** Whether the caller holds a permission, optionally scoped to a channel. */
export function useCan(want: bigint, channelId: number | null = null): boolean {
  const mask = useChannelPermissions(channelId);
  return has(mask, want);
}

/** Everyone currently sitting in a voice channel, nicknames sorted. */
export function usersInChannel(users: ReadonlyMap<number, User>, channelId: number): User[] {
  return [...users.values()]
    .filter((user) => user.channelId === channelId)
    .sort((a, b) => a.nickname.localeCompare(b.nickname));
}

/**
 * The role that gives a member their colour: the highest-positioned role they
 * hold that actually sets one.
 */
export function colorRoleOf(user: User, roles: ReadonlyMap<number, Role>): Role | null {
  let best: Role | null = null;
  for (const id of user.roles) {
    const role = roles.get(id);
    if (!role || !role.color) continue;
    if (!best || role.position > best.position) best = role;
  }
  return best;
}

/**
 * The role a member is listed under: the highest-positioned hoisted role they
 * hold. Members with none are grouped together at the bottom.
 */
export function hoistRoleOf(user: User, roles: ReadonlyMap<number, Role>): Role | null {
  let best: Role | null = null;
  for (const id of user.roles) {
    const role = roles.get(id);
    if (!role || !role.hoist) continue;
    if (!best || role.position > best.position) best = role;
  }
  return best;
}

export interface MemberGroup {
  key: string;
  label: string;
  color: string | null;
  members: User[];
}

/**
 * Whether a member is here right now.
 *
 * The list carries everybody with an account, so being in it says nothing
 * about being around. A member who is hiding arrives looking exactly like one
 * who is away, which is the point: there is nothing here to tell them apart
 * with, and nothing that tries.
 */
export function isOnline(user: User): boolean {
  return user.online && user.status !== "offline";
}

/**
 * Groups the member list by hoisted role, highest first, as Discord does.
 *
 * Members who are not connected go in one group at the bottom rather than
 * under their role. A role's group answers who is around to be called on, and
 * a name in it that cannot answer is worse than no name at all.
 */
export function groupMembers(
  users: ReadonlyMap<number, User>,
  roles: ReadonlyMap<number, Role>,
): MemberGroup[] {
  const grouped = new Map<number, User[]>();
  const ungrouped: User[] = [];
  const offline: User[] = [];

  for (const user of users.values()) {
    if (!isOnline(user)) {
      offline.push(user);
      continue;
    }
    const role = hoistRoleOf(user, roles);
    if (!role) {
      ungrouped.push(user);
      continue;
    }
    const bucket = grouped.get(role.id) ?? [];
    bucket.push(user);
    grouped.set(role.id, bucket);
  }

  const byNickname = (a: User, b: User) => a.nickname.localeCompare(b.nickname);

  const groups: MemberGroup[] = [...grouped.entries()]
    .map(([roleId, members]) => {
      const role = roles.get(roleId)!;
      return {
        key: `role-${roleId}`,
        label: role.name,
        color: role.color || null,
        members: members.sort(byNickname),
        position: role.position,
      };
    })
    .sort((a, b) => b.position - a.position)
    .map(({ position: _position, ...group }) => group);

  if (ungrouped.length > 0) {
    groups.push({
      key: "members",
      label: "Online",
      color: null,
      members: ungrouped.sort(byNickname),
    });
  }
  if (offline.length > 0) {
    groups.push({
      key: "offline",
      label: "Offline",
      color: null,
      members: offline.sort(byNickname),
    });
  }
  return groups;
}

/** The caller's rank, which decides who they may act on. */
export function useMyRank(): number {
  return useSession((state) => rankOf(state.self, state.roles));
}

/** Whether the caller outranks a member, and so may moderate them. */
export function outranks(
  self: User | null,
  target: User,
  roles: ReadonlyMap<number, Role>,
): boolean {
  if (!self || self.id === target.id) return false;
  return rankOf(self, roles) > rankOf(target, roles);
}

/**
 * Roles the caller may hand out: granted by hand, and ranked below their own.
 *
 * The managed `admin` role is at the top of the stack, so it is on this list
 * for the owner and for nobody else — an administrator does not outrank the
 * role that made them one.
 */
export function assignableRoles(
  self: User | null,
  roles: ReadonlyMap<number, Role>,
): Role[] {
  if (!self) return [];
  if (!has(permissionsOf(self, roles), Perm.ManageRoles)) return [];
  const myRank = rankOf(self, roles);

  return [...roles.values()]
    .filter((role) => role.managed !== "everyone" && role.managed !== "registered")
    .filter((role) => role.position < myRank)
    .sort((a, b) => b.position - a.position);
}

/** Whether a role's permission mask literally contains a bit. */
export function roleHas(role: Role, bit: bigint): boolean {
  return (parse(role.permissions) & bit) === bit;
}

/**
 * What a whole server has waiting, for the one badge the rail can draw.
 *
 * The channels are summed rather than counted, because a rail entry answers
 * "is there anything here" and "does any of it name me", and a reader who
 * wants the breakdown is one click from the channel list that has it.
 */
export function unreadTotals(unread: ReadonlyMap<number, Unread>): {
  count: number;
  mentions: number;
} {
  let count = 0;
  let mentions = 0;
  for (const entry of unread.values()) {
    count += entry.count;
    if (entry.mention) mentions += 1;
  }
  return { count, mentions };
}
