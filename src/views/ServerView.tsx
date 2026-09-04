import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ChannelSidebar } from "@/components/ChannelSidebar";
import { ChatPanel } from "@/components/ChatPanel";
import { DirectMessagePanel } from "@/components/DirectMessagePanel";
import { ContextMenu, type MenuEntry } from "@/components/ContextMenu";
import {
  AuralMark,
  BellIcon,
  CalendarIcon,
  ChevronIcon,
  CloseIcon,
  CopyIcon,
  FolderIcon,
  ForumIcon,
  GavelIcon,
  GearIcon,
  HangUpIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MediaIcon,
  MegaphoneIcon,
  MicIcon,
  MicOffIcon,
  HashIcon,
  MenuIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  ShieldIcon,
  TrashIcon,
  UserIcon,
  UserXIcon,
  UsersIcon,
  VoiceIcon,
} from "@/components/Icons";
import { MemberList } from "@/components/MemberList";
import { notificationMenuEntries } from "@/components/NotificationMenu";
import { SearchBar } from "@/components/SearchBar";
import { SearchResults } from "@/components/SearchResults";
import { UserPanel } from "@/components/UserPanel";
import { VoicePanel } from "@/components/VoicePanel";
import { useVoice } from "@/store/voice";
import { StatusPopover } from "@/components/StatusPopover";
import { UserSettingsDialog } from "@/components/dialogs/UserSettingsDialog";
import { ChannelDialog } from "@/components/dialogs/ChannelDialog";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import { MemberDialog } from "@/components/dialogs/MemberDialog";
import { BanUserDialog } from "@/components/dialogs/BanUserDialog";
import { KickUserDialog } from "@/components/dialogs/KickUserDialog";
import { NicknameDialog } from "@/components/dialogs/NicknameDialog";
import { ServerSettingsDialog } from "@/components/dialogs/ServerSettingsDialog";
import { PostChannelPanel } from "@/components/posts/PostChannelPanel";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  readSidebarWidth,
  writeSidebarWidth,
} from "@/lib/storage";
import {
  muted,
  mutingVersion,
  onMutingChanged,
  useMutedChannels,
  useServerOverride,
} from "@/lib/muting";
import { Perm, has } from "@/lib/permissions";
import { isPostChannel, type Channel, type ChannelType, type User } from "@/lib/protocol";
import type { SavedServer } from "@/lib/storage";
import { resolveServerIconUrl } from "@/lib/uploads";
import { useSession } from "@/store/session";
import {
  callLocation,
  useConnection,
  useServerRegistry,
  useServers,
  useTotalDmUnread,
  type CallLocation,
} from "@/store/servers";
import {
  assignableRoles,
  outranks,
  unreadTotals,
  useMyPermissions,
} from "@/store/selectors";
import { DirectMessagesSidebar } from "@/components/DirectMessagesSidebar";
import { DirectMessagesHome } from "@/components/DirectMessagesHome";
import { useMouseBack, useNavigation } from "@/store/navigation";

type Dialog =
  | { kind: "none" }
  | { kind: "account"; tab?: "voice" }
  | { kind: "settings" }
  | {
      kind: "channel";
      parentId?: number | null;
      initialType?: ChannelType;
      editChannelId?: number;
    }
  | { kind: "member"; userId: number; anchorRect?: DOMRect }
  | { kind: "nickname"; userId: number }
  | { kind: "confirmDeleteChannel"; channel: Channel }
  | { kind: "kickUser"; user: User }
  | { kind: "banUser"; user: User }
  | { kind: "confirmMoveCall"; channel: Channel; call: CallLocation };

type ContextMenuState =
  | { kind: "user"; x: number; y: number; user: User; serverId?: string }
  | { kind: "channel"; x: number; y: number; channel: Channel }
  | { kind: "server"; x: number; y: number }
  | { kind: "rail"; x: number; y: number; entry: SavedServer }
  | null;

import { useTranslation } from "@/lib/i18n";

interface ServerViewProps {
  onAddServer(): void;
}

function ChannelIcon({ type, size = 17 }: { type: ChannelType; size?: number }) {
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

export function ServerView({ onAddServer }: ServerViewProps) {
  const { t } = useTranslation();
  const server = useSession((state) => state.server);
  const channels = useSession((state) => state.channels);
  const roles = useSession((state) => state.roles);
  const users = useSession((state) => state.users);
  const self = useSession((state) => state.self);
  const serverId = useSession((state) => state.serverId);
  const status = useSession((state) => state.status);
  const notice = useSession((state) => state.notice);
  const dismissNotice = useSession((state) => state.dismissNotice);
  const address = useSession((state) => state.address);
  const joinChannel = useSession((state) => state.joinChannel);
  const setActiveChannel = useSession((state) => state.setActiveChannel);
  const activeConversationId = useSession((state) => state.activeConversationId);
  const setActiveConversation = useSession((state) => state.setActiveConversation);
  const openConversation = useSession((state) => state.openConversation);
  const closeConversation = useSession((state) => state.closeConversation);
  // The rail is about every server this client knows, not the one on screen,
  // so it reads the registry: bookmarks for the entries, and each connection
  // for what its entry has to say.
  const saved = useServerRegistry((state) => state.saved);
  const openHere = useServerRegistry((state) => state.connections);
  const railNotice = useServerRegistry((state) => state.notice);
  const activeSection = useServerRegistry((state) => state.activeSection);
  const setActiveSection = useServerRegistry((state) => state.setActiveSection);
  const totalDmUnread = useTotalDmUnread();
  const deleteChannel = useSession((state) => state.deleteChannel);
  const setRoleMembership = useSession((state) => state.setRoleMembership);
  const moveUser = useSession((state) => state.moveUser);
  const kickUser = useSession((state) => state.kickUser);
  const banUser = useSession((state) => state.banUser);
  const searchOpen = useSession((state) => state.search.open);
  const openSearch = useSession((state) => state.openSearch);
  const jump = useSession((state) => state.jump);
  const permissions = useMyPermissions();
  const voiceStates = useSession((state) => state.voiceStates);
  const moderateVoice = useVoice((state) => state.moderate);

  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [statusOpen, setStatusOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  // The overrides live outside every store this view reads, so the menu is
  // rebuilt from this rather than from a state change it would never see.
  const mutingTick = useSyncExternalStore(onMutingChanged, mutingVersion, mutingVersion);
  const sessionActiveChannelId = useSession((state) => state.activeChannelId);
  // Seeded from the connection so that coming back to a server — the tree is
  // replaced when one is brought to the front — opens what was last read there.
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(
    () => useSession.getState().activeChannelId,
  );
  const [membersOpen, setMembersOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth > 1100 : true,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readSidebarWidth());
  const [resizingSidebar, setResizingSidebar] = useState(false);

  const selected = selectedChannelId === null ? null : (channels.get(selectedChannelId) ?? null);
  const activePeer = activeConversationId !== null ? users.get(activeConversationId) : null;
  const activePeerName = activePeer?.nickname ?? t("common.member");

  // History navigation moves the channel by writing to the connection rather
  // than by calling in here, so the selection has to follow what the connection
  // says. Only a change that came from outside counts, which is what the
  // remembered value decides: comparing against the selection instead would
  // answer the write the effect further down has just made with the channel it
  // replaced, and the two would trade places until React gave up on the render.
  const lastActiveChannelId = useRef(sessionActiveChannelId);
  useEffect(() => {
    if (sessionActiveChannelId === lastActiveChannelId.current) return;
    lastActiveChannelId.current = sessionActiveChannelId;
    if (sessionActiveChannelId !== null && channels.has(sessionActiveChannelId)) {
      setSelectedChannelId(sessionActiveChannelId);
    }
  }, [sessionActiveChannelId, channels]);

  useEffect(() => {
    if (activeConversationId !== null) return;
    if (selectedChannelId !== null && channels.has(selectedChannelId)) return;
    const firstReadable = [...channels.values()]
      .filter((channel) => channel.type === "text" || isPostChannel(channel.type))
      .sort((a, b) => a.position - b.position)[0];
    setSelectedChannelId(firstReadable?.id ?? null);
  }, [channels, selectedChannelId, activeConversationId]);

  // Where the reader is, reported to the trail Back and Forward walk. The
  // section is recorded as it stands rather than inferred from the conversation:
  // a DM read beside the channel list is a different screen from the same DM
  // read in the DM section, and going back to the wrong one of the two would
  // rebuild the sidebar the reader did not leave.
  useEffect(() => {
    if (!serverId) return;
    useNavigation.getState().recordLocation({
      section: activeSection,
      serverId,
      channelId: activeConversationId === null ? selectedChannelId : null,
      userId: activeConversationId,
    });
  }, [activeSection, serverId, selectedChannelId, activeConversationId]);

  // Whatever is open over the view is what Back means while it is up, so each
  // of them answers the button before the history ever sees it.
  useMouseBack(drawerOpen, () => setDrawerOpen(false));
  useMouseBack(contextMenu !== null, () => setContextMenu(null));
  useMouseBack(statusOpen, () => setStatusOpen(false));

  // What is being read decides three things at once: where an arriving message
  // does not count as unread, which channel keeps its full window, and what the
  // least-recently-read cut is allowed to take.
  useEffect(() => {
    const channel = selectedChannelId === null ? null : channels.get(selectedChannelId);
    setActiveChannel(
      channel && (channel.type === "text" || isPostChannel(channel.type)) ? channel.id : null,
    );
  }, [selectedChannelId, channels, setActiveChannel]);

  // A window behind something else is not being read, so what arrives in it
  // counts. Coming back to it is what clears the channel that is open.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      const { activeChannelId, markRead } = useSession.getState();
      if (activeChannelId !== null) markRead(activeChannelId);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Prevent accidental file drop on unhandled window areas from navigating away
  useEffect(() => {
    function onWindowDragOver(event: globalThis.DragEvent) {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
      }
    }
    function onWindowDrop(event: globalThis.DragEvent) {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
      }
    }
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, []);

  // A jump names the channel it is going to, so following one is how a search
  // result opens somewhere other than where the reader already is. The message
  // list does the rest once that channel is on screen.
  useEffect(() => {
    if (jump && channels.has(jump.channelId)) {
      setActiveConversation(null);
      setSelectedChannelId(jump.channelId);
      setDrawerOpen(false);
    }
  }, [jump, channels, setActiveConversation]);

  // Ctrl+F, the shortcut everything with a search box answers to.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "f" || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      openSearch();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  const canManageServer = useMemo(
    () => has(permissions, Perm.ManageServer) || has(permissions, Perm.ManageRoles),
    [permissions],
  );
  const canManageChannels = has(permissions, Perm.ManageChannels);

  /**
   * Joining a voice channel, which is the one thing in this interface that can
   * reach across servers.
   *
   * There is one microphone, so entering a call anywhere ends the one that is
   * running. That is a decision worth putting in front of somebody rather than
   * making for them, so a call on another server is asked about first; the
   * store does what it is told either way.
   */
  function joinVoice(channel: Channel) {
    const call = callLocation();
    if (call && call.serverId !== serverId) {
      setDialog({ kind: "confirmMoveCall", channel, call });
      return;
    }
    void joinChannel(channel.id);
  }

  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    setResizingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onPointerMove(event: PointerEvent) {
      const delta = event.clientX - startX;
      const nextWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, startWidth + delta));
      setSidebarWidth(nextWidth);
    }

    function onPointerUp(event: PointerEvent) {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      setResizingSidebar(false);
      const delta = event.clientX - startX;
      const finalWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, startWidth + delta));
      setSidebarWidth(finalWidth);
      writeSidebarWidth(finalWidth);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function resetSidebarWidth() {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    writeSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }

  const contextMenuItems: MenuEntry[] = useMemo(() => {
    if (!contextMenu) return [];

    if (contextMenu.kind === "rail") {
      const entry = contextMenu.entry;
      const live = openHere.has(entry.id);
      const entries: MenuEntry[] = [
        {
          id: "rail-open",
          label: t("server.switchTo", { name: entry.name }),
          icon: <AuralMark size={16} />,
          onClick: () =>
            void useServers
              .getState()
              .connect({ address: entry.address, nickname: entry.nickname })
              .catch(() => {
                // The connect screen renders the failure.
              }),
        },
        {
          id: "rail-copy-address",
          label: t("server.copyAddress"),
          icon: <CopyIcon size={16} />,
          onClick: () => void navigator.clipboard.writeText(entry.address || entry.id),
        },
      ];
      entries.push({ type: "separator" });
      entries.push({
        id: "rail-notifications",
        label: t("contextMenu.notifications"),
        icon: <BellIcon size={16} />,
        items: notificationMenuEntries({ serverId: entry.id }),
      });
      entries.push({ type: "separator" });
      if (live) {
        entries.push({
          id: "rail-disconnect",
          label: t("server.disconnectFrom", { name: entry.name }),
          icon: <HangUpIcon size={16} />,
          onClick: () => useServers.getState().close(entry.id),
        });
      }
      entries.push({
        id: "rail-forget",
        label: t("server.forgetServer"),
        icon: <TrashIcon size={16} />,
        danger: true,
        onClick: () => useServers.getState().forget(entry.id),
      });
      return entries;
    }

    if (!server) return [];

    if (contextMenu.kind === "server") {
      const entries: MenuEntry[] = [];
      entries.push({
        id: "server-settings",
        label: t("server.serverSettings"),
        icon: <GearIcon size={16} />,
        onClick: () => setDialog({ kind: "settings" }),
      });
      if (canManageChannels) {
        entries.push(
          {
            id: "create-channel",
            label: t("server.createChannel"),
            icon: <PlusIcon size={16} />,
            onClick: () => setDialog({ kind: "channel", parentId: null }),
          },
          {
            id: "create-category",
            label: t("server.createCategory"),
            icon: <FolderIcon size={16} />,
            onClick: () => setDialog({ kind: "channel", parentId: null, initialType: "category" }),
          },
        );
      }
      entries.push({ type: "separator" });
      if (serverId) {
        entries.push({
          id: "server-notifications",
          label: t("contextMenu.notifications"),
          icon: <BellIcon size={16} />,
          items: notificationMenuEntries({ serverId }),
        });
        entries.push({ type: "separator" });
      }
      entries.push(
        {
          id: "copy-address",
          label: t("server.copyAddress"),
          icon: <CopyIcon size={16} />,
          onClick: () => void navigator.clipboard.writeText(address?.label ?? address?.raw ?? ""),
        },
        {
          id: "copy-name",
          label: t("contextMenu.copyServerName"),
          icon: <CopyIcon size={16} />,
          onClick: () => void navigator.clipboard.writeText(server.name),
        },
      );
      return entries;
    }

    if (contextMenu.kind === "channel") {
      const ch = contextMenu.channel;
      const isCat = ch.type === "category";
      const entries: MenuEntry[] = [];

      if (isCat && canManageChannels) {
        entries.push({
          id: "create-in-category",
          label: t("server.createChannel"),
          icon: <PlusIcon size={16} />,
          onClick: () => setDialog({ kind: "channel", parentId: ch.id }),
        });
        entries.push({ type: "separator" });
      }

      if (canManageChannels) {
        entries.push(
          {
            id: "edit-channel",
            label: isCat ? t("contextMenu.editCategory") : t("contextMenu.editChannel"),
            icon: <PencilIcon size={16} />,
            onClick: () => setDialog({ kind: "channel", editChannelId: ch.id }),
          },
          {
            id: "delete-channel",
            label: isCat ? t("contextMenu.deleteCategory") : t("contextMenu.deleteChannel"),
            icon: <TrashIcon size={16} />,
            danger: true,
            onClick: () => setDialog({ kind: "confirmDeleteChannel", channel: ch }),
          },
        );
        entries.push({ type: "separator" });
      }

      // A category is a heading rather than somewhere messages land, so there
      // is nothing about it to be notified of.
      if (serverId && !isCat) {
        entries.push({
          id: "channel-notifications",
          label: t("contextMenu.notifications"),
          icon: <BellIcon size={16} />,
          items: notificationMenuEntries({ serverId, channelId: ch.id }),
        });
        entries.push({ type: "separator" });
      }

      entries.push({
        id: "copy-id",
        label: isCat ? t("contextMenu.copyCategoryId") : t("contextMenu.copyChannelId"),
        icon: <CopyIcon size={16} />,
        onClick: () => void navigator.clipboard.writeText(String(ch.id)),
      });

      return entries;
    }

    if (contextMenu.kind === "user") {
      const u = contextMenu.user;
      const isSelf = self?.id === u.id;
      const canChangeNick = isSelf
        ? has(permissions, Perm.ChangeNickname)
        : has(permissions, Perm.ManageNicknames) && outranks(self, u, roles);
      const canManageRoles = has(permissions, Perm.ManageRoles);
      const assignable = assignableRoles(self, roles);
      // Kicking is offered for both online and offline members as long as you outrank them.
      const canKick =
        !isSelf && has(permissions, Perm.KickUsers) && outranks(self, u, roles);
      // Banning is its own permission and its own act: a kick ends a
      // connection, a ban is a standing refusal that reaches the address and
      // the machine behind it.
      const canBan =
        !isSelf && has(permissions, Perm.BanUsers) && outranks(self, u, roles) && !u.owner;
      const canMove = has(permissions, Perm.MoveUsers) && u.channelId !== null;

      const entries: MenuEntry[] = [
        {
          id: "profile",
          label: t("contextMenu.profile"),
          icon: <UserIcon size={16} />,
          onClick: () =>
            setDialog({
              kind: "member",
              userId: u.id,
              anchorRect: new DOMRect(contextMenu.x, contextMenu.y, 0, 0),
            }),
        },
      ];

      if (!isSelf && (server?.directMessages ?? false)) {
        entries.push({
          id: "message",
          label: t("contextMenu.message"),
          icon: <MessageSquareIcon size={16} />,
          onClick: () => {
            const targetServer = contextMenu.serverId ?? serverId;
            if (targetServer && targetServer !== serverId) {
              useServers.getState().focus(targetServer);
              const store = useServers.getState().connections.get(targetServer);
              if (store) {
                store.getState().setActiveChannel(null);
                void store.getState().openConversation(u.id).then(() => {
                  store.getState().setActiveConversation(u.id);
                });
              }
            } else {
              setSelectedChannelId(null);
              void openConversation(u.id).then(() => {
                setActiveConversation(u.id);
              });
            }
          },
        });
      }

      if (canChangeNick) {
        entries.push({
          id: "change-nick",
          label: t("contextMenu.changeNickname"),
          icon: <PencilIcon size={16} />,
          onClick: () => setDialog({ kind: "nickname", userId: u.id }),
        });
      }


      if (canManageRoles && assignable.length > 0) {
        const userRoleSet = new Set(u.roles ?? []);
        entries.push({
          id: "roles-sub",
          label: t("contextMenu.roles"),
          icon: <ShieldIcon size={16} />,
          items: assignable.map((r) => ({
            id: `role-${r.id}`,
            label: r.name,
            checked: userRoleSet.has(r.id),
            keepOpen: true,
            onClick: () => void setRoleMembership(u.id, r.id, !userRoleSet.has(r.id)),
          })),
        });
      }

      if (canMove) {
        const voiceChannels = [...channels.values()]
          .filter((c) => c.type === "voice" && c.id !== u.channelId)
          .sort((a, b) => a.position - b.position);

        if (voiceChannels.length > 0) {
          entries.push({
            id: "move-sub",
            label: t("permissions.names.MoveUsers"),
            icon: <VoiceIcon size={16} />,
            items: voiceChannels.map((vc) => ({
              id: `move-${vc.id}`,
              label: vc.name,
              icon: <VoiceIcon size={14} />,
              onClick: () => void moveUser(u.id, vc.id),
            })),
          });
        }

        entries.push({
          id: "disconnect-voice",
          label: t("userPanel.disconnect"),
          icon: <HangUpIcon size={16} />,
          danger: true,
          onClick: () => void moveUser(u.id, null),
        });
      }

      // Moderating somebody's audio only means anything while they are in a
      // channel to be heard in, and only somebody they are ranked below may do
      // it. Both are checked again by the server.
      const voiceState = voiceStates.get(u.id);
      if (!isSelf && voiceState && outranks(self, u, roles)) {
        if (has(permissions, Perm.MuteUsers)) {
          entries.push({
            id: "voice-mute",
            label: voiceState.mute ? t("voice.serverUnmute") : t("voice.serverMute"),
            icon: voiceState.mute ? <MicIcon size={16} /> : <MicOffIcon size={16} />,
            onClick: () => void moderateVoice(u.id, { mute: !voiceState.mute }),
          });
        }
        if (has(permissions, Perm.DeafenUsers)) {
          entries.push({
            id: "voice-deafen",
            label: voiceState.deaf ? t("voice.serverUndeafen") : t("voice.serverDeafen"),
            icon: voiceState.deaf ? <HeadphonesIcon size={16} /> : <HeadphonesOffIcon size={16} />,
            onClick: () => void moderateVoice(u.id, { deaf: !voiceState.deaf }),
          });
        }
      }

      if (canKick || canBan) {
        entries.push({ type: "separator" });
      }
      if (canKick) {
        entries.push({
          id: "kick",
          label: t("contextMenu.kickMember", { name: u.nickname }),
          icon: <UserXIcon size={16} />,
          danger: true,
          onClick: () => setDialog({ kind: "kickUser", user: u }),
        });
      }
      if (canBan) {
        entries.push({
          id: "ban",
          label: t("contextMenu.banMember", { name: u.nickname }),
          icon: <GavelIcon size={16} />,
          danger: true,
          onClick: () => setDialog({ kind: "banUser", user: u }),
        });
      }

      entries.push({ type: "separator" });
      entries.push({
        id: "copy-id",
        label: t("contextMenu.copyUserId"),
        icon: <CopyIcon size={16} />,
        onClick: () => void navigator.clipboard.writeText(String(u.id)),
      });

      return entries;
    }

    return [];
  }, [
    contextMenu,
    server,
    openHere,
    address,
    canManageServer,
    canManageChannels,
    deleteChannel,
    self,
    permissions,
    roles,
    channels,
    setRoleMembership,
    moveUser,
    kickUser,
    banUser,
    voiceStates,
    moderateVoice,
    serverId,
    mutingTick,
    t,
  ]);

  // A connection that is up but has not been told anything yet: dialling, or
  // signing somebody else in on the same address. The rail is not drawn here
  // because this is a whole-screen moment, and it is a short one.
  if (!server) {
    return (
      <div className="content">
        <div className="placeholder">
          <span className="spinner" />
          <p className="placeholder__body">
            {status === "reconnecting"
              ? t("server.reconnectingBanner")
              : t("server.connectingBanner")}
          </p>
        </div>
      </div>
    );
  }

  // Search and the member list share the right-hand column: one query at a
  // time is what somebody is reading, and the results are that query.
  const shellClasses = ["app"];
  if (searchOpen) shellClasses.push("app--with-search");
  else if (membersOpen) shellClasses.push("app--with-members", "app--members-open");
  if (drawerOpen) shellClasses.push("app--drawer-open");
  if (resizingSidebar) shellClasses.push("app--resizing-sidebar");

  return (
    <div
      className={shellClasses.join(" ")}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <nav className="rail" aria-label={t("connect.savedServers")}>
        <button
          type="button"
          className={`rail__item rail__item--dms ${activeSection === "dms" ? "rail__item--active" : ""}`}
          onClick={() => setActiveSection("dms")}
          title={t("dm.directMessages")}
          aria-label={t("dm.directMessages")}
          aria-current={activeSection === "dms" ? "true" : undefined}
        >
          <AuralMark size={24} />
          {totalDmUnread > 0 && activeSection !== "dms" ? (
            <span className="rail__badge rail__badge--mention">
              {totalDmUnread > 99 ? "99+" : totalDmUnread}
            </span>
          ) : null}
        </button>

        <div className="rail__separator" role="separator" aria-hidden="true" />

        {saved.map((entry) => (
          <RailServer
            key={entry.id}
            entry={entry}
            active={activeSection === "server" && entry.id === serverId}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({ kind: "rail", x: event.clientX, y: event.clientY, entry });
            }}
          />
        ))}

        <button
          className="rail__item rail__item--add"
          onClick={onAddServer}
          title={t("server.addServer")}
          aria-label={t("server.addServer")}
        >
          <PlusIcon size={18} />
        </button>
      </nav>

      <aside className="sidebar">
        {activeSection === "dms" ? (
          <DirectMessagesSidebar
            activeServerId={serverId}
            activeUserId={activeConversationId}
            onSelectConversation={(targetServerId, userId) => {
              useServers.getState().focus(targetServerId);
              const store = useServers.getState().connections.get(targetServerId);
              if (store) {
                store.getState().setActiveChannel(null);
                void store.getState().openConversation(userId).then(() => {
                  store.getState().setActiveConversation(userId);
                });
              }
              setDrawerOpen(false);
            }}
            onCloseConversation={(targetServerId, userId) => {
              const store = useServers.getState().connections.get(targetServerId);
              store?.getState().closeConversation(userId);
              if (targetServerId === serverId && userId === activeConversationId) {
                setActiveConversation(null);
              }
            }}
            onContextMenuMember={(e, u, targetServerId) => {
              setContextMenu({ kind: "user", x: e.clientX, y: e.clientY, user: u, serverId: targetServerId });
            }}
            onOpenAccount={() => setDialog({ kind: "account" })}
            onOpenStatus={() => setStatusOpen(true)}
            onOpenVoiceSettings={() => setDialog({ kind: "account", tab: "voice" })}
          />
        ) : (
          <>
            <header
              className="sidebar__header"
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenu({ kind: "server", x: rect.left, y: rect.bottom + 4 });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ kind: "server", x: e.clientX, y: e.clientY });
              }}
            >
              <span className="sidebar__name" title={server.description || server.name}>
                {server.name}
              </span>
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <ChevronIcon size={14} />
              </span>
            </header>

            <ChannelSidebar
              selectedChannelId={selectedChannelId}
              onSelectChannel={(id) => {
                setActiveConversation(null);
                setSelectedChannelId(id);
                setDrawerOpen(false);
              }}
              activeConversationId={activeConversationId}
              onSelectConversation={(userId) => {
                setSelectedChannelId(null);
                setActiveConversation(userId);
                setDrawerOpen(false);
              }}
              onCloseConversation={(userId) => {
                closeConversation(userId);
              }}
              onJoinVoice={joinVoice}
              onCreateChannel={(parentId) => setDialog({ kind: "channel", parentId })}
              onOpenMember={(userId, anchorRect) => setDialog({ kind: "member", userId, anchorRect })}
              onDeleteChannel={(channel) => setDialog({ kind: "confirmDeleteChannel", channel })}
              onContextMenuChannel={(e, channel) => {
                setContextMenu({ kind: "channel", x: e.clientX, y: e.clientY, channel });
              }}
              onContextMenuMember={(e, user) => {
                setContextMenu({ kind: "user", x: e.clientX, y: e.clientY, user });
              }}
              onContextMenuServer={(e) => {
                setContextMenu({ kind: "server", x: e.clientX, y: e.clientY });
              }}
            />

            <VoicePanel onOpenVoiceSettings={() => setDialog({ kind: "account", tab: "voice" })} />

            <UserPanel
              onOpenAccount={() => setDialog({ kind: "account" })}
              onOpenStatus={() => setStatusOpen(true)}
            />
          </>
        )}

        <div
          className="sidebar__resizer"
          onPointerDown={startResize}
          onDoubleClick={resetSidebarWidth}
          title="Drag to resize (double click to reset)"
          role="separator"
          aria-orientation="vertical"
        />
      </aside>

      <main className="main">
        {activeSection === "dms" ? (
          activeConversationId !== null ? (
            <>
              <header className="topbar">
                <button
                  className="iconbtn drawer-toggle"
                  onClick={() => setDrawerOpen((open) => !open)}
                  aria-label={t("server.channels")}
                >
                  <MenuIcon size={18} />
                </button>

                <div className="topbar__dm-info" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span className="topbar__title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <MessageSquareIcon size={17} />
                    <span>{activePeerName}</span>
                  </span>

                  {activePeer?.customStatus ? (
                    <span className="topbar__topic">{activePeer.customStatus}</span>
                  ) : null}

                  {/* Server identification badge */}
                  <span
                    className="topbar__server-badge"
                    title={`${server.name} • ${address?.label ?? address?.raw ?? serverId}`}
                  >
                    <FolderIcon size={12} />
                    <span className="topbar__server-badge-name">{server.name}</span>
                    <span className="topbar__server-badge-addr">({address?.label ?? address?.raw ?? serverId})</span>
                  </span>
                </div>

                <span className="topbar__spacer" />

                <button
                  className="iconbtn"
                  onClick={() => setActiveConversation(null)}
                  title={t("dm.close")}
                  aria-label={t("dm.close")}
                >
                  <CloseIcon size={18} />
                </button>
              </header>

              <DirectMessagePanel
                key={`${serverId}-${activeConversationId}`}
                userId={activeConversationId}
                onOpenMember={(userId, anchorRect) => setDialog({ kind: "member", userId, anchorRect })}
                onContextMenuMember={(e, user) => {
                  setContextMenu({ kind: "user", x: e.clientX, y: e.clientY, user });
                }}
              />
            </>
          ) : (
            <>
              <header className="topbar">
                <button
                  className="iconbtn drawer-toggle"
                  onClick={() => setDrawerOpen((open) => !open)}
                  aria-label={t("server.channels")}
                >
                  <MenuIcon size={18} />
                </button>
                <span className="topbar__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AuralMark size={18} />
                  <span>{t("dm.homeTitle")}</span>
                </span>
              </header>

              <DirectMessagesHome
                onSelectConversation={(targetServerId, userId) => {
                  useServers.getState().focus(targetServerId);
                  const store = useServers.getState().connections.get(targetServerId);
                  if (store) {
                    store.getState().setActiveChannel(null);
                    void store.getState().openConversation(userId).then(() => {
                      store.getState().setActiveConversation(userId);
                    });
                  }
                }}
              />
            </>
          )
        ) : (
          <>
            <header className="topbar">
              <button
                className="iconbtn drawer-toggle"
                onClick={() => setDrawerOpen((open) => !open)}
                aria-label={t("server.channels")}
              >
                <MenuIcon size={18} />
              </button>

              <span className="topbar__title">
                {activeConversationId !== null ? (
                  <>
                    <MessageSquareIcon size={17} />
                    <span>{activePeerName}</span>
                  </>
                ) : selected ? (
                  <>
                    <ChannelIcon type={selected.type} size={17} />
                    <span>{selected.name}</span>
                  </>
                ) : (
                  <span>{server.name}</span>
                )}
              </span>
              {activeConversationId !== null && activePeer?.customStatus ? (
                <span className="topbar__topic">{activePeer.customStatus}</span>
              ) : selected?.topic ? (
                <span className="topbar__topic">{selected.topic}</span>
              ) : null}

              {activeConversationId !== null ? (
                <span
                  className="topbar__server-badge"
                  title={`${server.name} • ${address?.label ?? address?.raw ?? serverId}`}
                >
                  <FolderIcon size={12} />
                  <span className="topbar__server-badge-name">{server.name}</span>
                  <span className="topbar__server-badge-addr">({address?.label ?? address?.raw ?? serverId})</span>
                </span>
              ) : null}

              <span className="topbar__spacer" />

              {activeConversationId !== null ? (
                <button
                  className="iconbtn"
                  onClick={() => setActiveConversation(null)}
                  title={t("dm.close")}
                  aria-label={t("dm.close")}
                >
                  <CloseIcon size={18} />
                </button>
              ) : null}

              <SearchBar />

              <button
                className="iconbtn"
                onClick={() => setMembersOpen((open) => !open)}
                title={t("server.toggleMembers")}
                aria-label={t("server.toggleMembers")}
                aria-pressed={membersOpen}
              >
                <UsersIcon size={18} />
              </button>
            </header>

            {notice ?? railNotice ? (
              <div className="notice">
                <span>{notice ?? railNotice}</span>
                <button
                  className="notice__close"
                  onClick={notice ? dismissNotice : () => useServers.getState().dismissNotice()}
                  aria-label={t("common.close")}
                >
                  <CloseIcon size={15} />
                </button>
              </div>
            ) : null}

            {activeConversationId !== null ? (
              <DirectMessagePanel
                key={activeConversationId}
                userId={activeConversationId}
                onOpenMember={(userId, anchorRect) => setDialog({ kind: "member", userId, anchorRect })}
                onContextMenuMember={(e, user) => {
                  setContextMenu({ kind: "user", x: e.clientX, y: e.clientY, user });
                }}
              />
            ) : selected?.type === "text" ? (
              <ChatPanel
                key={selected.id}
                channel={selected}
                onOpenMember={(userId, anchorRect) => setDialog({ kind: "member", userId, anchorRect })}
                onContextMenuMember={(e, user) => {
                  setContextMenu({ kind: "user", x: e.clientX, y: e.clientY, user });
                }}
              />
            ) : selected && isPostChannel(selected.type) ? (
              <PostChannelPanel
                key={selected.id}
                channel={selected}
                onOpenMember={(userId, anchorRect) => setDialog({ kind: "member", userId, anchorRect })}
              />
            ) : (
              <div className="content">
                <div className="placeholder">
                  <span className="placeholder__icon" style={{ color: "var(--accent)" }}>
                    <AuralMark size={30} />
                  </span>
                  <h2 className="placeholder__title">{server.name}</h2>
                  <p className="placeholder__body">
                    {server.description ||
                      "Pick a text channel to read it, or a voice channel to join it."}
                  </p>
                  <p className="field__hint">
                    {t("connect.voiceModeServer")}:{" "}
                    {server.voiceMode === "client_host"
                      ? t("connect.voiceModeClient")
                      : t("connect.voiceModeServer")}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {searchOpen ? (
        <SearchResults />
      ) : (
        <MemberList
          onOpenMember={(userId, anchorRect) => setDialog({ kind: "member", userId, anchorRect })}
          onContextMenuMember={(e, user) => {
            setContextMenu({ kind: "user", x: e.clientX, y: e.clientY, user });
          }}
        />
      )}

      {drawerOpen ? (
        <div className="scrim--drawer" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      ) : null}
      {membersOpen ? (
        <div className="scrim--members" onClick={() => setMembersOpen(false)} aria-hidden="true" />
      ) : null}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {statusOpen ? (
        <StatusPopover
          onClose={() => setStatusOpen(false)}
          onOpenSettings={() => {
            setStatusOpen(false);
            setDialog({ kind: "account" });
          }}
        />
      ) : null}

      {dialog.kind === "account" ? (
        <UserSettingsDialog initialTab={dialog.tab} onClose={() => setDialog({ kind: "none" })} />
      ) : null}
      {dialog.kind === "settings" ? (
        <ServerSettingsDialog onClose={() => setDialog({ kind: "none" })} />
      ) : null}
      {dialog.kind === "channel" ? (
        <ChannelDialog
          parentId={dialog.parentId}
          initialType={dialog.initialType}
          editChannelId={dialog.editChannelId}
          onClose={() => setDialog({ kind: "none" })}
        />
      ) : null}
      {dialog.kind === "member" ? (
        <MemberDialog
          key={dialog.userId}
          userId={dialog.userId}
          anchorRect={dialog.anchorRect}
          onClose={() => setDialog({ kind: "none" })}
          onOpenConversation={(userId) => {
            setSelectedChannelId(null);
            setActiveConversation(userId);
            setDrawerOpen(false);
          }}
        />
      ) : null}
      {dialog.kind === "nickname" ? (
        <NicknameDialog userId={dialog.userId} onClose={() => setDialog({ kind: "none" })} />
      ) : null}
      {dialog.kind === "confirmDeleteChannel" ? (
        <ConfirmDialog
          title={dialog.channel.type === "category" ? t("dialogs.confirm.deleteCategoryTitle") : t("dialogs.confirm.deleteChannelTitle")}
          subtitle={
            dialog.channel.type === "category"
              ? t("dialogs.confirm.deleteCategoryConfirm", { name: dialog.channel.name })
              : t("dialogs.confirm.deleteChannelConfirm", { name: dialog.channel.name })
          }
          confirmText={t("common.delete")}
          danger
          onConfirm={() => {
            void deleteChannel(dialog.channel.id);
          }}
          onClose={() => setDialog({ kind: "none" })}
        />
      ) : null}
      {dialog.kind === "confirmMoveCall" ? (
        <ConfirmDialog
          title={t("dialogs.confirm.moveCallTitle")}
          subtitle={t("dialogs.confirm.moveCallConfirm", {
            channel: dialog.call.channelName,
            server: dialog.call.serverName,
            target: dialog.channel.name,
          })}
          confirmText={t("dialogs.confirm.moveCallButton")}
          danger={false}
          onConfirm={() => {
            // Taking the microphone leaves the other call: `moveCallTo` does
            // that on the way in, so there is nothing to undo here first.
            void joinChannel(dialog.channel.id);
          }}
          onClose={() => setDialog({ kind: "none" })}
        />
      ) : null}
      {dialog.kind === "kickUser" ? (
        <KickUserDialog
          user={dialog.user}
          onConfirm={(reason, deleteMessages) => {
            void kickUser(dialog.user.id, reason, deleteMessages);
          }}
          onClose={() => setDialog({ kind: "none" })}
        />
      ) : null}
      {dialog.kind === "banUser" ? (
        <BanUserDialog
          user={dialog.user}
          onConfirm={(input) => {
            void banUser({ ...input, userId: dialog.user.id });
          }}
          onClose={() => setDialog({ kind: "none" })}
        />
      ) : null}
    </div>
  );
}

/**
 * One entry of the server rail.
 *
 * It reads its own connection rather than the one in the foreground, because
 * the point of the rail is what the servers nobody is looking at have to say:
 * whether they are up, what is waiting in them, and which one has the call.
 */
function RailServer({
  entry,
  active,
  onContextMenu,
}: {
  entry: SavedServer;
  active: boolean;
  onContextMenu(event: React.MouseEvent): void;
}) {
  const { t } = useTranslation();
  const status = useConnection(entry.id, (state) => state.status);
  const unread = useConnection(entry.id, (state) => state.unread);
  const conversations = useConnection(entry.id, (state) => state.conversations);
  const name = useConnection(entry.id, (state) => state.server?.name) ?? entry.name;
  const liveIcon = useConnection(entry.id, (state) => state.server?.icon);
  const liveAddress = useConnection(entry.id, (state) => state.address);
  const inCall = useServerRegistry((state) => state.voiceId === entry.id);
  const dialing = useServerRegistry((state) => state.dialing.includes(entry.id));
  const [imgError, setImgError] = useState(false);

  const iconUrl = useMemo(() => {
    if (liveIcon) {
      return resolveServerIconUrl(liveIcon, liveAddress ?? entry.address);
    }
    return entry.icon ? resolveServerIconUrl(entry.icon, entry.address) : null;
  }, [liveIcon, liveAddress, entry.icon, entry.address]);

  useEffect(() => {
    setImgError(false);
  }, [iconUrl]);

  // A silenced server shows no badge at all, and a silenced channel adds
  // nothing to one that is otherwise drawn. Private messages are counted
  // either way while the server itself is not muted: they were addressed to
  // this person, not to a channel they happen to be in.
  const silenced = muted(useServerOverride(entry.id));
  const mutedChannels = useMutedChannels(entry.id);

  const waiting = useMemo(() => {
    if (silenced) return { count: 0, mentions: 0 };
    const totals = unreadTotals(unread, (channelId) => mutedChannels.has(channelId));
    let dmCount = 0;
    if (conversations) {
      for (const conv of conversations.values()) {
        dmCount += conv.unread;
      }
    }
    return {
      count: totals.count + dmCount,
      mentions: totals.mentions + dmCount,
    };
  }, [unread, conversations, silenced, mutedChannels]);

  const hasIcon = Boolean(iconUrl && !imgError);

  const classes = ["rail__item"];
  if (active) classes.push("rail__item--active");
  if (hasIcon) classes.push("rail__item--has-icon");
  if (status === "connected") classes.push("rail__item--live");
  if (dialing || status === "connecting" || status === "reconnecting") {
    classes.push("rail__item--pending");
  }
  if (waiting.count > 0) classes.push("rail__item--unread");
  if (silenced) classes.push("rail__item--muted");

  const title = dialing
    ? t("server.connectingTo", { name })
    : status === "reconnecting"
      ? t("server.reconnectingTo", { name })
      : silenced
        ? `${name} — ${t("contextMenu.muteServer")}`
        : waiting.mentions > 0
          ? `${name} — ${t("server.unreadMentions", { count: waiting.mentions })}`
          : waiting.count > 0
            ? `${name} — ${t("server.unreadMessages", { count: waiting.count })}`
            : name;

  return (
    <button
      className={classes.join(" ")}
      onClick={() => {
        useServers.getState().setActiveSection("server");
        void useServers
          .getState()
          .connect({ address: entry.address, nickname: entry.nickname })
          .catch(() => {
            // The connect screen renders the failure; the entry stays put.
          });
      }}
      onContextMenu={onContextMenu}
      title={title}
      aria-label={title}
      aria-current={active ? "true" : undefined}
    >
      {hasIcon ? (
        <span className="rail__icon-wrapper">
          <img
            className="rail__icon"
            src={iconUrl!}
            alt={name}
            onError={() => setImgError(true)}
          />
        </span>
      ) : (
        <span className="rail__initials">{name.slice(0, 1).toUpperCase()}</span>
      )}
      {waiting.count > 0 && !active ? (
        <span
          className={
            waiting.mentions > 0 ? "rail__badge rail__badge--mention" : "rail__badge"
          }
        >
          {waiting.count > 99 ? "99+" : waiting.count}
        </span>
      ) : null}
      {inCall ? <span className="rail__call" title={t("server.inCall")} aria-hidden="true" /> : null}
    </button>
  );
}
