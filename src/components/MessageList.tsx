import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { extractUrls, getDomain } from "@/lib/links";
import { openExternalUrl } from "@/lib/open";
import { isDomainTrusted } from "@/lib/storage";
import { GROUPING_WINDOW_SECONDS, formatDay, formatFull, formatTime, sameDay } from "@/lib/time";
import type { Message, Role, User } from "@/lib/protocol";
import type { JumpTarget } from "@/store/session";
import { colorRoleOf } from "@/store/selectors";
import { Avatar } from "./Avatar";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import { DeleteMessageDialog } from "./dialogs/DeleteMessageDialog";
import { ExternalLinkDialog } from "./dialogs/ExternalLinkDialog";
import { ChevronIcon, CopyIcon, HashIcon, LinkIcon, PencilIcon, TrashIcon } from "./Icons";
import { MessageContent } from "./MessageContent";
import { MessageAttachments } from "./attachments/MessageAttachments";

/**
 * One rendered row. A message either opens a block, carrying its author and
 * timestamp, or continues one, showing neither.
 */
interface Row {
  message: Message;
  /** The day separator to draw above this message, if any. */
  daySeparator: string | null;
  /** Whether this message starts a new block rather than continuing one. */
  startsBlock: boolean;
}

/**
 * Groups a run of messages the way a chat client is expected to: consecutive
 * messages from one author, close together in time and on the same day, share
 * a single header.
 */
export function buildRows(messages: readonly Message[], now: Date = new Date()): Row[] {
  const rows: Row[] = [];

  for (const [index, message] of messages.entries()) {
    const previous = index > 0 ? messages[index - 1] : undefined;

    const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
    const sameAuthor =
      previous !== undefined &&
      previous.userId === message.userId &&
      previous.author === message.author;
    const withinWindow =
      previous !== undefined &&
      message.createdAt - previous.createdAt <= GROUPING_WINDOW_SECONDS;

    rows.push({
      message,
      daySeparator: newDay ? formatDay(message.createdAt, now) : null,
      startsBlock: newDay || !sameAuthor || !withinWindow,
    });
  }
  return rows;
}

interface MessageListProps {
  channelName: string;
  messages: readonly Message[];
  users: ReadonlyMap<number, User>;
  roles: ReadonlyMap<number, Role>;
  selfId: number | null;
  hasMore: boolean;
  /**
   * Whether newer messages remain past the last one held, which is true only
   * while the reader is looking at a window they jumped back to.
   */
  hasMoreAfter: boolean;
  loading: boolean;
  error: string | null;
  canManageMessages: boolean;
  /** Where a search result asked the view to go, when it is in this channel. */
  jump: JumpTarget | null;
  onJumpDone(nonce: number): void;
  onLoadOlder(): void;
  onLoadNewer(): void;
  onReturnToPresent(): void;
  onEdit(messageId: number, content: string): void;
  onDelete(messageId: number): void;
  onOpenMember?(userId: number): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
}

export function MessageList({
  channelName,
  messages,
  users,
  roles,
  selfId,
  hasMore,
  hasMoreAfter,
  loading,
  error,
  canManageMessages,
  jump,
  onJumpDone,
  onLoadOlder,
  onLoadNewer,
  onReturnToPresent,
  onEdit,
  onDelete,
  onOpenMember,
  onContextMenuMember,
}: MessageListProps) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  /** Whether the reader is at the bottom, and so wants to follow along. */
  const following = useRef(true);
  /** Scroll height before an older page is prepended, to hold the position. */
  const anchor = useRef<{ height: number; top: number } | null>(null);
  /** The row a jump landed on, marked until the reader looks somewhere else. */
  const [landed, setLanded] = useState<number | null>(null);

  const [editing, setEditing] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Message | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    message: Message;
  } | null>(null);

  const rows = useMemo(() => buildRows(messages), [messages]);
  const newest = messages.at(-1)?.id ?? 0;
  const oldest = messages[0]?.id ?? 0;

  function requestDelete(message: Message, shiftKey = false) {
    if (shiftKey) {
      onDelete(message.id);
    } else {
      setPendingDelete(message);
    }
  }

  function handleOpenLink(url: string) {
    const domain = getDomain(url);
    if (isDomainTrusted(domain)) {
      void openExternalUrl(url);
    } else {
      setPendingLink(url);
    }
  }

  // Following the conversation means staying pinned to the bottom as messages
  // arrive, but never yanking a reader away from older messages they scrolled
  // back to. A window jumped into is never the present, so it never follows.
  useEffect(() => {
    if (following.current && !hasMoreAfter) bottom.current?.scrollIntoView({ block: "end" });
  }, [newest, hasMoreAfter]);

  // A jump moves the view to one message and marks it. This runs after the
  // effect above, which is what lets it win: the page a jump loads ends in a
  // new newest id, and following it to the bottom is exactly what must not
  // happen here.
  useEffect(() => {
    if (!jump) return;
    const row = scroller.current?.querySelector(`[data-message="${jump.messageId}"]`);
    if (!row) return;
    following.current = false;
    row.scrollIntoView({ block: "center" });
    setLanded(jump.messageId);
    onJumpDone(jump.nonce);
  }, [jump, messages, onJumpDone]);

  // Prepending a page must not move what the reader is looking at, so the
  // scroll position is restored by the amount the content grew.
  useLayoutEffect(() => {
    const node = scroller.current;
    const held = anchor.current;
    if (!node || !held) return;
    anchor.current = null;
    node.scrollTop = held.top + (node.scrollHeight - held.height);
  }, [oldest]);

  function handleScroll() {
    const node = scroller.current;
    if (!node) return;
    const fromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    following.current = fromBottom < 80;

    if (node.scrollTop < 120 && hasMore && !loading) {
      anchor.current = { height: node.scrollHeight, top: node.scrollTop };
      onLoadOlder();
    }
    // Reading past the end of a window jumped into walks it forward, which is
    // how somebody follows a search result into the conversation that came
    // after it rather than being thrown back to the present.
    if (fromBottom < 120 && hasMoreAfter && !loading) {
      onLoadNewer();
    }
  }

  const menuEntries: MenuEntry[] = useMemo(() => {
    if (!contextMenu) return [];
    const msg = contextMenu.message;
    const isAuthor = msg.userId !== null && msg.userId === selfId;
    const canDelete = isAuthor || canManageMessages;
    const entries: MenuEntry[] = [];

    if (isAuthor) {
      entries.push({
        id: "edit",
        label: t("common.edit"),
        icon: <PencilIcon size={15} />,
        onClick: () => setEditing(msg.id),
      });
    }

    if (canDelete) {
      entries.push({
        id: "delete",
        label: t("common.delete"),
        icon: <TrashIcon size={15} />,
        danger: true,
        onClick: () => requestDelete(msg, false),
      });
    }

    if (entries.length > 0) {
      entries.push({ type: "separator" });
    }

    if (msg.content.trim() !== "") {
      entries.push({
        id: "copy-text",
        label: t("common.copy"),
        icon: <CopyIcon size={15} />,
        onClick: () => void navigator.clipboard.writeText(msg.content),
      });
    }

    const urls = extractUrls(msg.content);
    if (urls.length === 1) {
      entries.push({
        id: "copy-link",
        label: t("common.copyLink"),
        icon: <LinkIcon size={15} />,
        onClick: () => void navigator.clipboard.writeText(urls[0]!),
      });
    } else if (urls.length > 1) {
      entries.push({
        id: "copy-link",
        label: t("common.copyLink"),
        icon: <LinkIcon size={15} />,
        items: urls.map((u, i) => ({
          id: `copy-link-${i}`,
          label: u,
          onClick: () => void navigator.clipboard.writeText(u),
        })),
      });
    }

    entries.push(
      {
        id: "copy-id",
        label: t("server.copyId"),
        icon: <CopyIcon size={15} />,
        onClick: () => void navigator.clipboard.writeText(String(msg.id)),
      },
    );

    return entries;
  }, [contextMenu, selfId, canManageMessages, t]);

  return (
    <div className="chat" ref={scroller} onScroll={handleScroll}>
      {hasMore ? (
        <div className="chat__older">
          <button className="btn btn--ghost" onClick={onLoadOlder} disabled={loading}>
            {loading ? t("chat.loadingHistory") : t("chat.loadOlder")}
          </button>
        </div>
      ) : (
        <div className="chat__start">
          <span className="chat__start-icon">
            <HashIcon size={26} />
          </span>
          <h2 className="chat__start-title">{t("chat.welcomeTitle", { channel: channelName })}</h2>
          <p className="chat__start-body">{t("chat.welcomeSubtitle", { channel: channelName })}</p>
        </div>
      )}


      {error ? <p className="chat__error">{error}</p> : null}

      {rows.map(({ message, daySeparator, startsBlock }) => (
        <div
          key={message.id}
          data-message={message.id}
          className={message.id === landed ? "chat__row chat__row--landed" : "chat__row"}
        >
          {daySeparator ? (
            <div className="chat__day">
              <span>{daySeparator}</span>
            </div>
          ) : null}
          <MessageRow
            message={message}
            startsBlock={startsBlock}
            author={message.userId === null ? undefined : users.get(message.userId)}
            roles={roles}
            editable={message.userId !== null && message.userId === selfId}
            deletable={
              canManageMessages || (message.userId !== null && message.userId === selfId)
            }
            editing={editing === message.id}
            onStartEdit={() => setEditing(message.id)}
            onCancelEdit={() => setEditing(null)}
            onSubmitEdit={(content) => {
              setEditing(null);
              onEdit(message.id, content);
            }}
            onDelete={(e) => requestDelete(message, e.shiftKey)}
            onOpenMember={onOpenMember}
            onContextMenuMember={onContextMenuMember}
            onOpenLink={handleOpenLink}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({ x: event.clientX, y: event.clientY, message });
            }}
          />
        </div>
      ))}

      <div ref={bottom} />

      {hasMoreAfter ? (
        <div className="chat__present">
          <span>{t("results.jumpToPresent")}</span>
          <button className="chat__present-action" onClick={onReturnToPresent}>
            {t("results.jumpToPresentAction")}
            <ChevronIcon size={14} />
          </button>
        </div>
      ) : null}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuEntries}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {pendingDelete ? (
        <DeleteMessageDialog
          message={pendingDelete}
          author={pendingDelete.userId === null ? undefined : users.get(pendingDelete.userId)}
          roles={roles}
          onConfirm={() => onDelete(pendingDelete.id)}
          onClose={() => setPendingDelete(null)}
        />
      ) : null}

      {pendingLink ? (
        <ExternalLinkDialog
          url={pendingLink}
          onConfirm={() => void openExternalUrl(pendingLink)}
          onClose={() => setPendingLink(null)}
        />
      ) : null}
    </div>
  );
}

interface MessageRowProps {
  message: Message;
  startsBlock: boolean;
  /** The live user record, when the author happens to be connected. */
  author: User | undefined;
  roles: ReadonlyMap<number, Role>;
  editable: boolean;
  deletable: boolean;
  editing: boolean;
  onStartEdit(): void;
  onCancelEdit(): void;
  onSubmitEdit(content: string): void;
  onDelete(event: React.MouseEvent): void;
  onOpenMember?(userId: number): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
  onOpenLink(url: string): void;
  onContextMenu?(event: React.MouseEvent): void;
}

function MessageRow({
  message,
  startsBlock,
  author,
  roles,
  editable,
  deletable,
  editing,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onDelete,
  onOpenMember,
  onContextMenuMember,
  onOpenLink,
  onContextMenu,
}: MessageRowProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(message.content);

  // The author's colour is only knowable while they are connected, because
  // roles travel with the live user record and not with the message.
  const color = author ? (colorRoleOf(author, roles)?.color ?? null) : null;

  return (
    <div
      className={startsBlock ? "msg msg--first" : "msg"}
      onContextMenu={onContextMenu}
    >
      <div className="msg__gutter">
        {startsBlock ? (
          author ? (
            <button
              type="button"
              className="msg__avatar-btn"
              onClick={() => onOpenMember?.(author.id)}
              onContextMenu={(event) => {
                if (onContextMenuMember) {
                  event.preventDefault();
                  event.stopPropagation();
                  onContextMenuMember(event, author);
                }
              }}
              title={author.nickname}
            >
              <Avatar user={author} size="md" />
            </button>
          ) : (
            <span className="msg__avatar-offline" aria-hidden="true">
              {message.author.slice(0, 1).toUpperCase()}
            </span>
          )
        ) : (
          <time className="msg__inline-time" title={formatFull(message.createdAt)}>
            {formatTime(message.createdAt)}
          </time>
        )}
      </div>

      <div className="msg__body">
        {startsBlock ? (
          <div className="msg__head">
            {author ? (
              <button
                type="button"
                className="msg__author-btn"
                onClick={() => onOpenMember?.(author.id)}
                onContextMenu={(event) => {
                  if (onContextMenuMember) {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenuMember(event, author);
                  }
                }}
                style={color ? { color } : undefined}
              >
                {message.author}
              </button>
            ) : (
              <span className="msg__author" style={color ? { color } : undefined}>
                {message.author}
              </span>
            )}
            <time className="msg__time" title={formatFull(message.createdAt)}>
              {formatTime(message.createdAt)}
            </time>
          </div>
        ) : null}

        {editing ? (
          <form
            className="msg__edit"
            onSubmit={(event) => {
              event.preventDefault();
              const content = draft.trim();
              if (content && content !== message.content) onSubmitEdit(content);
              else onCancelEdit();
            }}
          >
            <textarea
              className="input msg__edit-input"
              value={draft}
              autoFocus
              rows={Math.min(draft.split("\n").length, 8)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onCancelEdit();
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <p className="field__hint">
              {t("chat.enterToSave")}, {t("chat.escapeToCancel")}
            </p>
          </form>
        ) : null}

        {editing ? (
          // An edit rewrites the words and never touches the files, so they
          // stay on screen rather than blinking out for the length of the edit.
          message.attachments && message.attachments.length > 0 ? (
            <MessageAttachments attachments={message.attachments} onOpenLink={onOpenLink} />
          ) : null
        ) : (
          <MessageContent
            content={message.content}
            editedAt={message.editedAt}
            attachments={message.attachments}
            onOpenLink={onOpenLink}
          />
        )}
      </div>

      {editing ? null : (
        <div className="msg__actions">
          {editable ? (
            <button
              className="iconbtn"
              onClick={() => {
                setDraft(message.content);
                onStartEdit();
              }}
              title={t("common.edit")}
              aria-label={t("chat.editMessageAria")}
            >
              <PencilIcon size={14} />
            </button>
          ) : null}
          {deletable ? (
            <button
              className="iconbtn iconbtn--danger"
              onClick={onDelete}
              title={t("common.delete")}
              aria-label={t("chat.deleteMessageAria")}
            >
              <TrashIcon size={14} />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

