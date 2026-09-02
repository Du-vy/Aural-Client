import { useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { Perm, has, resolveChannelPermissions, resolve } from "@/lib/permissions";
import type { Channel, Role, User } from "@/lib/protocol";
import { useSession } from "@/store/session";
import {
  buildChannelTree,
  everyoneRoleId,
  usersInChannel,
  type ChannelNode,
} from "@/store/selectors";
import { useVoice } from "@/store/voice";
import { Avatar } from "./Avatar";
import {
  BroadcastIcon,
  ChevronIcon,
  HashIcon,
  HeadphonesOffIcon,
  MicOffIcon,
  PlusIcon,
  TrashIcon,
  VoiceIcon,
} from "./Icons";

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
  const { t } = useTranslation();
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
        <p className="connect__empty">{t("server.channels")}</p>
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
  const { t } = useTranslation();
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
            title={t("server.createChannel")}
            aria-label={t("server.createChannel")}
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
  const { t } = useTranslation();
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
              ? t("errors.forbidden")
              : full
                ? t("errors.server_full")
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
              title={`${t("common.delete")} ${channel.name}`}
              aria-label={`${t("common.delete")} ${channel.name}`}
            >
              <TrashIcon size={14} />
            </button>
          </span>
        ) : null}
      </div>


      {occupants.length > 0 ? (
        <div className="occupants">
          {occupants.map((user) => (
            <Occupant
              key={user.id}
              user={user}
              self={self}
              roles={roles}
              onOpenMember={onOpenMember}
              onContextMenuMember={onContextMenuMember}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

interface OccupantProps {
  user: User;
  self: User | null;
  roles: ReadonlyMap<number, Role>;
  onOpenMember(userId: number): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
}

/**
 * One person sitting in a voice channel.
 *
 * The three things drawn on them are the three that change second to second:
 * whether they are speaking, whether they can be heard, and whether they are
 * the one relaying the channel. Everything else about them is in the member
 * list, which is where somebody looks when they want to know more.
 */
function Occupant({ user, self, roles, onOpenMember, onContextMenuMember }: OccupantProps) {
  const { t } = useTranslation();
  const state = useVoice((voice) => voice.states.get(user.id));
  const speaking = useVoice((voice) => voice.speaking.has(user.id));

  const muted = state ? state.selfMute || state.mute : false;
  const deafened = state ? state.selfDeaf || state.deaf : false;

  const classes = ["occupant"];
  if (user.id === self?.id) classes.push("occupant--self");
  if (speaking) classes.push("occupant--speaking");
  if (muted) classes.push("occupant--muted");

  return (
    <button
      className={classes.join(" ")}
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
      <span className="occupant__flags">
        {state?.host ? (
          <span className="occupant__flag" title={t("voice.hostBadge")}>
            <BroadcastIcon size={12} />
          </span>
        ) : null}
        {deafened ? (
          <span className="occupant__flag occupant__flag--danger" title={t("voice.deafen")}>
            <HeadphonesOffIcon size={12} />
          </span>
        ) : muted ? (
          <span className="occupant__flag occupant__flag--danger" title={t("voice.mute")}>
            <MicOffIcon size={12} />
          </span>
        ) : null}
      </span>
    </button>
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
