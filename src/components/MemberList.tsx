import { useMemo } from "react";

import { CrownIcon } from "@/components/Icons";
import { useTranslation } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { colorRoleOf, groupMembers, isOnline } from "@/store/selectors";
import type { RelayMember, User } from "@/lib/protocol";
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
  const activeChannelId = useSession((state) => state.activeChannelId);
  const relayRosters = useSession((state) => state.relayRosters);

  const groups = useMemo(() => groupMembers(users, roles), [users, roles]);

  // The Discord side of this channel, when it is bridged to one. It hangs off
  // the channel rather than the server because a link is a pair of channels:
  // two channels here can be bridged to two different Discord servers, and one
  // list of "the people on Discord" would be a list of two rooms at once.
  const roster = activeChannelId === null ? undefined : relayRosters.get(activeChannelId);

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

        {roster ? <RelayGroup roster={roster} /> : null}
      </div>
    </aside>
  );
}

/**
 * The people on the Discord side of a bridged channel.
 *
 * A section of its own, below the members, and deliberately not clickable.
 * These are not identities on this server: there is no profile to open, no
 * private thread to start, nothing to moderate. Drawing them as buttons would
 * promise all of that. What they are for is the question a bridged channel
 * actually raises — is anyone over there to answer — and, once a name is on
 * screen, being able to type it.
 */
function RelayGroup({ roster }: { roster: import("@/lib/protocol").RelayRoster }) {
  const { t } = useTranslation();

  if (roster.unavailable) {
    return (
      <section className="members__group">
        <h3 className="members__label">{t("members.discord")}</h3>
        <p className="members__notice">{roster.unavailable}</p>
      </section>
    );
  }
  if (roster.members.length === 0) return null;

  const online = roster.members.filter((m) => m.status !== "offline").length;
  const hidden = Math.max(0, roster.total - roster.members.length);

  return (
    <section className="members__group">
      <h3 className="members__label members__label--discord">
        {roster.guildName
          ? t("members.discordOn", { name: roster.guildName, count: online })
          : t("members.discordOnline", { count: online })}
      </h3>
      {roster.members.map((member) => (
        <div
          key={member.id}
          className={member.status === "offline" ? "member member--offline member--relay" : "member member--relay"}
          title={member.handle ? `@${member.handle}` : member.name}
        >
          <Avatar user={relayAvatar(member)} size="md" status={member.status} showStatus />
          <span className="member__body">
            <span className="member__title">
              <span className="member__name">{member.name}</span>
              {member.bot ? <span className="member__tag">{t("members.bot")}</span> : null}
            </span>
            <span className="member__meta">{member.handle ? `@${member.handle}` : t("members.discord")}</span>
          </span>
        </div>
      ))}
      {hidden > 0 ? <p className="members__notice">{t("members.discordMore", { count: hidden })}</p> : null}
    </section>
  );
}

/**
 * A Discord member in the shape the avatar draws.
 *
 * The id is only ever used to pick a fallback colour, and a snowflake does not
 * survive being made a number — so it is folded into one rather than parsed,
 * which keeps the same person the same colour without pretending the value
 * means anything.
 */
function relayAvatar(member: RelayMember) {
  let hash = 0;
  for (let i = 0; i < member.id.length; i += 1) {
    hash = (hash * 31 + member.id.charCodeAt(i)) | 0;
  }
  return { id: hash, nickname: member.name, avatar: member.avatar ?? null, status: member.status };
}
