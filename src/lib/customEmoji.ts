/**
 * Custom emoji: the ones a server carries for its own people, written into a
 * message as `:name:` and drawn inline where the text was.
 *
 * The message stores the text. Nothing is rewritten on the way in, so a message
 * written with `:shrug:` still reads as `:shrug:` after the emoji is deleted,
 * and reading history from a server that has none renders the colons somebody
 * actually typed. That is the whole reason to resolve at render time rather
 * than to substitute at send time: the emoji table is the server's and changes
 * under the history, and the history has to survive it changing.
 */

import type { Expression } from "./protocol";
import { serverOrigin } from "./uploads";
import type { ServerAddress } from "./address";

/** One run of a message, once the custom emoji have been found in it. */
export type EmojiPart =
  | { type: "text"; value: string }
  | { type: "emoji"; value: string; emoji: Expression };

/**
 * What `:name:` may contain. It is narrow on purpose, and matches what the
 * server accepts as a name: anything that could also be punctuation would make
 * a colon in the middle of a sentence ambiguous with the start of an emoji.
 */
const TOKEN = /:([\p{L}\p{N}_]{2,32}):/gu;

/** The custom emoji of a server, indexed by the name writers type. */
export type EmojiDirectory = ReadonlyMap<string, Expression>;

export const EMPTY_EMOJI: EmojiDirectory = new Map();

/** Builds the lookup a message is rendered against. */
export function emojiDirectory(expressions: Iterable<Expression>): EmojiDirectory {
  const out = new Map<string, Expression>();
  for (const expression of expressions) {
    if (expression.kind === "emoji") out.set(expression.name.toLowerCase(), expression);
  }
  return out;
}

/**
 * Splits text into the runs between custom emoji.
 *
 * A `:name:` that names nothing this server carries is left as the text it is,
 * which is what makes writing a colon-delimited word safe: only a name that
 * actually resolves becomes a picture.
 */
export function splitCustomEmoji(text: string, directory: EmojiDirectory): EmojiPart[] {
  if (directory.size === 0 || !text.includes(":")) return [{ type: "text", value: text }];

  const parts: EmojiPart[] = [];
  let last = 0;

  // A fresh regex per call: the global flag makes `lastIndex` stateful, and a
  // shared instance would resume mid-string on the next message.
  const pattern = new RegExp(TOKEN.source, TOKEN.flags);
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const emoji = directory.get((match[1] ?? "").toLowerCase());
    if (!emoji) continue;

    if (match.index > last) parts.push({ type: "text", value: text.slice(last, match.index) });
    parts.push({ type: "emoji", value: match[0], emoji });
    last = match.index + match[0].length;
  }

  if (last === 0) return [{ type: "text", value: text }];
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

/** How many custom emoji may stand alone before they stop being drawn large. */
const JUMBO_LIMIT = 8;

/**
 * Whether a message is nothing but custom emoji, which is what makes them
 * render large — the same rule the Unicode ones already follow.
 */
export function isCustomEmojiOnly(content: string, directory: EmojiDirectory): boolean {
  const trimmed = content.trim();
  if (trimmed === "" || directory.size === 0) return false;

  const parts = splitCustomEmoji(trimmed, directory);
  const emoji = parts.filter((part) => part.type === "emoji");
  if (emoji.length === 0 || emoji.length > JUMBO_LIMIT) return false;

  return parts.every((part) => part.type === "emoji" || part.value.trim() === "");
}

/**
 * The absolute URL of an expression's picture.
 *
 * The server sends a relative one, exactly as it does for an attachment, so
 * that reaching the same server by address, by hostname or through a proxy all
 * build a link that works from the address the client already holds.
 */
export function expressionUrl(address: ServerAddress | null, expression: Expression): string {
  if (!address) return expression.url;
  return `${serverOrigin(address)}${expression.url}`;
}
