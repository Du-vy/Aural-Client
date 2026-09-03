import { useMemo, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { Perm, has, resolveChannelPermissions } from "@/lib/permissions";
import type { Channel, Role, User, ChannelType } from "@/lib/protocol";
import { readAccessibility } from "@/lib/storage";
import { useSession, type Unread } from "@/store/session";
import { useServers } from "@/store/servers";
import {
  buildChannelTree,
  everyoneRoleId,
  permissionsOf,
  usersInChannel,
  type ChannelNode,
} from "@/store/selectors";
import { Avatar } from "./Avatar";
import { DirectMessageList } from "./DirectMessageList";
import {
  BroadcastIcon,
  CalendarIcon,
  ChevronIcon,
  FolderIcon,
  ForumIcon,
  HashIcon,
  HeadphonesOffIcon,
  MediaIcon,
  MegaphoneIcon,
  MicOffIcon,
  PlusIcon,
  TrashIcon,
  VoiceIcon,
} from "./Icons";

interface ChannelSidebarProps {
  selectedChannelId: number | null;
  onSelectChannel(channelId: number): void;
  activeConversationId?: number | null;
  onSelectConversation?(userId: number): void;
  onCloseConversation?(userId: number): void;
  /**
   * Entering a voice channel. It goes back up rather than straight to the
   * store because there is one microphone across every server open, so a call
   * running somewhere else is a question before it is a request.
   */
  onJoinVoice(channel: Channel): void;
  onCreateChannel(parentId: number | null): void;
  onOpenMember(userId: number, anchorRect?: DOMRect): void;
  onDeleteChannel?(channel: Channel): void;
  onContextMenuChannel?(event: React.MouseEvent, channel: Channel): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
  onContextMenuServer?(event: React.MouseEvent): void;
}

interface DragItem {
  id: number;
  type: ChannelType;
  parentId: number | null;
}

interface DropTarget {
  targetId: number | null;
  targetType: "channel" | "category" | "root";
  placement: "before" | "after" | "inside";
  parentId: number | null;
}

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.targetId === b.targetId &&
    a.targetType === b.targetType &&
    a.placement === b.placement &&
    a.parentId === b.parentId
  );
}

export function ChannelSidebar({
  selectedChannelId,
  onSelectChannel,
  activeConversationId,
  onSelectConversation,
  onCloseConversation,
  onJoinVoice,
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
  const unread = useSession((state) => state.unread);
  const deleteChannel = useSession((state) => state.deleteChannel);
  const updateChannel = useSession((state) => state.updateChannel);

  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragItemRef = useRef<DragItem | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);

  const tree = useMemo(() => buildChannelTree(channels), [channels]);
  const everyoneId = useMemo(() => everyoneRoleId(roles), [roles]);

  const canManageServer = useMemo(
    () => has(permissionsOf(self, roles), Perm.ManageChannels),
    [self, roles],
  );

  const permissionsIn = useMemo(() => {
    const base = permissionsOf(self, roles);
    return (channelId: number) =>
      resolveChannelPermissions(base, everyoneId, self?.roles ?? [], channelId, channels);
  }, [self, roles, channels, everyoneId]);

  /**
   * Records what is being dragged.
   *
   * React treats `dragstart` as a discrete event, so a `setState` from inside
   * one is flushed before the browser resumes the drag it is still setting up
   * — and Chromium abandons a drag whose source is relaid out underneath it at
   * that moment. Picking up a channel does exactly that, because it reveals
   * the root drop zone above the row. So the pointer state goes in a ref, which
   * every dragover handler reads, and the render that draws the drag
   * affordances is pushed to the next task, by which point the drag is real.
   * Categories never hit this, which is why they alone were movable.
   */
  function beginDrag(item: DragItem) {
    dragItemRef.current = item;
    setTimeout(() => {
      if (dragItemRef.current === item) setDragItem(item);
    }, 0);
  }

  function updateDropTarget(target: DropTarget | null) {
    // dragover fires continuously; only a target that actually moved is worth
    // a render.
    if (sameTarget(dropTargetRef.current, target)) return;
    dropTargetRef.current = target;
    setDropTarget(target);
  }

  function clearDrag() {
    dragItemRef.current = null;
    dropTargetRef.current = null;
    setDragItem(null);
    setDropTarget(null);
  }

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

  async function handleDrop(target: DropTarget) {
    const item = dragItemRef.current;
    clearDrag();
    if (!item) return;

    // If dropped on itself with same placement, nothing to do
    if (item.id === target.targetId && target.placement !== "inside") return;

    try {
      if (item.type === "category") {
        // Reordering categories among each other
        const categories = tree
          .filter((n) => n.channel.type === "category")
          .map((n) => n.channel);

        const filtered = categories.filter((c) => c.id !== item.id);
        const draggedCat = categories.find((c) => c.id === item.id);
        if (!draggedCat) return;

        let insertIndex = filtered.length;
        if (target.targetId !== null) {
          const idx = filtered.findIndex((c) => c.id === target.targetId);
          if (idx !== -1) {
            insertIndex = target.placement === "after" ? idx + 1 : idx;
          }
        }

        filtered.splice(insertIndex, 0, draggedCat);

        // Optimistic store update for instant visual response
        useSession.setState((prev) => {
          const updated = new Map(prev.channels);
          for (const [i, cat] of filtered.entries()) {
            const existing = updated.get(cat.id);
            if (existing) {
              updated.set(cat.id, { ...existing, position: i * 100 });
            }
          }
          return { channels: updated };
        });

        const updates: Promise<void>[] = [];
        for (const [i, cat] of filtered.entries()) {
          const newPos = i * 100;
          if (cat.id === item.id || cat.position !== newPos) {
            updates.push(
              updateChannel({
                channelId: cat.id,
                position: newPos,
              }),
            );
          }
        }
        await Promise.all(updates);
      } else {
        // Moving or reordering a channel (text or voice)
        const targetParentId = target.parentId;
        const draggedCh = channels.get(item.id);
        if (!draggedCh) return;

        let siblings: Channel[];
        if (targetParentId === null) {
          // Loose root channels
          siblings = tree
            .filter((n) => n.channel.type !== "category")
            .map((n) => n.channel);
        } else {
          // Channels inside the target category
          const catNode = tree.find((n) => n.channel.id === targetParentId);
          siblings = catNode ? [...catNode.children] : [];
        }

        const filtered = siblings.filter((c) => c.id !== item.id);

        let insertIndex = filtered.length;
        if (target.placement === "inside") {
          // Dropped on category header -> append to category
          insertIndex = filtered.length;
        } else if (target.targetId !== null) {
          const idx = filtered.findIndex((c) => c.id === target.targetId);
          if (idx !== -1) {
            insertIndex = target.placement === "after" ? idx + 1 : idx;
          }
        }
        // Otherwise it came off the root drop zone, and `insertIndex` already
        // points past the last loose channel.

        filtered.splice(insertIndex, 0, draggedCh);

        // Auto-expand category if collapsed
        if (targetParentId !== null && collapsed.has(targetParentId)) {
          toggleCategory(targetParentId);
        }

        // Optimistic store update for instant visual response
        useSession.setState((prev) => {
          const updated = new Map(prev.channels);
          for (const [i, ch] of filtered.entries()) {
            const existing = updated.get(ch.id);
            if (existing) {
              updated.set(ch.id, {
                ...existing,
                position: i * 100,
                ...(ch.id === item.id ? { parentId: targetParentId } : {}),
              });
            }
          }
          return { channels: updated };
        });

        const updates: Promise<void>[] = [];
        for (const [i, ch] of filtered.entries()) {
          const newPos = i * 100;
          const isMoved = ch.id === item.id;
          const posChanged = ch.position !== newPos;

          if (isMoved || posChanged) {
            updates.push(
              updateChannel({
                channelId: ch.id,
                parentId: isMoved ? targetParentId : undefined,
                position: newPos,
              }),
            );
          }
        }
        await Promise.all(updates);
      }
    } catch (err) {
      console.error("Failed to move channel:", err);
    }
  }

  function onChannelDragStart(channel: Channel, event: React.DragEvent) {
    const item: DragItem = {
      id: channel.id,
      type: channel.type,
      parentId: channel.parentId,
    };
    beginDrag(item);
    event.dataTransfer.setData("text/plain", String(channel.id));
    event.dataTransfer.effectAllowed = "move";
  }

  function onChannelDragOver(channel: Channel, event: React.DragEvent) {
    const currentDrag = dragItemRef.current;
    if (!currentDrag) return;
    if (currentDrag.id === channel.id) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    if (currentDrag.type === "category") {
      // Category dragged over a channel inside a category: target that category!
      if (channel.parentId !== null && channel.parentId !== currentDrag.id) {
        updateDropTarget({
          targetId: channel.parentId,
          targetType: "category",
          placement: "after",
          parentId: null,
        });
      }
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    updateDropTarget({
      targetId: channel.id,
      targetType: "channel",
      placement,
      parentId: channel.parentId,
    });
  }

  function onChannelDrop(channel: Channel, event: React.DragEvent) {
    const currentDrag = dragItemRef.current;
    if (!currentDrag) return;
    event.preventDefault();
    event.stopPropagation();

    if (currentDrag.type === "category") {
      if (channel.parentId !== null && channel.parentId !== currentDrag.id) {
        void handleDrop({
          targetId: channel.parentId,
          targetType: "category",
          placement: "after",
          parentId: null,
        });
      }
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    void handleDrop({
      targetId: channel.id,
      targetType: "channel",
      placement,
      parentId: channel.parentId,
    });
  }

  function onCategoryDragStart(catChannel: Channel, event: React.DragEvent) {
    const item: DragItem = {
      id: catChannel.id,
      type: "category",
      parentId: null,
    };
    beginDrag(item);
    event.dataTransfer.setData("text/plain", String(catChannel.id));
    event.dataTransfer.effectAllowed = "move";
  }

  function onCategoryDragOver(catChannel: Channel, event: React.DragEvent) {
    const currentDrag = dragItemRef.current;
    if (!currentDrag) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    if (currentDrag.type === "category") {
      if (currentDrag.id === catChannel.id) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      updateDropTarget({
        targetId: catChannel.id,
        targetType: "category",
        placement,
        parentId: null,
      });
    } else {
      // Channel dragged over category header -> drop inside this category
      updateDropTarget({
        targetId: catChannel.id,
        targetType: "category",
        placement: "inside",
        parentId: catChannel.id,
      });
    }
  }

  function onCategoryDrop(catChannel: Channel, event: React.DragEvent) {
    const currentDrag = dragItemRef.current;
    if (!currentDrag) return;
    event.preventDefault();
    event.stopPropagation();

    if (currentDrag.type === "category") {
      if (currentDrag.id === catChannel.id) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      void handleDrop({
        targetId: catChannel.id,
        targetType: "category",
        placement,
        parentId: null,
      });
    } else {
      // Dropped into category
      void handleDrop({
        targetId: catChannel.id,
        targetType: "category",
        placement: "inside",
        parentId: catChannel.id,
      });
    }
  }

  const showRootDropZone =
    dragItem !== null &&
    dragItem.type !== "category" &&
    (dragItem.parentId !== null || tree.some((n) => n.channel.type !== "category"));

  return (
    <div
      className="sidebar__tree"
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onContextMenuServer?.(event);
        }
      }}
      onDragOver={(event) => {
        if (dragItemRef.current) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDragEnd={clearDrag}
    >
      <DirectMessageList
        activeUserId={activeConversationId ?? null}
        onSelect={(userId) => onSelectConversation?.(userId)}
        onCloseConversation={onCloseConversation}
        onContextMenuMember={onContextMenuMember}
        maxItems={3}
        onViewAll={() => useServers.getState().setActiveSection("dms")}
      />

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
              canManage={
                canManageServer ||
                has(permissionsIn(node.channel.id), Perm.ManageChannels)
              }
              onContextMenuChannel={onContextMenuChannel}
              isDragging={dragItem?.id === node.channel.id}
              dropIndicator={
                dropTarget?.targetId === node.channel.id && dropTarget.targetType === "category"
                  ? (dropTarget.placement as "before" | "after")
                  : null
              }
              isDropTarget={
                dropTarget?.targetId === node.channel.id && dropTarget.placement === "inside"
              }
              onDragStart={(event) => onCategoryDragStart(node.channel, event)}
              onDragEnd={clearDrag}
              onDragOver={(event) => onCategoryDragOver(node.channel, event)}
              onDrop={(event) => onCategoryDrop(node.channel, event)}
              onSectionDragOver={(event) => {
                const currentDrag = dragItemRef.current;
                if (!currentDrag || currentDrag.id === node.channel.id) return;
                if (currentDrag.type === "category") {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  const rect = event.currentTarget.getBoundingClientRect();
                  const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                  updateDropTarget({
                    targetId: node.channel.id,
                    targetType: "category",
                    placement,
                    parentId: null,
                  });
                }
              }}
              onSectionDrop={(event) => {
                const currentDrag = dragItemRef.current;
                if (!currentDrag || currentDrag.id === node.channel.id) return;
                if (currentDrag.type === "category") {
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                  void handleDrop({
                    targetId: node.channel.id,
                    targetType: "category",
                    placement,
                    parentId: null,
                  });
                }
              }}
              renderChannel={(channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  self={self}
                  users={users}
                  roles={roles}
                  permissions={permissionsIn(channel.id)}
                  canManage={
                    canManageServer ||
                    has(permissionsIn(channel.id), Perm.ManageChannels) ||
                    has(permissionsIn(node.channel.id), Perm.ManageChannels)
                  }
                  selected={selectedChannelId === channel.id}
                  unread={unread.get(channel.id)}
                  onSelect={() => onSelectChannel(channel.id)}
                  onJoin={() => onJoinVoice(channel)}
                  onDelete={() => handleDelete(channel)}
                  onOpenMember={onOpenMember}
                  onContextMenuChannel={onContextMenuChannel}
                  onContextMenuMember={onContextMenuMember}
                  isDragging={dragItem?.id === channel.id}
                  dropIndicator={
                    dropTarget?.targetId === channel.id && dropTarget.targetType === "channel"
                      ? (dropTarget.placement as "before" | "after")
                      : null
                  }
                  onDragStart={(event) => onChannelDragStart(channel, event)}
                  onDragEnd={clearDrag}
                  onDragOver={(event) => onChannelDragOver(channel, event)}
                  onDrop={(event) => onChannelDrop(channel, event)}
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
              canManage={
                canManageServer ||
                has(permissionsIn(node.channel.id), Perm.ManageChannels)
              }
              selected={selectedChannelId === node.channel.id}
              unread={unread.get(node.channel.id)}
              onSelect={() => onSelectChannel(node.channel.id)}
              onJoin={() => onJoinVoice(node.channel)}
              onDelete={() => handleDelete(node.channel)}
              onOpenMember={onOpenMember}
              onContextMenuChannel={onContextMenuChannel}
              onContextMenuMember={onContextMenuMember}
              isDragging={dragItem?.id === node.channel.id}
              dropIndicator={
                dropTarget?.targetId === node.channel.id && dropTarget.targetType === "channel"
                  ? (dropTarget.placement as "before" | "after")
                  : null
              }
              onDragStart={(event) => onChannelDragStart(node.channel, event)}
              onDragEnd={clearDrag}
              onDragOver={(event) => onChannelDragOver(node.channel, event)}
              onDrop={(event) => onChannelDrop(node.channel, event)}
            />
          ),
        )
      )}

      {showRootDropZone ? (
        <div
          className={`sidebar__root-dropzone ${dropTarget?.targetType === "root" ? "sidebar__root-dropzone--active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            updateDropTarget({
              targetId: null,
              targetType: "root",
              placement: "before",
              parentId: null,
            });
          }}
          onDragLeave={() => {
            if (dropTargetRef.current?.targetType === "root") {
              updateDropTarget(null);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleDrop({
              targetId: null,
              targetType: "root",
              placement: "before",
              parentId: null,
            });
          }}
        >
          <FolderIcon size={14} />
          <span>{t("server.dropOutOfCategory")}</span>
        </div>
      ) : null}
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
  isDragging?: boolean;
  dropIndicator?: "before" | "after" | null;
  isDropTarget?: boolean;
  onDragStart?(event: React.DragEvent): void;
  onDragEnd?(event: React.DragEvent): void;
  onDragOver?(event: React.DragEvent): void;
  onDrop?(event: React.DragEvent): void;
  onSectionDragOver?(event: React.DragEvent): void;
  onSectionDrop?(event: React.DragEvent): void;
}

function CategoryBlock({
  node,
  collapsed,
  canManage,
  onToggle,
  onCreateChannel,
  onContextMenuChannel,
  renderChannel,
  isDragging,
  dropIndicator,
  isDropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onSectionDragOver,
  onSectionDrop,
}: CategoryBlockProps) {
  const { t } = useTranslation();
  return (
    <section
      className={[
        "category",
        isDragging ? "category--dragging" : "",
        isDropTarget ? "category--drop-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenuChannel?.(event, node.channel);
      }}
      onDragOver={onSectionDragOver}
      onDrop={onSectionDrop}
    >
      <div
        className="category__header-wrap"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".channel__action")) return;
          onToggle();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        draggable={canManage}
        onDragStart={canManage ? onDragStart : undefined}
        onDragEnd={canManage ? onDragEnd : undefined}
        onDragOver={canManage ? onDragOver : undefined}
        onDrop={canManage ? onDrop : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          position: "relative",
          cursor: canManage ? "grab" : "pointer",
          userSelect: "none",
        }}
      >
        {dropIndicator === "before" ? (
          <div className="category__drop-line category__drop-line--before" />
        ) : null}
        <div
          className="category__header"
          style={{ flex: 1, minWidth: 0 }}
        >
          <ChevronIcon
            size={12}
            className={collapsed ? "category__caret category__caret--collapsed" : "category__caret"}
          />
          <span className="category__name">{node.channel.name}</span>
        </div>
        {canManage ? (
          <button
            type="button"
            className="channel__action"
            onClick={(e) => {
              e.stopPropagation();
              onCreateChannel(node.channel.id);
            }}
            title={t("server.createChannel")}
            aria-label={t("server.createChannel")}
          >
            <PlusIcon size={15} />
          </button>
        ) : null}
        {dropIndicator === "after" ? (
          <div className="category__drop-line category__drop-line--after" />
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
  canManage: boolean;
  selected: boolean;
  /** What is waiting in this channel, or nothing. */
  unread?: Unread;
  onSelect(): void;
  onJoin(): void;
  onDelete(): void;
  onOpenMember(userId: number, anchorRect?: DOMRect): void;
  onContextMenuChannel?(event: React.MouseEvent, channel: Channel): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
  isDragging?: boolean;
  dropIndicator?: "before" | "after" | null;
  onDragStart?(event: React.DragEvent): void;
  onDragEnd?(event: React.DragEvent): void;
  onDragOver?(event: React.DragEvent): void;
  onDrop?(event: React.DragEvent): void;
}

function ChannelTypeIcon({ type, size = 16 }: { type: ChannelType; size?: number }) {
  switch (type) {
    case "voice":
      return <VoiceIcon size={size} />;
    case "announcement":
      return <MegaphoneIcon size={size} />;
    case "calendar":
      return <CalendarIcon size={size} />;
    case "forum":
      return <ForumIcon size={size} />;
    case "media":
      return <MediaIcon size={size} />;
    case "text":
    default:
      return <HashIcon size={size} />;
  }
}

function ChannelRow({
  channel,
  self,
  users,
  roles,
  permissions,
  canManage,
  selected,
  unread,
  onSelect,
  onJoin,
  onDelete,
  onOpenMember,
  onContextMenuChannel,
  onContextMenuMember,
  isDragging,
  dropIndicator,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: ChannelRowProps) {
  const { t } = useTranslation();
  const isVoice = channel.type === "voice";
  const occupants = isVoice ? usersInChannel(users, channel.id) : [];
  const joined = isVoice && self?.channelId === channel.id;
  const canConnect = has(permissions, Perm.Connect);
  const full = channel.userLimit > 0 && occupants.length >= channel.userLimit && !joined;
  const disabled = isVoice && (!canConnect || full);

  const waiting = !isVoice && !selected && unread !== undefined && unread.count > 0;

  const classes = ["channel"];
  if (selected) classes.push("channel--active");
  if (waiting) classes.push("channel--unread");
  if (joined) classes.push("channel--joined");
  if (isDragging) classes.push("channel--dragging");
  if (disabled) classes.push("channel--disabled");

  return (
    <>
      <div
        className={classes.join(" ")}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".channel__action")) return;
          if (disabled) return;
          if (isVoice) {
            const acc = readAccessibility();
            if (acc.doubleClickToJoinVoice) {
              onSelect();
            } else {
              onJoin();
            }
          } else {
            onSelect();
          }
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest(".channel__action")) return;
          if (disabled) return;
          if (isVoice) {
            const acc = readAccessibility();
            if (acc.doubleClickToJoinVoice) {
              onJoin();
            }
          }
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (isVoice) {
              const acc = readAccessibility();
              if (acc.doubleClickToJoinVoice) {
                // If double-click is required, pressing Enter joins
                onJoin();
              } else {
                onJoin();
              }
            } else {
              onSelect();
            }
          }
        }}
        draggable={canManage}
        onDragStart={canManage ? onDragStart : undefined}
        onDragEnd={canManage ? onDragEnd : undefined}
        onDragOver={canManage ? onDragOver : undefined}
        onDrop={canManage ? onDrop : undefined}
        style={{
          position: "relative",
          cursor: canManage ? "grab" : disabled ? "not-allowed" : "pointer",
          userSelect: "none",
        }}
        title={
          isVoice && !canConnect
            ? t("errors.forbidden")
            : full
              ? t("errors.server_full")
              : channel.name
        }
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenuChannel?.(event, channel);
        }}
      >
        {dropIndicator === "before" ? (
          <div className="channel__drop-line channel__drop-line--before" />
        ) : null}

        <span className="channel__icon">
          <ChannelTypeIcon type={channel.type} size={16} />
        </span>
        <span className="channel__name">
          {channel.name}
        </span>
        {waiting && unread.mention ? (
          <span
            className="channel__badge"
            title={t("server.unreadMessages", { count: unread.count })}
          >
            {unread.count > 99 ? "99+" : unread.count}
          </span>
        ) : null}
        {channel.userLimit > 0 ? (
          <span className="channel__count">
            {occupants.length}/{channel.userLimit}
          </span>
        ) : null}

        {canManage ? (
          <span className="channel__actions">
            <button
              type="button"
              className="channel__action"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title={`${t("common.delete")} ${channel.name}`}
              aria-label={`${t("common.delete")} ${channel.name}`}
            >
              <TrashIcon size={14} />
            </button>
          </span>
        ) : null}

        {dropIndicator === "after" ? (
          <div className="channel__drop-line channel__drop-line--after" />
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
  onOpenMember(userId: number, anchorRect?: DOMRect): void;
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
  const state = useSession((session) => session.voiceStates.get(user.id));
  const speaking = useSession((session) => session.speaking.has(user.id));

  const muted = state ? state.selfMute || state.mute : false;
  const deafened = state ? state.selfDeaf || state.deaf : false;

  const classes = ["occupant"];
  if (user.id === self?.id) classes.push("occupant--self");
  if (speaking) classes.push("occupant--speaking");
  if (muted) classes.push("occupant--muted");

  return (
    <button
      className={classes.join(" ")}
      onClick={(e) => onOpenMember(user.id, e.currentTarget.getBoundingClientRect())}
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
