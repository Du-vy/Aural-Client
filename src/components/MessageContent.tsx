import { useMemo } from "react";
import type { ServerAddress } from "@/lib/address";
import {
  EMPTY_EMOJI,
  expressionUrl,
  isCustomEmojiOnly,
  splitCustomEmoji,
  type EmojiDirectory,
} from "@/lib/customEmoji";
import { isEmojiOnly } from "@/lib/emoji";
import { useTranslation } from "@/lib/i18n";
import { extractUrls, isOnlyMediaUrls, tokenizeMessageText } from "@/lib/links";
import {
  EMPTY_MENTIONS,
  splitMentions,
  type MentionDirectory,
  type MentionTarget,
} from "@/lib/mentions";
import type { Attachment, Embed, Expression, User } from "@/lib/protocol";
import { formatFull } from "@/lib/time";
import { MessageAttachments } from "./attachments/MessageAttachments";
import { MessageEmbeds } from "./embeds/MessageEmbeds";
import { RichEmbeds } from "./embeds/RichEmbed";

/** One run of the message: words, a link, or somebody being named. */
type Piece =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; url: string }
  | { kind: "mention"; value: string; target: MentionTarget }
  | { kind: "emoji"; value: string; emoji: Expression };

interface MessageContentProps {
  content: string;
  editedAt: number | null;
  /** Files posted with the message, rendered under whatever it said. */
  attachments?: readonly Attachment[];
  /**
   * The rich cards the message carries, which only a webhook produces. They
   * are very often the whole message: a build result or an alert says nothing
   * in words at all.
   */
  embeds?: readonly Embed[];
  /** Who can be named, so an `@name` in the text resolves to them. */
  mentions?: MentionDirectory;
  /**
   * The custom emoji this server carries, so a `:name:` in the text resolves
   * to one. A name that resolves to nothing stays the text somebody typed,
   * which is what keeps history readable after an emoji is deleted.
   */
  emojis?: EmojiDirectory;
  /** Where this server is, so an emoji's relative URL can be built out. */
  address?: ServerAddress | null;
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
  embeds,
  mentions = EMPTY_MENTIONS,
  emojis = EMPTY_EMOJI,
  address = null,
  self = null,
  onOpenLink,
  onOpenMember,
}: MessageContentProps) {
  const { t } = useTranslation();
  const urls = useMemo(() => extractUrls(content), [content]);
  const onlyMedia = useMemo(() => isOnlyMediaUrls(content), [content]);
  const tokens = useMemo(() => tokenizeMessageText(content), [content]);
  const jumboEmoji = useMemo(
    () => isEmojiOnly(content) || isCustomEmojiOnly(content, emojis),
    [content, emojis],
  );
  const files = attachments ?? [];
  const cards = embeds ?? [];

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
        if (part.type === "mention") {
          out.push({ kind: "mention", value: part.value, target: part.target });
          continue;
        }
        // Custom emoji are found last, inside what is left after links and
        // mentions: a `:name:` inside a URL is part of the address, and one
        // inside somebody's name is part of the name.
        for (const run of splitCustomEmoji(part.value, emojis)) {
          out.push(
            run.type === "emoji"
              ? { kind: "emoji", value: run.value, emoji: run.emoji }
              : { kind: "text", value: run.value },
          );
        }
      }
    }
    return out;
  }, [tokens, mentions, emojis]);

  // A message that carries files or cards may say nothing at all: the picture
  // is the message, and an empty paragraph above it would be a line of blank
  // space.
  if (content.trim() === "" && (files.length > 0 || cards.length > 0)) {
    return (
      <div className="msg__content-wrap">
        <RichEmbeds embeds={cards} onOpenLink={onOpenLink} />
        {files.length > 0 ? (
          <MessageAttachments attachments={files} onOpenLink={onOpenLink} />
        ) : null}
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
        <RichEmbeds embeds={cards} onOpenLink={onOpenLink} />
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

          if (piece.kind === "emoji") {
            return (
              <img
                key={index}
                className="emoji--custom"
                src={expressionUrl(address, piece.emoji)}
                alt={piece.value}
                title={piece.value}
                draggable={false}
                loading="lazy"
              />
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

      <RichEmbeds embeds={cards} onOpenLink={onOpenLink} />

      {files.length > 0 ? (
        <MessageAttachments attachments={files} onOpenLink={onOpenLink} />
      ) : null}
    </div>
  );
}
