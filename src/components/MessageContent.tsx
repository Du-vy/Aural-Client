import { useMemo } from "react";
import { isEmojiOnly } from "@/lib/emoji";
import { useTranslation } from "@/lib/i18n";
import { extractUrls, isOnlyMediaUrls, tokenizeMessageText } from "@/lib/links";
import type { Attachment } from "@/lib/protocol";
import { formatFull } from "@/lib/time";
import { MessageAttachments } from "./attachments/MessageAttachments";
import { MessageEmbeds } from "./embeds/MessageEmbeds";

interface MessageContentProps {
  content: string;
  editedAt: number | null;
  /** Files posted with the message, rendered under whatever it said. */
  attachments?: readonly Attachment[];
  onOpenLink(url: string): void;
}

export function MessageContent({
  content,
  editedAt,
  attachments,
  onOpenLink,
}: MessageContentProps) {
  const { t } = useTranslation();
  const urls = useMemo(() => extractUrls(content), [content]);
  const onlyMedia = useMemo(() => isOnlyMediaUrls(content), [content]);
  const tokens = useMemo(() => tokenizeMessageText(content), [content]);
  const jumboEmoji = useMemo(() => isEmojiOnly(content), [content]);
  const files = attachments ?? [];

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
        {tokens.map((token, index) => {
          if (token.type === "link" && token.url) {
            return (
              <a
                key={index}
                href={token.url}
                className="msg__link"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenLink(token.url!);
                }}
              >
                {token.value}
              </a>
            );
          }
          return <span key={index}>{token.value}</span>;
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
