import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useTranslation } from "@/lib/i18n";
import { extractUrls, getDomain } from "@/lib/links";
import type { ServerAddress } from "@/lib/address";
import { EMPTY_EMOJI, type EmojiDirectory } from "@/lib/customEmoji";
import {
  EMPTY_MENTIONS,
  mentionsSelf,
  repliesToSelf,
  type MentionDirectory,
} from "@/lib/mentions";
import { openExternalUrl } from "@/lib/open";
import { isDomainTrusted } from "@/lib/storage";
import { GROUPING_WINDOW_SECONDS, formatDay, formatFull, formatTime, sameDay } from "@/lib/time";
import type { MessageBase, ReferencedMessage, Role, User } from "@/lib/protocol";
import type { JumpTarget } from "@/store/session";
import { colorRoleOf } from "@/store/selectors";
import { Avatar } from "./Avatar";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import { DeleteMessageDialog } from "./dialogs/DeleteMessageDialog";
import { ExternalLinkDialog } from "./dialogs/ExternalLinkDialog";
import { ChevronIcon, CopyIcon, HashIcon, LinkIcon, PencilIcon, ReplyIcon, TrashIcon } from "./Icons";
import { MessageContent } from "./MessageContent";
import { ReplySnippet } from "./ReplySnippet";
import { MessageAttachments } from "./attachments/MessageAttachments";

/**
 * One rendered row. A message either opens a block, carrying its author and
 * timestamp, or continues one, showing neither.
 */
interface Row {
  message: MessageBase;
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
export function buildRows(messages: readonly MessageBase[], now: Date = new Date()): Row[] {
  const rows: Row[] = [];

  for (const [index, message] of messages.entries()) {
    const previous = index > 0 ? messages[index - 1] : undefined;

    const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
    // A webhook posts with no identity behind it, so two different webhooks —
    // or one webhook posting under two different names — both arrive with a
    // null userId. Comparing which webhook it was is what keeps them from
    // sharing a header.
    const sameAuthor =
      previous !== undefined &&
      previous.userId === message.userId &&
      previous.author === message.author &&
      (previous.webhook?.id ?? null) === (message.webhook?.id ?? null);
    const withinWindow =
      previous !== undefined &&
      message.createdAt - previous.createdAt <= GROUPING_WINDOW_SECONDS;
    // A reply is drawn with the line it answers above it, so it opens a
    // block of its own however well it would otherwise have grouped. The test
    // is the reference rather than the id: the id with no reference behind it
    // draws nothing, and would leave a gap standing for nothing.
    const hasReply = !!message.replyTo;

    rows.push({
      message,
      daySeparator: newDay ? formatDay(message.createdAt, now) : null,
      startsBlock: newDay || !sameAuthor || !withinWindow || hasReply,
    });
  }
  return rows;
}

interface MessageListProps {
  channelName: string;
  messages: readonly MessageBase[];
  users: ReadonlyMap<number, User>;
  roles: ReadonlyMap<number, Role>;
  /** The reader: whose messages may be edited, and which of these name them. */
  self: User | null;
  /** Who can be named, so an `@name` in a message resolves to them. */
  mentions?: MentionDirectory;
  /** The server's custom emoji, so a `:name:` in a message resolves to one. */
  emojis?: EmojiDirectory;
  /** Where the server is, so an emoji's relative URL can be built out. */
  address?: ServerAddress | null;
  hasMore: boolean;
  /**
   * Whether newer messages remain past the last one held, which is true only
   * while the reader is looking at a window they jumped back to.
   */
  hasMoreAfter: boolean;
  loading: boolean;
  error: string | null;
  canManageMessages: boolean;
  /**
   * Where something asked the view to go: a search result, or a reply preview
   * pointing at a message outside the window. Only the id and the nonce are
   * read, so a channel jump and a conversation jump are the same thing here —
   * which list it belongs to was decided before it reached this one.
   */
  jump: Pick<JumpTarget, "messageId" | "nonce"> | null;
  /**
   * What stands above the first message ever written here. A channel says so
   * in the words a channel uses; a private conversation has its own, which is
   * the only thing about drawing one that differs.
   */
  startIcon?: ReactNode;
  startTitle?: string;
  startBody?: string;
  onJumpDone(nonce: number): void;
  onLoadOlder(): void;
  onLoadNewer(): void;
  onReturnToPresent(): void;
  onEdit(messageId: number, content: string): void;
  onDelete(messageId: number): void;
  onOpenMember?(userId: number, anchorRect?: DOMRect): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
  onReply?(message: MessageBase): void;
  onJumpToMessage?(messageId: number): void;
}

export function MessageList({
  channelName,
  messages,
  users,
  roles,
  self,
  mentions = EMPTY_MENTIONS,
  emojis = EMPTY_EMOJI,
  address = null,
  hasMore,
  hasMoreAfter,
  loading,
  error,
  canManageMessages,
  jump,
  startIcon,
  startTitle,
  startBody,
  onJumpDone,
  onLoadOlder,
  onLoadNewer,
  onReturnToPresent,
  onEdit,
  onDelete,
  onOpenMember,
  onContextMenuMember,
  onReply,
  onJumpToMessage,
}: MessageListProps) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  /** Whether the reader is at the bottom, and so wants to follow along. */
  const following = useRef(true);
  /**
   * The row the view is held against while the reader is away from the bottom,
   * and how far below the top of the scroller it sits.
   */
  const anchor = useRef<{ id: number; offset: number } | null>(null);
  /** The row a jump landed on, marked until the reader looks somewhere else. */
  const [landed, setLanded] = useState<number | null>(null);
  /** The timer clearing that mark, held so leaving the view cancels it. */
  const landedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (landedTimer.current !== null) clearTimeout(landedTimer.current);
  }, []);

  const [editing, setEditing] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MessageBase | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    message: MessageBase;
  } | null>(null);

  const rows = useMemo(() => buildRows(messages), [messages]);
  const newest = messages.at(-1)?.id ?? 0;
  const selfId = self?.id ?? null;

  // Decided once per window rather than once per row per render: the whole
  // window is walked every time anything in this list changes.
  const naming = useMemo(() => {
    const marked = new Set<number>();
    for (const message of messages) {
      // Answering somebody addresses them as surely as writing their name.
      // Answering yourself does not: a thought you carried on is still yours,
      // and marking it would light up half of what you wrote.
      const answersReader =
        message.userId !== selfId && repliesToSelf(message.replyTo, self);
      if (answersReader || mentionsSelf(message.content, self, roles)) marked.add(message.id);
    }
    return marked;
  }, [messages, self, selfId, roles]);

  function requestDelete(message: MessageBase, shiftKey = false) {
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

  // The list shares its column with the composer, so the composer growing
  // shrinks the list: a reply bar opening, files being attached, a draft
  // running onto a second line. The scroll position survives that, which means
  // a reader who was at the bottom is quietly no longer there — the last thing
  // said slides out of sight at the moment they answer it. So the bottom is
  // taken again whenever the box the messages are in changes size.
  useEffect(() => {
    const node = scroller.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (following.current && !hasMoreAfter) bottom.current?.scrollIntoView({ block: "end" });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreAfter]);

  // A jump moves the view to one message and marks it. This runs after the
  // effect above, which is what lets it win: the page a jump loads ends in a
  // new newest id, and following it to the bottom is exactly what must not
  // happen here.
  useEffect(() => {
    if (!jump) return;
    const row = scroller.current?.querySelector(`[data-message="${jump.messageId}"]`);
    if (!row) return;
    following.current = false;
    anchor.current = null;
    row.scrollIntoView({ block: "center" });
    setLanded(jump.messageId);
    onJumpDone(jump.nonce);
  }, [jump, messages, onJumpDone]);

  // The ids on screen, which is what says whether a reference can be reached
  // without asking the server for the window around it.
  const held = useMemo(() => new Set(messages.map((message) => message.id)), [messages]);

  function handleJumpToMessage(targetId: number) {
    const row = scroller.current?.querySelector(`[data-message="${targetId}"]`);
    if (!row) {
      // Not on screen: only a loader that can fetch the window around it can
      // get there. A list with none — a private conversation — stays put.
      onJumpToMessage?.(targetId);
      return;
    }
    following.current = false;
    anchor.current = null;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    setLanded(targetId);
    if (landedTimer.current !== null) clearTimeout(landedTimer.current);
    landedTimer.current = setTimeout(
      () => setLanded((curr) => (curr === targetId ? null : curr)),
      2500,
    );
  }

  // The window moves at both ends — an older page arriving at the top, a trim
  // dropping the far end to keep the window bounded — and either one carries
  // the conversation out from under a reader who is not at the bottom. So the
  // row they were looking at is put back where it was, rather than the scroll
  // position being reasoned about from how much the content grew: that sum is
  // wrong the moment a page arrives at one end and a trim leaves from the
  // other, which is the ordinary case now.
  useLayoutEffect(() => {
    const node = scroller.current;
    const held = anchor.current;
    if (!node || !held) return;

    const row = node.querySelector<HTMLElement>(`[data-message="${held.id}"]`);
    if (row === null) {
      // The row itself is gone, so there is nothing to hold to. Only a jump or
      // a return to the present replaces the window wholesale, and both mean
      // to move the view anyway.
      anchor.current = null;
      return;
    }
    const now = row.getBoundingClientRect().top - node.getBoundingClientRect().top;
    node.scrollTop += now - held.offset;
  }, [messages]);

  /**
   * Remembers the topmost row still on screen and where it sits.
   *
   * Rows are laid out in order, so the first one reaching past the top of the
   * viewport is found by halving rather than by walking: this runs on scroll,
   * and a full window is a couple of hundred rows.
   */
  function takeAnchor() {
    const node = scroller.current;
    if (!node) return;
    const rows = node.querySelectorAll<HTMLElement>("[data-message]");
    const top = node.getBoundingClientRect().top;

    let low = 0;
    let high = rows.length - 1;
    let found: HTMLElement | null = null;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const row = rows[middle]!;
      if (row.getBoundingClientRect().bottom >= top) {
        found = row;
        high = middle - 1;
      } else {
        low = middle + 1;
      }
    }
    anchor.current =
      found === null
        ? null
        : {
            id: Number(found.dataset.message),
            offset: found.getBoundingClientRect().top - top,
          };
  }

  function handleScroll() {
    const node = scroller.current;
    if (!node) return;
    const fromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    following.current = fromBottom < 80;
    // A reader at the bottom needs no anchor: being at the bottom is one, and
    // is the one the effect above keeps them on.
    if (following.current) anchor.current = null;
    else takeAnchor();

    if (node.scrollTop < 120 && hasMore && !loading) {
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

    if (onReply) {
      entries.push({
        id: "reply",
        label: t("chat.reply"),
        icon: <ReplyIcon size={15} />,
        onClick: () => onReply(msg),
      });
    }

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
          <span className="chat__start-icon">{startIcon ?? <HashIcon size={26} />}</span>
          <h2 className="chat__start-title">
            {startTitle ?? t("chat.welcomeTitle", { channel: channelName })}
          </h2>
          <p className="chat__start-body">
            {startBody ?? t("chat.welcomeSubtitle", { channel: channelName })}
          </p>
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
            self={self}
            mentions={mentions}
            emojis={emojis}
            address={address}
            namesReader={naming.has(message.id)}
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
            onReply={onReply ? () => onReply(message) : undefined}
            onJumpToMessage={
              message.replyTo &&
              !message.replyTo.deleted &&
              (held.has(message.replyTo.id) || onJumpToMessage !== undefined)
                ? handleJumpToMessage
                : undefined
            }
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
  message: MessageBase;
  startsBlock: boolean;
  /** The live user record, when the author happens to be connected. */
  author: User | undefined;
  roles: ReadonlyMap<number, Role>;
  emojis: EmojiDirectory;
  address: ServerAddress | null;
  /** The reader, for the mentions in this message that reach them. */
  self: User | null;
  mentions: MentionDirectory;
  /** Whether this message names the reader, which is what marks the row. */
  namesReader: boolean;
  editable: boolean;
  deletable: boolean;
  editing: boolean;
  onStartEdit(): void;
  onCancelEdit(): void;
  onSubmitEdit(content: string): void;
  onDelete(event: React.MouseEvent): void;
  onOpenMember?(userId: number, anchorRect?: DOMRect): void;
  onContextMenuMember?(event: React.MouseEvent, user: User): void;
  onReply?(): void;
  onJumpToMessage?(targetId: number): void;
  onOpenLink(url: string): void;
  onContextMenu?(event: React.MouseEvent): void;
}

/**
 * The line above a reply naming what it answers.
 *
 * It is a button only when there is somewhere to go. A reference whose message
 * is gone has no target at all, and a list that cannot fetch the window around
 * an id it is not holding cannot reach one either — a private conversation is
 * read forwards from where it was left, and has no jump. Offering a jump that
 * does nothing reads as a broken link rather than as an absent one.
 */
function ReplyReference({
  reference,
  emojis,
  address,
  onJump,
}: {
  reference: ReferencedMessage;
  emojis: EmojiDirectory;
  address: ServerAddress | null;
  onJump?: (() => void) | undefined;
}) {
  const { t } = useTranslation();

  // A message that is gone has no author left to name, so the marker stands on
  // its own rather than under an empty handle.
  const body = reference.deleted ? (
    <span className="msg__reply-deleted">{t("chat.originalDeleted")}</span>
  ) : (
    <>
      <span className="msg__reply-author">@{reference.author}</span>
      <span className="msg__reply-snippet">
        <ReplySnippet content={reference.content} emojis={emojis} address={address} />
      </span>
    </>
  );

  if (!onJump) {
    return (
      <span className="msg__reply-preview msg__reply-preview--flat">
        <ReplyIcon size={12} className="msg__reply-icon" />
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="msg__reply-preview"
      onClick={onJump}
      title={t("chat.jumpToOriginal")}
    >
      <ReplyIcon size={12} className="msg__reply-icon" />
      {body}
    </button>
  );
}

function MessageRow({
  message,
  startsBlock,
  author,
  roles,
  self,
  mentions,
  emojis,
  address,
  namesReader,
  editable,
  deletable,
  editing,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onDelete,
  onOpenMember,
  onContextMenuMember,
  onReply,
  onJumpToMessage,
  onOpenLink,
  onContextMenu,
}: MessageRowProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(message.content);
  const [webhookAvatarBroken, setWebhookAvatarBroken] = useState(false);

  // The author's colour is only knowable while they are connected, because
  // roles travel with the live user record and not with the message.
  const color = author ? (colorRoleOf(author, roles)?.color ?? null) : null;

  // A webhook's picture is an absolute URL on somebody else's host, so it is
  // used as it arrived. One that will not load falls back to the initial every
  // other authorless message already shows.
  const webhookAvatar =
    !webhookAvatarBroken && message.webhook?.avatar ? message.webhook.avatar : null;

  // A message that names the reader is marked as a whole row: the pill inside
  // it says who was named, and the row says it was them.
  const classes = ["msg"];
  if (startsBlock) classes.push("msg--first");
  if (namesReader) classes.push("msg--mention");
  if (message.replyTo) classes.push("msg--has-reply");

  return (
    <div className={classes.join(" ")} onContextMenu={onContextMenu}>
      {message.replyTo ? (
        <div className="msg__reply">
          <div className="msg__reply-spine" aria-hidden="true" />
          <ReplyReference
            reference={message.replyTo}
            emojis={emojis}
            address={address}
            onJump={onJumpToMessage && (() => onJumpToMessage(message.replyTo!.id))}
          />
        </div>
      ) : null}

      <div className="msg__gutter">
        {startsBlock ? (
          author ? (
            <button
              type="button"
              className="msg__avatar-btn"
              onClick={(e) => onOpenMember?.(author.id, e.currentTarget.getBoundingClientRect())}
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
          ) : webhookAvatar ? (
            <img
              src={webhookAvatar}
              alt=""
              className="msg__avatar-webhook"
              referrerPolicy="no-referrer"
              aria-hidden="true"
              onError={() => setWebhookAvatarBroken(true)}
            />
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
                onClick={(e) => onOpenMember?.(author.id, e.currentTarget.getBoundingClientRect())}
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
            {message.webhook ? (
              // A webhook has no account behind it, and a name with no account
              // behind it is exactly what somebody would use to impersonate a
              // member. The badge is what says so.
              //
              // A relayed message is the one case where the name does belong to
              // a person — somebody typing on the Discord side — so it says
              // where they are rather than calling them an application, which
              // would be wrong about both of them.
              message.webhook.source === "discord" ? (
                <span
                  className="msg__app-badge msg__app-badge--discord"
                  title={t("chat.relayBadgeTitle")}
                >
                  {t("chat.relayBadge")}
                </span>
              ) : (
                <span className="msg__app-badge" title={t("chat.webhookBadgeTitle")}>
                  {t("chat.webhookBadge")}
                </span>
              )
            ) : null}
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
            embeds={message.embeds}
            mentions={mentions}
            emojis={emojis}
            address={address}
            self={self}
            onOpenLink={onOpenLink}
            onOpenMember={onOpenMember}
          />
        )}
      </div>

      {editing ? null : (
        <div className="msg__actions">
          {onReply ? (
            <button
              type="button"
              className="iconbtn"
              onClick={onReply}
              title={t("chat.reply")}
              aria-label={t("chat.reply")}
            >
              <ReplyIcon size={14} />
            </button>
          ) : null}
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

