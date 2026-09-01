/**
 * OpenGraph and metadata extraction for rich link previews.
 * Features in-memory caching, Twitter/X/FxTwitter API support,
 * video metadata extraction, and graceful error handling.
 */

import { useSession } from "@/store/session";

export interface EmbedMetrics {
  replies?: number;
  retweets?: number;
  likes?: number;
  views?: number;
}

export interface OgData {
  url: string;
  siteName?: string;
  title?: string;
  description?: string;
  image?: string;
  video?: string;
  videoType?: string;
  favicon?: string;
  color?: string;
  author?: string;
  authorUrl?: string;
  authorIcon?: string;
  metrics?: EmbedMetrics;
  timestamp?: number | string;
}

const memoryCache = new Map<string, Promise<OgData | null>>();

const TWEET_URL_REGEX =
  /^(?:https?:\/\/)?(?:www\.|m\.)?(?:twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com|fixupx\.com|twittpr\.com|fixvx\.com)\/([a-zA-Z0-9_]{1,50})\/status\/(\d+)/i;

/**
 * Formats metric counts like 1200 -> 1.2K, 1500000 -> 1.5M.
 */
export function formatMetricCount(count: number): string {
  if (count >= 1_000_000) {
    const val = count / 1_000_000;
    return `${val >= 10 ? Math.round(val) : val.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (count >= 1_000) {
    const val = count / 1_000;
    return `${val >= 10 ? Math.round(val) : val.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return count.toLocaleString();
}

/** Whether a URL is one YouTube's oEmbed endpoint can describe. */
function isYouTube(url: string): boolean {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

/**
 * YouTube's oEmbed endpoint, which sends CORS headers and answers quickly.
 *
 * A fallback rather than a first choice: the server's own unfurl reads the same
 * page's OpenGraph tags without anybody's browser telling Google which videos
 * this server's members are sharing.
 */
async function fromYouTube(url: string): Promise<OgData | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      url,
      siteName: data.provider_name || "YouTube",
      title: data.title,
      author: data.author_name,
      image: data.thumbnail_url,
    };
  } catch {
    return null;
  }
}

/**
 * FxTwitter, which is the only source for what a tweet embed is worth showing:
 * the video, the author's avatar, and the reply, retweet and like counts. A
 * generic OpenGraph read of x.com carries none of that, so this one provider
 * runs ahead of the server rather than behind it — a deliberate exception, and
 * the only host besides the server that a link reaches by default.
 */
async function fromFxTwitter(username: string, statusId: string, url: string): Promise<OgData | null> {
  try {
    const res = await fetch(
      `https://api.fxtwitter.com/${encodeURIComponent(username)}/status/${encodeURIComponent(statusId)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    const body = await res.json();
    if (body.code !== 200 || !body.tweet) return null;

    const t = body.tweet;
    const videos = t.media?.videos;
    const allMedia = t.media?.all;
    let videoUrl = videos?.[0]?.url;
    if (!videoUrl && videos?.[0]?.variants) {
      const mp4s = videos[0].variants.filter(
        (v: { content_type?: string; url?: string }) => v.content_type === "video/mp4",
      );
      if (mp4s.length > 0) {
        mp4s.sort(
          (a: { bitrate?: number }, b: { bitrate?: number }) => (b.bitrate || 0) - (a.bitrate || 0),
        );
        videoUrl = mp4s[0].url;
      }
    }
    if (!videoUrl && allMedia) {
      const vid = allMedia.find(
        (m: { type?: string; format?: string; url?: string }) =>
          m.type === "video" || m.format === "video/mp4",
      );
      videoUrl = vid?.url;
    }
    const imageUrl =
      t.media?.photos?.[0]?.url ||
      videos?.[0]?.thumbnail_url ||
      allMedia?.[0]?.thumbnail_url ||
      allMedia?.[0]?.url;

    return {
      url,
      siteName: "FxTwitter",
      title: `${t.author.name} (@${t.author.screen_name})`,
      author: `${t.author.name} (@${t.author.screen_name})`,
      authorUrl: t.author.url || `https://x.com/${t.author.screen_name}`,
      authorIcon: t.author.avatar_url,
      description: t.text,
      image: imageUrl,
      video: videoUrl,
      videoType: videoUrl ? "video/mp4" : undefined,
      color: "#6363ff",
      favicon: "https://assets.fxembed.com/logos/fxtwitter.svg",
      metrics: {
        replies: t.replies,
        retweets: t.retweets,
        likes: t.likes,
        views: t.views,
      },
      timestamp: t.created_timestamp ? t.created_timestamp : t.created_at,
    };
  } catch {
    return null;
  }
}

/** What the connected server had to say about a link. */
interface ServerUnfurl {
  data: OgData | null;
  /** The operator has switched link previews off. */
  disabled: boolean;
}

/**
 * Asks the connected server to unfurl the link.
 *
 * The fetch happens from the server's address rather than from here, which is
 * the point: a link in a message is written by somebody else, and fetching it
 * from this machine would tell whoever posted it the IP of everyone who read
 * the message.
 */
async function fromServer(url: string): Promise<ServerUnfurl> {
  const { address, token } = useSession.getState();
  if (!address || !token) return { data: null, disabled: false };

  const scheme = address.secure ? "https" : "http";
  const host =
    address.host.includes(":") && !address.host.startsWith("[")
      ? `[${address.host}]`
      : address.host;

  try {
    const res = await fetch(
      `${scheme}://${host}:${address.port}/unfurl?url=${encodeURIComponent(url)}`,
      {
        // Unfurling makes the server fetch a URL in its own name, so it is a
        // capability for members rather than for anybody who finds the address.
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (res.status === 403) return { data: null, disabled: true };
    if (!res.ok) return { data: null, disabled: false };

    const data = await res.json();
    if (data && (data.title || data.description || data.image || data.video)) {
      return { data, disabled: false };
    }
  } catch {
    // A server that cannot be reached is not a reason to ask somebody else.
  }
  return { data: null, disabled: false };
}

/**
 * Fetches the metadata behind a link.
 *
 * The connected server does the fetching. Two earlier revisions of this fell
 * back to fetching the link from the browser and then to a public unfurling
 * API, and both were worse than showing no preview at all:
 *
 *   - Fetching it here means every client that renders the message calls on a
 *     host the message's author chose. Almost none of those replies are even
 *     readable, because a cross-origin page without CORS headers is opaque — so
 *     the cost was paid on every link and the preview earned on almost none.
 *   - Handing the URL to a public API sends every link posted in a self-hosted
 *     chat to a third party, and silently ignores an operator who turned link
 *     previews off.
 *
 * What is left is the server, plus one exception for tweets, which no generic
 * OpenGraph read can describe as well.
 */
async function fetchMetadata(url: string): Promise<OgData | null> {
  const tweet = url.match(TWEET_URL_REGEX);
  if (tweet && tweet[1] && tweet[2]) {
    const rich = await fromFxTwitter(tweet[1], tweet[2], url);
    if (rich) return rich;
  }

  const server = await fromServer(url);
  // An operator who switched previews off means it for every link, not just
  // the ones this client could not resolve some other way.
  if (server.disabled) return null;
  if (server.data) return server.data;

  if (isYouTube(url)) return fromYouTube(url);
  return null;
}

/**
 * Retrieves OpenGraph metadata for a URL with caching.
 */
export function getLinkMetadata(url: string): Promise<OgData | null> {
  const existing = memoryCache.get(url);
  if (existing) return existing;

  // Only an answer is worth keeping. A miss or a failure describes the moment
  // rather than the link — a server that was restarting, a request that timed
  // out — and remembering it leaves the preview blank for the rest of the
  // session, long after the thing that failed came back.
  const promise = fetchMetadata(url).then(
    (data) => {
      if (data === null) memoryCache.delete(url);
      return data;
    },
    (error) => {
      memoryCache.delete(url);
      throw error;
    },
  );
  memoryCache.set(url, promise);
  return promise;
}
