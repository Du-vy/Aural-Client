/**
 * Utilities for rendering high-fidelity Twemoji (Discord/Twitter style) SVGs.
 *
 * Twemoji provides crisp, consistent, cross-platform emojis instead of relying
 * on inconsistent or low-detail system fonts.
 */

/**
 * Pinned rather than tracking a moving tag: an unpinned CDN path re-resolves,
 * caches worse, and turns any release in the upstream repository into a change
 * here that nobody asked for.
 */
const BASE_URL = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg";

/** The zero-width joiner that binds a multi-part emoji into a single glyph. */
const ZWJ = "‍";

/**
 * Converts a Unicode emoji string into a Twemoji asset codepoint sequence.
 *
 * The rule is Twemoji's own, and it turns on the joiner rather than on the
 * leading character: a variation selector (fe0f) is dropped from a standalone
 * emoji, whose asset is named without one, and kept in a joined sequence, whose
 * asset is named with it.
 *
 * Getting this backwards costs every joined emoji that carries a selector — the
 * flags, the hearts, and the whole profession family (1f468-200d-2695-fe0f and
 * its neighbours) — which is most of the interesting ones.
 */
export function toTwemojiCodePoints(unicode: string): string {
  const joined = unicode.includes(ZWJ);
  const codePoints: string[] = [];

  for (const char of unicode) {
    const cp = char.codePointAt(0)!.toString(16);
    if (!joined && cp === "fe0f") {
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

/**
 * The name to try when the first one is not there.
 *
 * Twemoji stores a handful of joined emoji without their variation selectors
 * anyway — the eye in speech bubble is the one that shows up in practice — so
 * the stripped spelling is the second guess. It is worth having as a rule
 * rather than a list: the upstream repository is the authority on its own file
 * names, and this recovers whichever ones it spells the other way.
 */
export function getTwemojiFallbackUrl(unicode: string): string {
  const stripped = [...unicode]
    .map((char) => char.codePointAt(0)!.toString(16))
    .filter((cp) => cp !== "fe0f")
    .join("-");
  return `${BASE_URL}/${stripped}.svg`;
}
