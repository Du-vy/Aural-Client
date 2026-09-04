import { useMemo } from "react";

import type { ServerAddress } from "@/lib/address";
import { EMPTY_EMOJI, expressionUrl, splitCustomEmoji, type EmojiDirectory } from "@/lib/customEmoji";
import { useTranslation } from "@/lib/i18n";
import { plainText } from "@/lib/markdown";
import { AnimatedImage } from "./AnimatedImage";

interface ReplySnippetProps {
  /** The message being answered, as it was written. */
  content: string;
  emojis?: EmojiDirectory;
  address?: ServerAddress | null;
}

/**
 * What a message says, as the single line a reply preview has room for.
 *
 * Two places show it — the line above a reply, and the bar above the composer
 * while one is being written — and they share this so they cannot drift: what
 * you are about to answer has to look like what the answer will say you
 * answered, or the bar reads as a different message.
 *
 * The markdown is flattened to its words rather than rendered, because a line
 * has no room for a heading or a table and every alternative shows the reader
 * the asterisks somebody typed. Custom emoji survive as pictures: a `:shrug:`
 * that reads as `:shrug:` names nothing.
 */
export function ReplySnippet({
  content,
  emojis = EMPTY_EMOJI,
  address = null,
}: ReplySnippetProps) {
  const { t } = useTranslation();

  // Emoji are found in the flattened words rather than in the source, so a
  // `:name:` inside a code span stays the characters it was written as.
  const runs = useMemo(() => splitCustomEmoji(plainText(content), emojis), [content, emojis]);

  // A message may be nothing but its files, and a reference carries no text
  // for one. Naming it beats a blank line.
  if (runs.length === 0 || (runs.length === 1 && runs[0]!.type === "text" && !runs[0]!.value)) {
    return <>{t("chat.attachment")}</>;
  }

  return (
    <>
      {runs.map((run, index) =>
        run.type === "emoji" ? (
          <AnimatedImage
            key={index}
            className="emoji--reply"
            src={expressionUrl(address, run.emoji)}
            alt={run.value}
            title={run.value}
            draggable={false}
            loading="lazy"
            animated={run.emoji.animated ?? undefined}
          />
        ) : (
          <span key={index}>{run.value}</span>
        ),
      )}
    </>
  );
}
