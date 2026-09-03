import { useMemo } from "react";

import { useTranslation } from "@/lib/i18n";
import { useAllConversations } from "@/store/servers";
import { Avatar } from "./Avatar";
import { AuralMark, FolderIcon, MessageSquareIcon, UsersIcon } from "./Icons";

export interface DirectMessagesHomeProps {
  onSelectConversation(serverId: string, userId: number): void;
}

/**
 * Welcoming Discord-style Direct Messages home view displayed when in DM mode
 * and no conversation is actively open.
 */
export function DirectMessagesHome({ onSelectConversation }: DirectMessagesHomeProps) {
  const { t } = useTranslation();
  const conversations = useAllConversations();

  const recentItems = useMemo(() => {
    return conversations.slice(0, 12);
  }, [conversations]);

  return (
    <div className="dm-home">
      <div className="dm-home__content">
        <header className="dm-home__hero">
          <div className="dm-home__icon-wrap">
            <AuralMark size={42} />
          </div>
          <h1 className="dm-home__title">{t("dm.homeTitle")}</h1>
          <p className="dm-home__subtitle">{t("dm.homeSubtitle")}</p>
        </header>

        {recentItems.length > 0 ? (
          <section className="dm-home__section">
            <h2 className="dm-home__section-title">
              <MessageSquareIcon size={16} />
              <span>{t("dm.title")}</span>
            </h2>

            <div className="dm-home__grid">
              {recentItems.map((item) => {
                const peer = item.peer;
                const name = peer?.nickname ?? t("common.member");

                return (
                  <div
                    key={item.key}
                    role="button"
                    tabIndex={0}
                    className="dm-home__card"
                    onClick={() => onSelectConversation(item.serverId, item.userId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectConversation(item.serverId, item.userId);
                      }
                    }}
                  >
                    <div className="dm-home__card-avatar">
                      {peer ? (
                        <Avatar user={peer} size="md" status={peer.status} showStatus />
                      ) : (
                        <span className="dm-list__ghost" aria-hidden="true" />
                      )}
                    </div>

                    <div className="dm-home__card-body">
                      <div className="dm-home__card-name-row">
                        <span className="dm-home__card-name">{name}</span>
                        {item.unread > 0 ? (
                          <span className="dm-home__card-badge">
                            {item.unread > 99 ? "99+" : item.unread}
                          </span>
                        ) : null}
                      </div>

                      {/* Server badge for instant disambiguation */}
                      <div className="dm-home__card-server">
                        <FolderIcon size={12} className="dm-home__card-server-icon" />
                        <span className="dm-home__card-server-name">{item.serverName}</span>
                        <span className="dm-home__card-server-ip">{item.serverAddress}</span>
                      </div>

                      <p className="dm-home__card-snippet">
                        {item.lastMessage?.content || t("dm.empty")}
                      </p>
                    </div>

                    <button
                      type="button"
                      className="btn btn--primary btn--sm dm-home__card-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectConversation(item.serverId, item.userId);
                      }}
                    >
                      {t("dm.startChat")}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <div className="dm-home__empty-box">
            <div className="dm-home__empty-icon">
              <UsersIcon size={32} />
            </div>
            <h3 className="dm-home__empty-title">{t("dm.empty")}</h3>
            <p className="dm-home__empty-hint">{t("dm.emptyHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
