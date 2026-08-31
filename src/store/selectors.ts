/**
 * Derived views over the session state. The client resolves permissions itself
 * so the interface can disable what a user cannot do rather than letting them
 * try and be refused; the server checks everything again regardless.
 */

import {
  NONE,
  Perm,
  has,
  parse,
  resolve,
  resolveChannelPermissions,
} from "@/lib/permissions";
import type { Channel, Role, User } from "@/lib/protocol";
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

/** The caller's resolved server-wide mask. */
export function useMyPermissions(): bigint {
  return useSession((state) => {
    if (!state.self) return NONE;
    return resolve(rolesOf(state.self, state.roles));
  });
}

/** The caller's mask inside one channel, overwrites and inheritance included. */
export function useChannelPermissions(channelId: number | null): bigint {
  return useSession((state) => {
    if (!state.self) return NONE;
    const base = resolve(rolesOf(state.self, state.roles));
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

/** Groups the member list by hoisted role, highest first, as Discord does. */
export function groupMembers(
  users: ReadonlyMap<number, User>,
  roles: ReadonlyMap<number, Role>,
): MemberGroup[] {
  const grouped = new Map<number, User[]>();
  const ungrouped: User[] = [];

  for (const user of users.values()) {
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
  return groups;
}

/** The caller's rank, which decides who they may act on. */
export function useMyRank(): number {
  return useSession((state) =>
    rolesOf(state.self, state.roles).reduce((highest, role) => Math.max(highest, role.position), 0),
  );
}

/** Whether the caller outranks a member, and so may moderate them. */
export function outranks(
  self: User | null,
  target: User,
  roles: ReadonlyMap<number, Role>,
): boolean {
  if (!self || self.id === target.id) return false;
  const rank = (user: User) =>
    rolesOf(user, roles).reduce((highest, role) => Math.max(highest, role.position), 0);
  return rank(self) > rank(target);
}

/** Roles the caller may hand out: unmanaged, and ranked below their own. */
export function assignableRoles(
  self: User | null,
  roles: ReadonlyMap<number, Role>,
): Role[] {
  if (!self) return [];
  const myRank = rolesOf(self, roles).reduce((highest, role) => Math.max(highest, role.position), 0);
  const mask = resolve(rolesOf(self, roles));
  if (!has(mask, Perm.ManageRoles)) return [];

  return [...roles.values()]
    .filter((role) => role.managed !== "everyone" && role.managed !== "registered")
    .filter((role) => role.position < myRank)
    .sort((a, b) => b.position - a.position);
}

/** Whether a role's permission mask literally contains a bit. */
export function roleHas(role: Role, bit: bigint): boolean {
  return (parse(role.permissions) & bit) === bit;
}
