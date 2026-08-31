import { useMemo } from "react";
import { isEmojiOnly } from "@/lib/emoji";
import { useTranslation } from "@/lib/i18n";
import { extractUrls, isOnlyMediaUrls, tokenizeMessageText } from "@/lib/links";
import { formatFull } from "@/lib/time";
import { MessageEmbeds } from "./embeds/MessageEmbeds";

interface MessageContentProps {
  content: string;
  editedAt: number | null;
  onOpenLink(url: string): void;
}

export function MessageContent({ content, editedAt, onOpenLink }: MessageContentProps) {
  const { t } = useTranslation();
  const urls = useMemo(() => extractUrls(content), [content]);
  const onlyMedia = useMemo(() => isOnlyMediaUrls(content), [content]);
  const tokens = useMemo(() => tokenizeMessageText(content), [content]);
  const jumboEmoji = useMemo(() => isEmojiOnly(content), [content]);

  // When a message is ONLY direct media link(s), don't show the plain text URL.
  if (onlyMedia && urls.length > 0) {
    return (
      <div className="msg__media-only">
        <MessageEmbeds urls={urls} onOpenLink={onOpenLink} />
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
    </div>
  );
}
