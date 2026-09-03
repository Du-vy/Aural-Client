import { useEffect, useMemo } from "react";

import { useTranslation } from "@/lib/i18n";
import { buildMentions } from "@/lib/mentions";
import { Perm, has } from "@/lib/permissions";
import type { User } from "@/lib/protocol";
import { EMPTY_DIRECT_HISTORY, useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { Avatar } from "./Avatar";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";

interface DirectMessagePanelProps {
  /** The other person. A conversation is named by them and by nothing else. */
  userId: number;
  onOpenMember?(userId: number, anchorRect?: DOMRect): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
}

/**
 * One private conversation: its lines, and the box to add to it.
 *
 * It is the channel panel with the channel taken out. What is genuinely
 * different is small — there are no files, no permissions to resolve per
 * channel, and the reason writing may be unavailable can be your own privacy
 * setting rather than somebody else's decision about you.
 */
export function DirectMessagePanel({
  userId,
  onOpenMember,
  onContextMenuMember,
}: DirectMessagePanelProps) {
  const { t } = useTranslation();
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);
  const self = useSession((state) => state.self);
  const server = useSession((state) => state.server);
  const history = useSession((state) => state.directHistory.get(userId)) ?? EMPTY_DIRECT_HISTORY;

  const openConversation = useSession((state) => state.openConversation);
  const loadOlderDirect = useSession((state) => state.loadOlderDirect);
  const sendDirectMessage = useSession((state) => state.sendDirectMessage);
  const editDirectMessage = useSession((state) => state.editDirectMessage);
  const deleteDirectMessage = useSession((state) => state.deleteDirectMessage);
  const permissions = useMyPermissions();

  const peer = users.get(userId);
  const name = peer?.nickname ?? t("common.member");

  // The picker resolves against the same directory a channel uses. A name that
  // means nothing here still means somebody on this server, and writing it is
  // how you tell the other person who you are talking about.
  const mentions = useMemo(() => buildMentions(users, roles), [users, roles]);

  useEffect(() => {
    void openConversation(userId);
  }, [userId, openConversation]);

  // Three separate reasons the box may be closed, and they read differently:
  // the server carries none, this member is not allowed to send any, or they
  // turned their own off — which stops their writing as well as everybody
  // else's, and is the one they can undo themselves.
  const disabledReason = !(server?.directMessages ?? false)
    ? t("dm.serverDisabled")
    : !has(permissions, Perm.SendDirectMessages)
      ? t("dm.noPermission")
      : self?.dmPrivacy === "none"
        ? t("dm.selfDisabled")
        : null;

  return (
    <div className="chatpanel">
      <MessageList
        channelName={name}
        messages={history.messages}
        users={users}
        roles={roles}
        self={self}
        mentions={mentions}
        hasMore={history.hasMore}
        hasMoreAfter={history.hasMoreAfter}
        loading={history.loading}
        error={history.error}
        // Nobody moderates a private conversation: there is no third person in
        // it to hold the permission, so only your own lines are yours to
        // remove.
        canManageMessages={false}
        jump={null}
        startIcon={peer ? <Avatar user={peer} size="lg" /> : null}
        startTitle={t("dm.startTitle", { name })}
        startBody={t("dm.startBody")}
        onJumpDone={() => {}}
        onLoadOlder={() => void loadOlderDirect(userId)}
        onLoadNewer={() => {}}
        onReturnToPresent={() => {}}
        onEdit={(messageId, content) => void editDirectMessage(messageId, content)}
        onDelete={(messageId) => void deleteDirectMessage(messageId)}
        onOpenMember={onOpenMember}
        onContextMenuMember={onContextMenuMember}
      />

      <MessageComposer
        draftKey={`dm-${userId}`}
        channelName={name}
        placeholder={t("dm.placeholder", { name })}
        disabledReason={disabledReason}
        // A private conversation carries no files: an upload is bound to the
        // channel it was made for, and there is no channel here to bind one to.
        canAttach={false}
        limits={null}
        mentions={mentions}
        onSend={(content) => sendDirectMessage(userId, content)}
        onUpload={() => ({
          done: Promise.reject(new Error(t("dm.noAttachments"))),
          cancel: () => {},
        })}
      />
    </div>
  );
}
