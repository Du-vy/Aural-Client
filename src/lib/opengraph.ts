/**
 * OpenGraph and metadata extraction for rich link previews.
 * Features in-memory caching and graceful error handling.
 */

export interface OgData {
  url: string;
  siteName?: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  color?: string;
  author?: string;
}

const memoryCache = new Map<string, Promise<OgData | null>>();

/**
 * Parses OpenGraph / meta tags out of raw HTML string.
 */
function parseHtmlMetadata(html: string, originalUrl: string): OgData | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const getMeta = (prop: string, name?: string): string | undefined => {
      const el =
        doc.querySelector(`meta[property="${prop}"]`) ||
        doc.querySelector(`meta[name="${prop}"]`) ||
        (name ? doc.querySelector(`meta[name="${name}"]`) : null);
      return el?.getAttribute("content")?.trim() || undefined;
    };

    const title =
      getMeta("og:title") ||
      getMeta("twitter:title") ||
      doc.querySelector("title")?.textContent?.trim() ||
      undefined;

    const description =
      getMeta("og:description") ||
      getMeta("twitter:description") ||
      getMeta("description") ||
      undefined;

    let image = getMeta("og:image") || getMeta("twitter:image");
    if (image && !image.startsWith("http://") && !image.startsWith("https://")) {
      try {
        image = new URL(image, originalUrl).href;
      } catch {
        // ignore malformed relative URLs
      }
    }

    const siteName =
      getMeta("og:site_name") ||
      getMeta("application-name") ||
      undefined;

    const color = getMeta("theme-color") || undefined;

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

    if (!title && !description && !image) {
      return null;
    }

    return {
      url: originalUrl,
      title,
      description,
      image,
      siteName,
      favicon,
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
  // If YouTube, oEmbed has CORS enabled and gives fast title & author
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

  // 1. Try direct fetch in case target server sends CORS headers
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

  // 2. Try Microlink public API fallback for CORS-blocked sites
  try {
    const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(3000),
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
          favicon: d.logo?.url || undefined,
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
