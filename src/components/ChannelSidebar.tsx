import { useMemo, useState } from "react";

import { Perm, has, resolveChannelPermissions, resolve } from "@/lib/permissions";
import type { Channel, Role, User } from "@/lib/protocol";
import { useSession } from "@/store/session";
import {
  buildChannelTree,
  everyoneRoleId,
  usersInChannel,
  type ChannelNode,
} from "@/store/selectors";
import { Avatar } from "./Avatar";
import { ChevronIcon, HashIcon, PlusIcon, TrashIcon, VoiceIcon } from "./Icons";

interface ChannelSidebarProps {
  selectedChannelId: number | null;
  onSelectChannel(channelId: number): void;
  onCreateChannel(parentId: number | null): void;
  onOpenMember(userId: number): void;
  onDeleteChannel?(channel: Channel): void;
  onContextMenuChannel?(event: React.MouseEvent, channel: Channel): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
  onContextMenuServer?(event: React.MouseEvent): void;
}

export function ChannelSidebar({
  selectedChannelId,
  onSelectChannel,
  onCreateChannel,
  onOpenMember,
  onDeleteChannel,
  onContextMenuChannel,
  onContextMenuMember,
  onContextMenuServer,
}: ChannelSidebarProps) {
  const channels = useSession((state) => state.channels);
  const roles = useSession((state) => state.roles);
  const users = useSession((state) => state.users);
  const self = useSession((state) => state.self);
  const joinChannel = useSession((state) => state.joinChannel);
  const deleteChannel = useSession((state) => state.deleteChannel);

  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());

  const tree = useMemo(() => buildChannelTree(channels), [channels]);
  const everyoneId = useMemo(() => everyoneRoleId(roles), [roles]);

  const permissionsIn = useMemo(() => {
    const held: Role[] = (self?.roles ?? [])
      .map((id) => roles.get(id))
      .filter((role): role is Role => role !== undefined);
    const base = resolve(held);
    return (channelId: number) =>
      resolveChannelPermissions(base, everyoneId, self?.roles ?? [], channelId, channels);
  }, [self, roles, channels, everyoneId]);

  function toggleCategory(id: number) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDelete(channel: Channel) {
    if (onDeleteChannel) {
      onDeleteChannel(channel);
    } else {
      void deleteChannel(channel.id);
    }
  }

  return (
    <div
      className="sidebar__tree"
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onContextMenuServer?.(event);
        }
      }}
    >
      {tree.length === 0 ? (
        <p className="connect__empty">No channels you can see.</p>
      ) : (
        tree.map((node) =>
          node.channel.type === "category" ? (
            <CategoryBlock
              key={node.channel.id}
              node={node}
              collapsed={collapsed.has(node.channel.id)}
              onToggle={() => toggleCategory(node.channel.id)}
              onCreateChannel={onCreateChannel}
              canManage={has(permissionsIn(node.channel.id), Perm.ManageChannels)}
              onContextMenuChannel={onContextMenuChannel}
              renderChannel={(channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  self={self}
                  users={users}
                  roles={roles}
                  permissions={permissionsIn(channel.id)}
                  selected={selectedChannelId === channel.id}
                  onSelect={() => onSelectChannel(channel.id)}
                  onJoin={() => void joinChannel(channel.id)}
                  onDelete={() => handleDelete(channel)}
                  onOpenMember={onOpenMember}
                  onContextMenuChannel={onContextMenuChannel}
                  onContextMenuMember={onContextMenuMember}
                />
              )}
            />
          ) : (
            <ChannelRow
              key={node.channel.id}
              channel={node.channel}
              self={self}
              users={users}
              roles={roles}
              permissions={permissionsIn(node.channel.id)}
              selected={selectedChannelId === node.channel.id}
              onSelect={() => onSelectChannel(node.channel.id)}
              onJoin={() => void joinChannel(node.channel.id)}
              onDelete={() => handleDelete(node.channel)}
              onOpenMember={onOpenMember}
              onContextMenuChannel={onContextMenuChannel}
              onContextMenuMember={onContextMenuMember}
            />
          ),
        )
      )}
    </div>
  );
}

interface CategoryBlockProps {
  node: ChannelNode;
  collapsed: boolean;
  canManage: boolean;
  onToggle(): void;
  onCreateChannel(parentId: number | null): void;
  onContextMenuChannel?(event: React.MouseEvent, channel: Channel): void;
  renderChannel(channel: Channel): React.ReactNode;
}

function CategoryBlock({
  node,
  collapsed,
  canManage,
  onToggle,
  onCreateChannel,
  onContextMenuChannel,
  renderChannel,
}: CategoryBlockProps) {
  return (
    <section
      className="category"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenuChannel?.(event, node.channel);
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <button
          className="category__header"
          onClick={onToggle}
          aria-expanded={!collapsed}
          style={{ flex: 1, minWidth: 0 }}
        >
          <ChevronIcon
            size={12}
            className={collapsed ? "category__caret category__caret--collapsed" : "category__caret"}
          />
          <span className="category__name">{node.channel.name}</span>
        </button>
        {canManage ? (
          <button
            className="channel__action"
            onClick={() => onCreateChannel(node.channel.id)}
            title={`Create a channel in ${node.channel.name}`}
            aria-label={`Create a channel in ${node.channel.name}`}
          >
            <PlusIcon size={15} />
          </button>
        ) : null}
      </div>

      {collapsed ? null : node.children.map(renderChannel)}
    </section>
  );
}

interface ChannelRowProps {
  channel: Channel;
  self: User | null;
  users: ReadonlyMap<number, User>;
  roles: ReadonlyMap<number, Role>;
  permissions: bigint;
  selected: boolean;
  onSelect(): void;
  onJoin(): void;
  onDelete(): void;
  onOpenMember(userId: number): void;
  onContextMenuChannel?(event: React.MouseEvent, channel: Channel): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
}

function ChannelRow({
  channel,
  self,
  users,
  roles,
  permissions,
  selected,
  onSelect,
  onJoin,
  onDelete,
  onOpenMember,
  onContextMenuChannel,
  onContextMenuMember,
}: ChannelRowProps) {
  const isVoice = channel.type === "voice";
  const occupants = isVoice ? usersInChannel(users, channel.id) : [];
  const joined = isVoice && self?.channelId === channel.id;
  const canManage = has(permissions, Perm.ManageChannels);
  const canConnect = has(permissions, Perm.Connect);
  const full = channel.userLimit > 0 && occupants.length >= channel.userLimit && !joined;

  const classes = ["channel"];
  if (selected) classes.push("channel--active");
  if (joined) classes.push("channel--joined");

  return (
    <>
      <div
        className={classes.join(" ")}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenuChannel?.(event, channel);
        }}
      >
        <button
          onClick={isVoice ? onJoin : onSelect}
          disabled={isVoice && (!canConnect || full)}
          title={
            isVoice && !canConnect
              ? "You are not allowed into this channel"
              : full
                ? "This channel is full"
                : channel.name
          }
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            flex: 1,
            minWidth: 0,
            color: "inherit",
            textAlign: "left",
          }}
        >
          <span className="channel__icon">
            {isVoice ? <VoiceIcon size={16} /> : <HashIcon size={16} />}
          </span>
          <span className="channel__name">{channel.name}</span>
          {channel.userLimit > 0 ? (
            <span className="channel__count">
              {occupants.length}/{channel.userLimit}
            </span>
          ) : null}
        </button>

        {canManage ? (
          <span className="channel__actions">
            <button
              className="channel__action"
              onClick={onDelete}
              title={`Delete ${channel.name}`}
              aria-label={`Delete ${channel.name}`}
            >
              <TrashIcon size={14} />
            </button>
          </span>
        ) : null}
      </div>

      {occupants.length > 0 ? (
        <div className="occupants">
          {occupants.map((user) => (
            <button
              key={user.id}
              className={user.id === self?.id ? "occupant occupant--self" : "occupant"}
              onClick={() => onOpenMember(user.id)}
              onContextMenu={(event) => {
                if (onContextMenuMember) {
                  event.preventDefault();
                  event.stopPropagation();
                  onContextMenuMember(event, user);
                }
              }}
            >
              <Avatar user={user} size="sm" />
              <span className="occupant__name" style={{ color: colorOf(user, roles) ?? undefined }}>
                {user.nickname}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function colorOf(user: User, roles: ReadonlyMap<number, Role>): string | null {
  let best: Role | null = null;
  for (const id of user.roles) {
    const role = roles.get(id);
    if (!role?.color) continue;
    if (!best || role.position > best.position) best = role;
  }
  return best?.color ?? null;
}
