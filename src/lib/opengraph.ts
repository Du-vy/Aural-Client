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

/**
 * Parses OpenGraph / meta tags out of raw HTML string.
 */
function parseHtmlMetadata(html: string, originalUrl: string): OgData | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const getMeta = (...props: string[]): string | undefined => {
      for (const prop of props) {
        const el =
          doc.querySelector(`meta[property="${prop}"]`) ||
          doc.querySelector(`meta[name="${prop}"]`);
        const content = el?.getAttribute("content")?.trim();
        if (content) return content;
      }
      return undefined;
    };

    const title =
      getMeta("og:title", "twitter:title") ||
      doc.querySelector("title")?.textContent?.trim() ||
      undefined;

    const description =
      getMeta("og:description", "twitter:description", "description") ||
      undefined;

    let image = getMeta("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src");
    if (image && !image.startsWith("http://") && !image.startsWith("https://")) {
      try {
        image = new URL(image, originalUrl).href;
      } catch {
        // ignore malformed relative URLs
      }
    }

    let video = getMeta(
      "og:video",
      "og:video:url",
      "og:video:secure_url",
      "twitter:player:stream",
    );
    if (video && !video.startsWith("http://") && !video.startsWith("https://")) {
      try {
        video = new URL(video, originalUrl).href;
      } catch {
        // ignore malformed relative URLs
      }
    }

    const videoType = getMeta("og:video:type") || (video?.endsWith(".mp4") ? "video/mp4" : undefined);

    const siteName =
      getMeta("og:site_name", "application-name") ||
      undefined;

    const color = getMeta("theme-color") || undefined;

    const author =
      getMeta("author", "article:author", "og:article:author", "twitter:creator") ||
      undefined;

    let favicon =
      doc.querySelector('link[rel~="icon"]')?.getAttribute("href") ||
      doc.querySelector('link[rel~="shortcut icon"]')?.getAttribute("href") ||
      undefined;

    if (favicon && !favicon.startsWith("http://") && !favicon.startsWith("https://")) {
      try {
        favicon = new URL(favicon, originalUrl).href;
      } catch {
        // ignore
      }
    }

    let authorIcon = doc.querySelector('link[rel~="apple-touch-icon"]')?.getAttribute("href") || undefined;
    if (authorIcon && !authorIcon.startsWith("http://") && !authorIcon.startsWith("https://")) {
      try {
        authorIcon = new URL(authorIcon, originalUrl).href;
      } catch {
        // ignore
      }
    }

    if (!title && !description && !image && !video) {
      return null;
    }

    return {
      url: originalUrl,
      title,
      description,
      image,
      video,
      videoType,
      siteName,
      favicon,
      author,
      authorIcon,
      color,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches oEmbed or OpenGraph metadata for a URL.
 */
async function fetchMetadata(url: string): Promise<OgData | null> {
  // 1. If YouTube, oEmbed has CORS enabled and gives fast title & author
  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (res.ok) {
        const data = await res.json();
        return {
          url,
          siteName: data.provider_name || "YouTube",
          title: data.title,
          author: data.author_name,
          image: data.thumbnail_url,
        };
      }
    } catch {
      // Fall through
    }
  }

  // 2. Twitter / X / FxTwitter / Fixupx / VxTwitter direct API
  const tweetMatch = url.match(TWEET_URL_REGEX);
  if (tweetMatch && tweetMatch[1] && tweetMatch[2]) {
    const username = tweetMatch[1];
    const statusId = tweetMatch[2];
    try {
      const res = await fetch(
        `https://api.fxtwitter.com/${encodeURIComponent(username)}/status/${encodeURIComponent(statusId)}`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (res.ok) {
        const body = await res.json();
        if (body.code === 200 && body.tweet) {
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
        }
      }
    } catch {
      // Fall through to standard fetch
    }
  }

  // 3. Try connected Aural-Server /unfurl endpoint (bypasses CORS & anti-bot restrictions server-side)
  try {
    const address = useSession.getState().address;
    if (address) {
      const scheme = address.secure ? "https" : "http";
      const host =
        address.host.includes(":") && !address.host.startsWith("[")
          ? `[${address.host}]`
          : address.host;
      const endpoint = `${scheme}://${host}:${address.port}/unfurl?url=${encodeURIComponent(url)}`;
      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && (data.title || data.description || data.image || data.video)) {
          return data;
        }
      }
    }
  } catch {
    // Fall through to client-side fallbacks
  }

  // 4. Try direct fetch in case target server sends CORS headers
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2500),
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/html")) {
        const html = await res.text();
        const data = parseHtmlMetadata(html, url);
        if (data) return data;
      }
    }
  } catch {
    // Expected for CORS protected domains; try fallback provider
  }

  // 5. Try Microlink public API fallback for CORS-blocked sites
  try {
    const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const body = await res.json();
      if (body.status === "success" && body.data) {
        const d = body.data;
        return {
          url,
          siteName: d.publisher || undefined,
          title: d.title || undefined,
          description: d.description || undefined,
          image: d.image?.url || undefined,
          video: d.video?.url || undefined,
          videoType: d.video?.type || undefined,
          favicon: d.logo?.url || undefined,
          author: d.author || undefined,
        };
      }
    }
  } catch {
    // Graceful fallback to null
  }

  return null;
}

/**
 * Retrieves OpenGraph metadata for a URL with caching.
 */
export function getLinkMetadata(url: string): Promise<OgData | null> {
  const existing = memoryCache.get(url);
  if (existing) return existing;

  const promise = fetchMetadata(url);
  memoryCache.set(url, promise);
  return promise;
}
