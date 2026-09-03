import { useMemo } from "react";

import { useTranslation } from "@/lib/i18n";
import type { User } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { Avatar } from "./Avatar";
import { CloseIcon } from "./Icons";

interface DirectMessageListProps {
  /** The conversation on screen, or null while a channel is being read. */
  activeUserId: number | null;
  onSelect(userId: number): void;
  onCloseConversation?(userId: number): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
  maxItems?: number;
  onViewAll?(): void;
}

/**
 * The private conversations this client is holding, most recently spoken in
 * first.
 *
 * It draws nothing at all until there is one. A section that is empty on every
 * server nobody has written on would be a permanent heading over a permanent
 * blank, and the way to start a conversation is a person rather than this list.
 */
export function DirectMessageList({
  activeUserId,
  onSelect,
  onCloseConversation,
  onContextMenuMember,
  maxItems,
  onViewAll,
}: DirectMessageListProps) {
  const { t } = useTranslation();
  const server = useSession((state) => state.server);
  const users = useSession((state) => state.users);
  const conversations = useSession((state) => state.conversations);

  const ordered = useMemo(
    () => [...conversations.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt),
    [conversations],
  );

  const visible = useMemo(
    () => (maxItems && maxItems > 0 ? ordered.slice(0, maxItems) : ordered),
    [ordered, maxItems],
  );

  if (!(server?.directMessages ?? false) || ordered.length === 0) return null;

  return (
    <section className="dm-list">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 className="dm-list__label">{t("dm.title")}</h3>
      </div>
      {visible.map((conversation) => {
        const peer = users.get(conversation.userId);
        const name = peer?.nickname ?? t("common.member");
        const classes = ["dm-list__item"];
        if (conversation.userId === activeUserId) classes.push("dm-list__item--active");
        if (conversation.unread > 0) classes.push("dm-list__item--unread");

        return (
          <div
            key={conversation.userId}
            role="button"
            tabIndex={0}
            className={classes.join(" ")}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest(".dm-list__close")) return;
              onSelect(conversation.userId);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                if ((e.target as HTMLElement).closest(".dm-list__close")) return;
                e.preventDefault();
                onSelect(conversation.userId);
              }
            }}
            onContextMenu={(event) => {
              if (!peer || !onContextMenuMember) return;
              event.preventDefault();
              event.stopPropagation();
              onContextMenuMember(event, peer);
            }}
            title={name}
          >
            {peer ? (
              <Avatar user={peer} size="sm" status={peer.status} showStatus />
            ) : (
              <span className="dm-list__ghost" aria-hidden="true" />
            )}
            <span className="dm-list__body">
              <span className="dm-list__name">{name}</span>
              {conversation.lastMessage ? (
                <span className="dm-list__preview">{conversation.lastMessage.content}</span>
              ) : null}
            </span>
            {conversation.unread > 0 ? (
              <span
                className="dm-list__badge"
                title={t("dm.unread", { count: conversation.unread })}
              >
                {conversation.unread > 99 ? "99+" : conversation.unread}
              </span>
            ) : null}
            {onCloseConversation ? (
              <button
                type="button"
                className="dm-list__close"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseConversation(conversation.userId);
                }}
                title={t("dm.close")}
                aria-label={t("dm.close")}
              >
                <CloseIcon size={14} />
              </button>
            ) : null}
          </div>
        );
      })}

      {onViewAll && ordered.length > (maxItems ?? Infinity) ? (
        <button
          type="button"
          className="dm-list__more"
          onClick={onViewAll}
          title={t("dm.viewAll", { count: ordered.length })}
        >
          {t("dm.viewAll", { count: ordered.length })}
        </button>
      ) : null}
    </section>
  );
}
