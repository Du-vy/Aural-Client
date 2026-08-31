/**
 * Emoji predicates used while rendering a message.
 *
 * Deliberately free of the generated catalogue: this is imported by the
 * message list, which every session renders, while the catalogue is 20 KB that
 * only matters once somebody opens the picker.
 */

/**
 * Whether a message is nothing but emoji and whitespace, which is what earns
 * it the larger rendering.
 *
 * `Extended_Pictographic` covers the emoji themselves; the rest of the class
 * covers what holds a sequence together — joiners, variation selectors, skin
 * tone modifiers and the regional letters that build a flag.
 */
const EMOJI_ONLY =
  /^[\s\p{Extended_Pictographic}\u{200D}\u{FE0F}\u{FE0E}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u{20E3}0-9#*]+$/u;

/** How many emoji a message may hold and still be rendered large. */
export const JUMBO_LIMIT = 8;

/**
 * A grapheme that is really an emoji rather than a character the class above
 * has to admit for the sake of sequences. Neither of the two regional
 * indicators that build a flag is Extended_Pictographic on its own, and
 * neither is the enclosing mark that turns a digit into a keycap.
 */
const IS_EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{20E3}/u;

/** Splits text into user-perceived characters, so a ZWJ family counts as one. */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Reports whether a message should render at emoji size.
 *
 * A bare digit or `#` has to be admitted because a keycap sequence is built
 * from one, which would let "123" qualify — so at least one grapheme must be
 * an actual emoji.
 */
export function isEmojiOnly(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed === "" || !EMOJI_ONLY.test(trimmed)) return false;

  const graphemes = [...segmenter.segment(trimmed)]
    .map((part) => part.segment)
    .filter((part) => part.trim() !== "");

  if (graphemes.length === 0 || graphemes.length > JUMBO_LIMIT) return false;
  return graphemes.some((grapheme) => IS_EMOJI.test(grapheme));
}
