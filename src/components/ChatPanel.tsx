import { useEffect, useRef, useState, type DragEvent } from "react";

import { Perm, has } from "@/lib/permissions";
import type { Channel, User } from "@/lib/protocol";
import { EMPTY_HISTORY, useSession } from "@/store/session";
import { useChannelPermissions } from "@/store/selectors";
import { MessageComposer, type MessageComposerHandle } from "./MessageComposer";
import { MessageList } from "./MessageList";
import { UploadCloudIcon } from "./Icons";
import { formatBytes, parseBytes } from "@/lib/uploads";

import { useTranslation } from "@/lib/i18n";

interface ChatPanelProps {
  channel: Channel;
  onOpenMember?(userId: number, anchorRect?: DOMRect): void;
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

  const composerRef = useRef<MessageComposerHandle>(null);
  const [dragDepth, setDragDepth] = useState(0);

  // History is fetched the first time a channel is opened and then kept, so
  // switching back and forth does not re-fetch what is already held.
  useEffect(() => {
    void openChannel(channel.id);
  }, [channel.id, openChannel]);

  useEffect(() => {
    setDragDepth(0);
  }, [channel.id]);

  function carriesFiles(event: DragEvent): boolean {
    return [...(event.dataTransfer?.types ?? [])].includes("Files");
  }

  function handleDragEnter(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    setDragDepth((d) => d + 1);
  }

  function handleDragOver(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const uploadsAllowed = canAttach && (server?.uploads?.enabled ?? false);
    event.dataTransfer.dropEffect = uploadsAllowed ? "copy" : "none";
  }

  function handleDragLeave(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    setDragDepth((d) => Math.max(0, d - 1));
  }

  function handleDrop(event: DragEvent) {
    setDragDepth(0);
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const uploadsAllowed = canAttach && (server?.uploads?.enabled ?? false);
    if (!uploadsAllowed) return;
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      composerRef.current?.addFiles(event.dataTransfer.files);
    }
  }

  const isDraggingFiles = dragDepth > 0;
  const maxBytes = parseBytes(server?.uploads?.maxFileBytes);

  return (
    <div
      className="chatpanel"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingFiles ? (
        <div className="chatpanel__drop-overlay" aria-hidden="true">
          <div className="chatpanel__drop-card">
            <div className="chatpanel__drop-icon">
              <UploadCloudIcon size={44} />
            </div>
            <h3 className="chatpanel__drop-title">
              {canAttach
                ? t("attachments.dropHere", { channel: channel.name })
                : t("attachments.notAllowed")}
            </h3>
            {canAttach && maxBytes > 0 ? (
              <p className="chatpanel__drop-hint">
                {t("attachments.maxFileSize", { limit: formatBytes(maxBytes) })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

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
        ref={composerRef}
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


