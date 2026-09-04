/**
 * What a rich card already stands for, and how it wants to be drawn.
 *
 * A message relayed from Discord arrives twice over: the link is still in the
 * text, so this client unfurls it itself, and Discord's own unfurl of the same
 * link arrives beside it as a card. Both are correct and together they are one
 * thing said twice, so the card wins — it is what the sender saw — and the
 * automatic preview of any link a card already covers is left off.
 */
import { classifyUrl } from "./links";
import type { Embed, EmbedMedia } from "./protocol";

const VIDEO_FILE = /\.(mp4|webm|mov)(?:[?#].*)?$/i;

/**
 * The comparable form of a URL.
 *
 * Discord echoes back the address it was given, so an exact match is the
 * common case; the trailing slash and the case of the scheme and host are the
 * differences that survive a round trip through somebody else's unfurler.
 */
export function normaliseUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hostname = parsed.hostname.toLowerCase();
    const text = parsed.toString();
    return text.endsWith("/") ? text.slice(0, -1) : text;
  } catch {
    return trimmed.toLowerCase();
  }
}

/** Every address one card speaks for: the page it unfurled and its media. */
function urlsOf(embed: Embed): string[] {
  const out: string[] = [];
  for (const url of [embed.url, embed.video?.url, embed.image?.url, embed.thumbnail?.url]) {
    if (url) out.push(normaliseUrl(url));
  }
  return out;
}

/** The addresses a message's cards already cover, in comparable form. */
export function coveredUrls(embeds: readonly Embed[]): Set<string> {
  const out = new Set<string>();
  for (const embed of embeds) {
    for (const url of urlsOf(embed)) out.add(url);
  }
  return out;
}

/** Whether a card says anything in words of its own. */
function hasWords(embed: Embed): boolean {
  return Boolean(
    embed.title ||
      embed.description ||
      embed.author?.name ||
      embed.footer?.text ||
      (embed.fields?.length ?? 0) > 0,
  );
}

/**
 * Whether a card is a picture or a clip and nothing else — what Discord makes
 * of a bare media link, where the address was never the point.
 *
 * Such a card is drawn as the media itself, with none of a card's furniture
 * around it, which is both what Discord does and the only way the picture ends
 * up larger than the link it replaced.
 *
 * What a card calls itself is only the first answer. A card stored before this
 * server kept Discord's word for it, or relayed by one that does not, says
 * "rich" for a picture like everything else — so the shape is read too: a
 * wordless card whose address is its own picture is that picture, whatever it
 * is labelled.
 */
export function isBareMedia(embed: Embed): boolean {
  if (hasWords(embed)) return false;

  const picture = pictureOf(embed);
  if (!picture?.url && !playbackOf(embed)) return false;
  if (embed.type === "image" || embed.type === "gifv") return true;

  const link = embed.url;
  if (!link) return false;
  if (classifyUrl(link).type === "image") return true;

  const media = picture?.url ?? embed.video?.url;
  return Boolean(media && normaliseUrl(link) === normaliseUrl(media));
}

/** The picture a card carries, whichever half it arrived in. */
export function pictureOf(embed: Embed): EmbedMedia | undefined {
  if (embed.image?.url) return embed.image;
  if (embed.thumbnail?.url) return embed.thumbnail;
  return undefined;
}

/**
 * How a card's clip can be played here, or nothing when it cannot.
 *
 * Only YouTube is framed, because a frame runs somebody else's page inside
 * this one and the list of pages that may do that is not a list an unfurl gets
 * to write. Everything else has to be a video file to play at all; a card
 * pointing at a player page keeps its picture and its link, as before.
 */
export type EmbedPlayback =
  | { kind: "youtube"; src: string }
  | { kind: "file"; src: string; loop: boolean };

export function playbackOf(embed: Embed): EmbedPlayback | undefined {
  // The clip itself is the signal, not the label on the card. Discord fills
  // `video` in only on a page that plays one or a loop standing in for a GIF,
  // and nothing an application composes for a webhook carries one at all — so
  // a card that has one is a card to play, whatever it calls itself.
  if (!embed.video?.url && embed.type !== "video" && embed.type !== "gifv") return undefined;

  for (const candidate of [embed.url, embed.video?.url]) {
    if (!candidate) continue;
    const parsed = classifyUrl(candidate);
    if (parsed.type === "youtube" && parsed.videoId) {
      const start = parsed.startTime ? `&start=${parsed.startTime}` : "";
      return {
        kind: "youtube",
        src: `https://www.youtube-nocookie.com/embed/${parsed.videoId}?autoplay=1${start}`,
      };
    }
  }

  const file = embed.video?.url;
  if (file && VIDEO_FILE.test(file)) {
    // A gifv is a silent loop wearing a video's clothes, and is played as the
    // animation it stands in for rather than as a clip somebody starts.
    return { kind: "file", src: file, loop: embed.type === "gifv" };
  }
  return undefined;
}

/**
 * The addresses whose card is media alone, so the text of the link can be left
 * out of the message the way it is for a picture posted directly.
 */
export function bareMediaUrls(embeds: readonly Embed[]): Set<string> {
  const out = new Set<string>();
  for (const embed of embeds) {
    if (!isBareMedia(embed)) continue;
    for (const url of urlsOf(embed)) out.add(url);
  }
  return out;
}
