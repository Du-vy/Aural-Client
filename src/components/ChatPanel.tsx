import { useEffect } from "react";

import { Perm, has } from "@/lib/permissions";
import type { Channel, User } from "@/lib/protocol";
import { EMPTY_HISTORY, useSession } from "@/store/session";
import { useChannelPermissions } from "@/store/selectors";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";

import { useTranslation } from "@/lib/i18n";

interface ChatPanelProps {
  channel: Channel;
  onOpenMember?(userId: number): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
}

/** One text channel: its history, and the box to add to it. */
export function ChatPanel({
  channel,
  onOpenMember,
  onContextMenuMember,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);
  const self = useSession((state) => state.self);
  const history = useSession((state) => state.history.get(channel.id)) ?? EMPTY_HISTORY;

  const openChannel = useSession((state) => state.openChannel);
  const loadOlder = useSession((state) => state.loadOlder);
  const loadNewer = useSession((state) => state.loadNewer);
  const returnToPresent = useSession((state) => state.returnToPresent);
  const jump = useSession((state) => state.jump);
  const clearJump = useSession((state) => state.clearJump);
  const sendMessage = useSession((state) => state.sendMessage);
  const editMessage = useSession((state) => state.editMessage);
  const deleteMessage = useSession((state) => state.deleteMessage);

  const server = useSession((state) => state.server);
  const uploadAttachment = useSession((state) => state.uploadAttachment);

  const permissions = useChannelPermissions(channel.id);
  const canSend = has(permissions, Perm.SendMessages);
  const canAttach = has(permissions, Perm.AttachFiles);
  const canManageMessages = has(permissions, Perm.ManageMessages);

  // History is fetched the first time a channel is opened and then kept, so
  // switching back and forth does not re-fetch what is already held.
  useEffect(() => {
    void openChannel(channel.id);
  }, [channel.id, openChannel]);

  return (
    <div className="chatpanel">
      <MessageList
        channelName={channel.name}
        messages={history.messages}
        users={users}
        roles={roles}
        selfId={self?.id ?? null}
        hasMore={history.hasMore}
        hasMoreAfter={history.hasMoreAfter}
        loading={history.loading}
        error={history.error}
        canManageMessages={canManageMessages}
        jump={jump?.channelId === channel.id ? jump : null}
        onJumpDone={clearJump}
        onLoadOlder={() => void loadOlder(channel.id)}
        onLoadNewer={() => void loadNewer(channel.id)}
        onReturnToPresent={() => void returnToPresent(channel.id)}
        onEdit={(messageId, content) => void editMessage(messageId, content)}
        onDelete={(messageId) => void deleteMessage(messageId)}
        onOpenMember={onOpenMember}
        onContextMenuMember={onContextMenuMember}
      />

      <MessageComposer
        channelId={channel.id}
        channelName={channel.name}
        disabledReason={canSend ? null : t("chat.messageDisabledPlaceholder")}
        canAttach={canAttach}
        limits={server?.uploads ?? null}
        onSend={(content, attachments) => sendMessage(channel.id, content, attachments)}
        onUpload={(file, onProgress) => uploadAttachment(channel.id, file, onProgress)}
      />
    </div>
  );
}

