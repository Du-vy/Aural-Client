import { useMemo } from "react";
import { isEmojiOnly } from "@/lib/emoji";
import { useTranslation } from "@/lib/i18n";
import { extractUrls, isOnlyMediaUrls, tokenizeMessageText } from "@/lib/links";
import {
  EMPTY_MENTIONS,
  splitMentions,
  type MentionDirectory,
  type MentionTarget,
} from "@/lib/mentions";
import type { Attachment, User } from "@/lib/protocol";
import { formatFull } from "@/lib/time";
import { MessageAttachments } from "./attachments/MessageAttachments";
import { MessageEmbeds } from "./embeds/MessageEmbeds";

/** One run of the message: words, a link, or somebody being named. */
type Piece =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; url: string }
  | { kind: "mention"; value: string; target: MentionTarget };

interface MessageContentProps {
  content: string;
  editedAt: number | null;
  /** Files posted with the message, rendered under whatever it said. */
  attachments?: readonly Attachment[];
  /** Who can be named, so an `@name` in the text resolves to them. */
  mentions?: MentionDirectory;
  /** The reader, so the mentions that reach them are marked as such. */
  self?: User | null;
  onOpenLink(url: string): void;
  onOpenMember?(userId: number, anchorRect?: DOMRect): void;
}

/** Whether a mention reaches the reader: by name, by role, or by keyword. */
function namesReader(target: MentionTarget, self: User | null | undefined): boolean {
  if (!self) return false;
  if (target.kind === "keyword") return true;
  if (target.kind === "role") return self.roles.includes(target.id);
  return target.id === self.id;
}

export function MessageContent({
  content,
  editedAt,
  attachments,
  mentions = EMPTY_MENTIONS,
  self = null,
  onOpenLink,
  onOpenMember,
}: MessageContentProps) {
  const { t } = useTranslation();
  const urls = useMemo(() => extractUrls(content), [content]);
  const onlyMedia = useMemo(() => isOnlyMediaUrls(content), [content]);
  const tokens = useMemo(() => tokenizeMessageText(content), [content]);
  const jumboEmoji = useMemo(() => isEmojiOnly(content), [content]);
  const files = attachments ?? [];

  // Links are found first and never looked inside, so a `@` in a URL stays
  // part of the address rather than becoming somebody's name.
  const pieces = useMemo<Piece[]>(() => {
    const out: Piece[] = [];
    for (const token of tokens) {
      if (token.type === "link" && token.url) {
        out.push({ kind: "link", value: token.value, url: token.url });
        continue;
      }
      for (const part of splitMentions(token.value, mentions)) {
        out.push(
          part.type === "mention"
            ? { kind: "mention", value: part.value, target: part.target }
            : { kind: "text", value: part.value },
        );
      }
    }
    return out;
  }, [tokens, mentions]);

  // A message that carries files may say nothing at all: the picture is the
  // message, and an empty paragraph above it would be a line of blank space.
  if (content.trim() === "" && files.length > 0) {
    return (
      <div className="msg__content-wrap">
        <MessageAttachments attachments={files} onOpenLink={onOpenLink} />
        {editedAt !== null ? (
          <span className="msg__edited" title={formatFull(editedAt)}>
            {t("chat.edited")}
          </span>
        ) : null}
      </div>
    );
  }

  // When a message is ONLY direct media link(s), don't show the plain text URL.
  if (onlyMedia && urls.length > 0) {
    return (
      <div className="msg__media-only">
        <MessageEmbeds urls={urls} onOpenLink={onOpenLink} />
        {files.length > 0 ? (
          <MessageAttachments attachments={files} onOpenLink={onOpenLink} />
        ) : null}
        {editedAt !== null && (
          <span className="msg__edited" title={formatFull(editedAt)}>
            {" "}
            {t("chat.edited")}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="msg__content-wrap">
      <p className={jumboEmoji ? "msg__content msg__content--jumbo" : "msg__content"}>
        {pieces.map((piece, index) => {
          if (piece.kind === "link") {
            return (
              <a
                key={index}
                href={piece.url}
                className="msg__link"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenLink(piece.url);
                }}
              >
                {piece.value}
              </a>
            );
          }

          if (piece.kind === "mention") {
            const target = piece.target;
            const mine = namesReader(target, self);
            const className = mine ? "mention mention--self" : "mention";

            // A member is a button because there is somewhere to go: their
            // profile. A role or a keyword names nobody in particular, so it
            // is drawn rather than offered.
            if (target.kind === "user" && onOpenMember) {
              return (
                <button
                  key={index}
                  type="button"
                  className={className}
                  onClick={(event) =>
                    onOpenMember(target.id, event.currentTarget.getBoundingClientRect())
                  }
                >
                  {piece.value}
                </button>
              );
            }
            return (
              <span
                key={index}
                className={className}
                style={target.color ? { color: target.color } : undefined}
              >
                {piece.value}
              </span>
            );
          }

          return <span key={index}>{piece.value}</span>;
        })}
        {editedAt !== null ? (
          <span className="msg__edited" title={formatFull(editedAt)}>
            {" "}
            {t("chat.edited")}
          </span>
        ) : null}
      </p>

      {urls.length > 0 && <MessageEmbeds urls={urls} onOpenLink={onOpenLink} />}

      {files.length > 0 ? (
        <MessageAttachments attachments={files} onOpenLink={onOpenLink} />
      ) : null}
    </div>
  );
}
