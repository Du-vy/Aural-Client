import { useMemo } from "react";

import { useSession } from "@/store/session";
import { colorRoleOf, groupMembers } from "@/store/selectors";
import type { User } from "@/lib/protocol";
import { Avatar } from "./Avatar";

interface MemberListProps {
  onOpenMember(userId: number): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
}

/** Everyone connected, grouped by their highest hoisted role. */
export function MemberList({ onOpenMember, onContextMenuMember }: MemberListProps) {
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);
  const channels = useSession((state) => state.channels);

  const groups = useMemo(() => groupMembers(users, roles), [users, roles]);

  return (
    <aside className="members">
      <div className="members__list">
        {groups.map((group) => (
          <section key={group.key} className="members__group">
            <h3 className="members__label" style={{ color: group.color ?? undefined }}>
              {group.label} — {group.members.length}
            </h3>
            {group.members.map((user) => {
              const color = colorRoleOf(user, roles)?.color;
              const channel = user.channelId === null ? null : channels.get(user.channelId);
              return (
                <button
                  key={user.id}
                  className="member"
                  onClick={() => onOpenMember(user.id)}
                  onContextMenu={(event) => {
                    if (onContextMenuMember) {
                      event.preventDefault();
                      onContextMenuMember(event, user);
                    }
                  }}
                >
                  <Avatar user={user} size="md" online />
                  <span className="member__body">
                    <span className="member__name" style={{ color: color || undefined }}>
                      {user.nickname}
                    </span>
                    <span className="member__meta">
                      {channel ? `In ${channel.name}` : user.registered ? "Member" : "Guest"}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}
