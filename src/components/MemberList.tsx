import { useMemo } from "react";

import { CrownIcon } from "@/components/Icons";
import { useTranslation } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { colorRoleOf, groupMembers, isOnline } from "@/store/selectors";
import type { User } from "@/lib/protocol";
import { Avatar } from "./Avatar";
import { ActivityGlyph, activityText, activityTooltip } from "./ActivityCard";

interface MemberListProps {
  onOpenMember(userId: number, anchorRect?: DOMRect): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
}

/**
 * Everyone on the server, grouped by their highest hoisted role, with the
 * members who are not connected gathered at the bottom.
 */
export function MemberList({ onOpenMember, onContextMenuMember }: MemberListProps) {
  const { t } = useTranslation();
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);
  const channels = useSession((state) => state.channels);

  const groups = useMemo(() => groupMembers(users, roles), [users, roles]);

  return (
    <aside className="members">
      <div className="members__list">
        {groups.map((group) => {
          const count = group.members.length;
          const heading =
            group.key === "members"
              ? t("members.online", { count })
              : group.key === "offline"
                ? t("members.offline", { count })
                : t("members.roleGroup", { name: group.label, count });
          return (
            <section key={group.key} className="members__group">
              <h3 className="members__label" style={{ color: group.color ?? undefined }}>
                {heading}
              </h3>
              {group.members.map((user) => {
                const color = colorRoleOf(user, roles)?.color;
                const channel = user.channelId === null ? null : channels.get(user.channelId);
                return (
                  <button
                    key={user.id}
                    className={isOnline(user) ? "member" : "member member--offline"}
                    onClick={(e) => onOpenMember(user.id, e.currentTarget.getBoundingClientRect())}
                    onContextMenu={(event) => {
                      if (onContextMenuMember) {
                        event.preventDefault();
                        event.stopPropagation();
                        onContextMenuMember(event, user);
                      }
                    }}
                  >
                    <Avatar user={user} size="md" status={user.status} showStatus />
                    <span className="member__body">
                      <span className="member__title">
                        <span className="member__name" style={{ color: color || undefined }}>
                          {user.nickname}
                        </span>
                        {/* The owner is marked in the list itself: it is the
                            one standing nobody can read off a role colour. */}
                        {user.owner ? (
                          <CrownIcon size={12} className="member__crown" />
                        ) : null}
                      </span>
                      {(() => {
                        // One line, four things that could go in it. The voice
                        // channel wins because it is where they are rather
                        // than what they are doing, and an activity beats a
                        // custom status because it is live: the status was
                        // written once and is true all week, the activity is
                        // true now and will be wrong in ten minutes.
                        const activity = channel ? null : user.activity;
                        const meta = channel
                          ? channel.name
                          : activity
                            ? activityText(activity)
                            : user.customStatus
                              ? user.customStatus
                              : user.registered
                                ? t("common.member")
                                : t("common.guest");
                        return (
                          <span
                            className="member__meta"
                            // The hover carries the verb and the application
                            // that the line itself has no room for.
                            title={activity ? activityTooltip(activity) : meta}
                          >
                            {activity ? <ActivityGlyph activity={activity} /> : null}
                            {meta}
                          </span>
                        );
                      })()}
                    </span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
