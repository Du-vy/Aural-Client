import { useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import type { User } from "@/lib/protocol";
import { formatTime, formatDay } from "@/lib/time";
import { useAllConversations } from "@/store/servers";
import { Avatar } from "./Avatar";
import { CloseIcon, FolderIcon, MessageSquareIcon, SearchIcon } from "./Icons";
import { UserPanel } from "./UserPanel";
import { VoicePanel } from "./VoicePanel";

export interface DirectMessagesSidebarProps {
  activeServerId: string | null;
  activeUserId: number | null;
  onSelectConversation(serverId: string, userId: number): void;
  onCloseConversation(serverId: string, userId: number): void;
  onContextMenuMember?(event: React.MouseEvent, user: User, serverId: string): void;
  onOpenAccount(): void;
  onOpenStatus(): void;
  onOpenVoiceSettings(): void;
}

function formatRelativeTime(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const nowSeconds = Math.floor(Date.now() / 1000);
  const diff = nowSeconds - seconds;
  if (diff < 86400) {
    return formatTime(seconds);
  }
  return formatDay(seconds);
}

/**
 * Dedicated Discord-style sidebar for Direct Messages.
 * Aggregates private conversations across all connected servers with clear
 * server identity chips (name and IP/host) to prevent ambiguous chats with the
 * same username across different servers.
 */
export function DirectMessagesSidebar({
  activeServerId,
  activeUserId,
  onSelectConversation,
  onCloseConversation,
  onContextMenuMember,
  onOpenAccount,
  onOpenStatus,
  onOpenVoiceSettings,
}: DirectMessagesSidebarProps) {
  const { t } = useTranslation();
  const conversations = useAllConversations();
  const [search, setSearch] = useState("");
  const [serverFilter, setServerFilter] = useState<string | null>(null);

  // Distinct servers with conversations, for the quick-filter strip
  const serverOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const c of conversations) {
      if (!map.has(c.serverId)) {
        map.set(c.serverId, { id: c.serverId, name: c.serverName });
      }
    }
    return Array.from(map.values());
  }, [conversations]);

  const filtered = useMemo(() => {
    let list = conversations;
    if (serverFilter) {
      list = list.filter((c) => c.serverId === serverFilter);
    }
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((c) => {
      const name = c.peer?.nickname?.toLowerCase() ?? "";
      const username = c.peer?.username?.toLowerCase() ?? "";
      const sName = c.serverName.toLowerCase();
      const sAddr = c.serverAddress.toLowerCase();
      const last = c.lastMessage?.content.toLowerCase() ?? "";
      return (
        name.includes(q) ||
        username.includes(q) ||
        sName.includes(q) ||
        sAddr.includes(q) ||
        last.includes(q)
      );
    });
  }, [conversations, search, serverFilter]);

  return (
    <div className="dm-sidebar">
      <header className="dm-sidebar__header">
        <div className="dm-sidebar__title-row">
          <span className="dm-sidebar__title">{t("dm.directMessages")}</span>
          <span className="dm-sidebar__count">{conversations.length}</span>
        </div>

        <div className="dm-sidebar__search">
          <SearchIcon size={14} className="dm-sidebar__search-icon" />
          <input
            type="text"
            className="dm-sidebar__search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("dm.searchPlaceholder")}
            aria-label={t("dm.searchPlaceholder")}
          />
          {search ? (
            <button
              type="button"
              className="dm-sidebar__search-clear"
              onClick={() => setSearch("")}
              aria-label={t("common.cancel")}
            >
              <CloseIcon size={12} />
            </button>
          ) : null}
        </div>

        {serverOptions.length > 1 ? (
          <div className="dm-sidebar__filters" role="tablist" aria-label={t("dm.allServers")}>
            <button
              type="button"
              className={`dm-sidebar__pill ${serverFilter === null ? "dm-sidebar__pill--active" : ""}`}
              onClick={() => setServerFilter(null)}
            >
              {t("dm.allServers")}
            </button>
            {serverOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`dm-sidebar__pill ${serverFilter === opt.id ? "dm-sidebar__pill--active" : ""}`}
                onClick={() => setServerFilter(opt.id)}
                title={opt.name}
              >
                {opt.name}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div className="dm-sidebar__scroll">
        <div className="dm-sidebar__section-label">{t("dm.title")}</div>

        {filtered.length === 0 ? (
          <div className="dm-sidebar__empty">
            <MessageSquareIcon size={26} className="dm-sidebar__empty-icon" />
            <p className="dm-sidebar__empty-title">
              {search
                ? t("dm.noFilteredResults", { query: search })
                : t("dm.empty")}
            </p>
            {!search && (
              <p className="dm-sidebar__empty-hint">{t("dm.emptyHint")}</p>
            )}
          </div>
        ) : (
          filtered.map((item) => {
            const isActive =
              item.serverId === activeServerId && item.userId === activeUserId;
            const peer = item.peer;
            const name = peer?.nickname ?? t("common.member");
            const timeStr = formatRelativeTime(item.lastMessageAt);

            const classes = ["dm-card"];
            if (isActive) classes.push("dm-card--active");
            if (item.unread > 0) classes.push("dm-card--unread");

            return (
              <div
                key={item.key}
                role="button"
                tabIndex={0}
                className={classes.join(" ")}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest(".dm-card__close")) return;
                  onSelectConversation(item.serverId, item.userId);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    if ((e.target as HTMLElement).closest(".dm-card__close")) return;
                    e.preventDefault();
                    onSelectConversation(item.serverId, item.userId);
                  }
                }}
                onContextMenu={(e) => {
                  if (!peer || !onContextMenuMember) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenuMember(e, peer, item.serverId);
                }}
                title={`${name} — ${item.serverName} (${item.serverAddress})`}
              >
                <div className="dm-card__avatar-wrap">
                  {peer ? (
                    <Avatar user={peer} size="sm" status={peer.status} showStatus />
                  ) : (
                    <span className="dm-list__ghost" aria-hidden="true" />
                  )}
                </div>

                <div className="dm-card__body">
                  <div className="dm-card__top">
                    <span className="dm-card__name">{name}</span>
                    {timeStr ? <span className="dm-card__time">{timeStr}</span> : null}
                  </div>

                  {/* Prominent server disambiguation chip */}
                  <div className="dm-card__server-row">
                    <span
                      className="dm-card__server-chip"
                      title={`${item.serverName} • ${item.serverAddress}`}
                    >
                      <FolderIcon size={11} className="dm-card__server-icon" />
                      <span className="dm-card__server-name">{item.serverName}</span>
                      <span className="dm-card__server-ip">{item.serverAddress}</span>
                    </span>
                  </div>

                  {item.lastMessage ? (
                    <p className="dm-card__preview">{item.lastMessage.content}</p>
                  ) : null}
                </div>

                <div className="dm-card__end">
                  {item.unread > 0 ? (
                    <span
                      className="dm-card__badge"
                      title={t("dm.unread", { count: item.unread })}
                    >
                      {item.unread > 99 ? "99+" : item.unread}
                    </span>
                  ) : null}

                  <button
                    type="button"
                    className="dm-card__close"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseConversation(item.serverId, item.userId);
                    }}
                    title={t("dm.close")}
                    aria-label={t("dm.close")}
                  >
                    <CloseIcon size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <VoicePanel onOpenVoiceSettings={onOpenVoiceSettings} />
      <UserPanel onOpenAccount={onOpenAccount} onOpenStatus={onOpenStatus} />
    </div>
  );
}
