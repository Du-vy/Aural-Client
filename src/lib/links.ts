/**
 * Link classification and parsing utilities.
 * Identifies links, direct media URLs (images, videos, audio), YouTube links,
 * and general web URLs.
 */

export type MediaType = "image" | "video" | "audio" | "youtube" | "general";

export interface ParsedUrl {
  url: string;
  type: MediaType;
  domain: string;
  videoId?: string;
  startTime?: number;
}

export interface TextToken {
  type: "text" | "link";
  value: string;
  url?: string;
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:[?#].*)?$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|ogg|ogv|mkv)(?:[?#].*)?$/i;
const AUDIO_EXTENSIONS = /\.(mp3|ogg|wav|m4a|aac|flac|opus)(?:[?#].*)?$/i;

const YOUTUBE_REGEX =
  /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&](?:t|start)=([0-9]+[shm]?|[0-9]+))?/i;

// Match standard URLs starting with http:// or https://
const URL_PATTERN = "https?:\\/\\/[^\\s<>\"'`]+(?:\\([^\\s<>\"'`]+\\)|[^\\s<>\"'`.,;:!?])";
const URL_MATCH_REGEX = new RegExp(URL_PATTERN, "i");

/**
 * Trims trailing punctuation like '.', ',', ';', ':', '!', '?', ')', ']'
 * that might have been accidentally grabbed at the end of a sentence.
 */
function cleanUrl(raw: string): string {
  let cleaned = raw;
  while (/[.,;:!?)]$/.test(cleaned)) {
    if (cleaned.endsWith(")") && (cleaned.match(/\(/g) || []).length >= (cleaned.match(/\)/g) || []).length) {
      break;
    }
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}

/**
 * Extracts all valid HTTP(S) URLs from a string.
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(new RegExp(URL_PATTERN, "gi"));
  if (!matches) return [];
  const urls: string[] = [];
  for (const match of matches) {
    const cleaned = cleanUrl(match);
    if (cleaned && !urls.includes(cleaned)) {
      urls.push(cleaned);
    }
  }
  return urls;
}

/**
 * Extracts the domain name from a URL for display and trust checking.
 */
export function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return url;
  }
}

/**
 * Parses time parameter (e.g. 90, 90s, 1m30s, etc.) into seconds.
 */
function parseTimeParam(raw?: string): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (match) {
    const hours = Number.parseInt(match[1] || "0", 10);
    const mins = Number.parseInt(match[2] || "0", 10);
    const secs = Number.parseInt(match[3] || "0", 10);
    return hours * 3600 + mins * 60 + secs;
  }
  return undefined;
}

/**
 * Classifies a URL as image, video, audio, youtube, or general web link.
 */
export function classifyUrl(url: string): ParsedUrl {
  const domain = getDomain(url);

  // Check YouTube
  const ytMatch = url.match(YOUTUBE_REGEX);
  if (ytMatch && ytMatch[1]) {
    return {
      url,
      type: "youtube",
      domain,
      videoId: ytMatch[1],
      startTime: parseTimeParam(ytMatch[2]),
    };
  }

  // Check direct image
  if (
    IMAGE_EXTENSIONS.test(url) ||
    domain.includes("giphy.com") && url.includes("/media/") ||
    domain.includes("tenor.com") && url.endsWith(".gif") ||
    domain.includes("imgur.com") && IMAGE_EXTENSIONS.test(url)
  ) {
    return { url, type: "image", domain };
  }

  // Check direct video
  if (VIDEO_EXTENSIONS.test(url)) {
    return { url, type: "video", domain };
  }

  // Check direct audio
  if (AUDIO_EXTENSIONS.test(url)) {
    return { url, type: "audio", domain };
  }

  return { url, type: "general", domain };
}

/**
 * Returns true if the message content consists ONLY of one or more media/youtube URLs
 * (with only whitespace between them), meaning the raw text link should be hidden
 * and only the embedded media component should be displayed.
 */
export function isOnlyMediaUrls(text: string): boolean {
  if (!isOnlyUrls(text)) return false;
  for (const url of text.trim().split(/\s+/)) {
    if (classifyUrl(cleanUrl(url)).type === "general") {
      return false;
    }
  }
  return true;
}

/**
 * Returns true if the message is links and nothing else — no words between
 * them. Whether those links are worth showing as text is a separate question:
 * an address with no file extension can still turn out to be a picture once a
 * card for it arrives.
 */
export function isOnlyUrls(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  for (const word of trimmed.split(/\s+/)) {
    const cleaned = cleanUrl(word);
    if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
      return false;
    }
  }
  return true;
}

/**
 * Tokenizes text into plain text chunks and clickable link tokens.
 */
export function tokenizeMessageText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const match = remaining.match(URL_MATCH_REGEX);
    if (!match || match.index === undefined) {
      tokens.push({ type: "text", value: remaining });
      break;
    }

    const matchIndex = match.index;
    if (matchIndex > 0) {
      tokens.push({ type: "text", value: remaining.slice(0, matchIndex) });
    }

    const rawUrl = match[0];
    const cleaned = cleanUrl(rawUrl);
    const trailingPunct = rawUrl.slice(cleaned.length);

    tokens.push({ type: "link", value: cleaned, url: cleaned });
    if (trailingPunct) {
      tokens.push({ type: "text", value: trailingPunct });
    }

    remaining = remaining.slice(matchIndex + rawUrl.length);
  }

  return tokens;
}
