/**
 * Utilities for rendering high-fidelity Twemoji (Discord/Twitter style) SVGs.
 *
 * Twemoji provides crisp, consistent, cross-platform emojis instead of relying
 * on inconsistent or low-detail system fonts.
 */

const BASE_URL = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg";

const SPECIAL_FE0F = /^(?:#|\*|[0-9]|\u00a9|\u00ae|\u2122|\u2139|\u24c2|\u3297|\u3299)/;

/**
 * Converts a Unicode emoji string into a Twemoji asset codepoint sequence.
 */
export function toTwemojiCodePoints(unicode: string): string {
  const isSpecial = SPECIAL_FE0F.test(unicode);
  const codePoints: string[] = [];

  for (const char of unicode) {
    const cp = char.codePointAt(0)!.toString(16);
    if (!isSpecial && cp === "fe0f") {
      continue;
    }
    codePoints.push(cp);
  }

  return codePoints.join("-");
}

/**
 * Returns the CDN URL for the SVG asset of a given Unicode emoji.
 */
export function getTwemojiUrl(unicode: string): string {
  const code = toTwemojiCodePoints(unicode);
  return `${BASE_URL}/${code}.svg`;
}
