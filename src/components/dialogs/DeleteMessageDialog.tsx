import { isEmojiOnly } from "@/lib/emoji";
import { formatFull, formatTime } from "@/lib/time";
import type { Message, Role, User } from "@/lib/protocol";
import { colorRoleOf } from "@/store/selectors";
import { Avatar } from "../Avatar";
import { Modal } from "../Modal";

interface DeleteMessageDialogProps {
  message: Message;
  author?: User;
  roles: ReadonlyMap<number, Role>;
  onConfirm(): void;
  onClose(): void;
}

export function DeleteMessageDialog({
  message,
  author,
  roles,
  onConfirm,
  onClose,
}: DeleteMessageDialogProps) {
  const color = author ? (colorRoleOf(author, roles)?.color ?? null) : null;

  return (
    <Modal
      title="Delete Message"
      subtitle="Are you sure you want to delete this message?"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--danger"
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            autoFocus
          >
            Delete
          </button>
        </>
      }
    >
      <div className="msg-preview">
        <div className="msg msg--preview">
          <div className="msg__gutter">
            {author ? (
              <Avatar user={author} size="md" />
            ) : (
              <span className="msg__avatar-offline" aria-hidden="true">
                {message.author.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div className="msg__body">
            <div className="msg__head">
              <span className="msg__author" style={color ? { color } : undefined}>
                {message.author}
              </span>
              <time className="msg__time" title={formatFull(message.createdAt)}>
                {formatTime(message.createdAt)}
              </time>
            </div>
            <p className={isEmojiOnly(message.content) ? "msg__content msg__content--jumbo" : "msg__content"}>
              {message.content}
            </p>
          </div>
        </div>
      </div>

      <div className="confirm-tip">
        <span className="confirm-tip__tag">PROTIP:</span>
        <span>
          You can hold <kbd className="kbd">Shift</kbd> when clicking delete to bypass this confirmation.
        </span>
      </div>
    </Modal>
  );
}
