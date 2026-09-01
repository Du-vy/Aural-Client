/**
 * KLIPY API client for GIFs and Stickers.
 *
 * Direct integration with api.klipy.com. Includes in-memory caching
 * to respect the 100 requests/hour limit for development API keys.
 */

export interface KlipyMediaFormat {
  url: string;
  width?: number;
  height?: number;
  size?: number;
}

export interface KlipyMediaFormats {
  gif?: KlipyMediaFormat;
  webp?: KlipyMediaFormat;
  png?: KlipyMediaFormat;
  jpg?: KlipyMediaFormat;
  mp4?: KlipyMediaFormat;
  webm?: KlipyMediaFormat;
}

export interface KlipyMediaItem {
  id: number | string;
  slug: string;
  title: string;
  file: {
    hd?: KlipyMediaFormats;
    md?: KlipyMediaFormats;
    sm?: KlipyMediaFormats;
    xs?: KlipyMediaFormats;
  };
}

export interface KlipyCategory {
  category: string;
  query: string;
  preview_url: string;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

const BASE_URL = "https://api.klipy.com/api/v1";

/**
 * Fetches GIF categories for the initial category card grid.
 */
export async function getGifCategories(apiKey: string): Promise<KlipyCategory[]> {
  const cacheKey = `categories:${apiKey}`;
  const cached = getCached<KlipyCategory[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/${encodeURIComponent(apiKey)}/gifs/categories`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`KLIPY API error: ${response.status}`);
  }
  const result = await response.json();
  const categories: KlipyCategory[] = result?.data?.categories ?? [];
  setCached(cacheKey, categories);
  return categories;
}

/**
 * Fetches trending GIFs.
 */
export async function getTrendingGifs(apiKey: string, limit = 30): Promise<KlipyMediaItem[]> {
  const cacheKey = `gifs:trending:${apiKey}:${limit}`;
  const cached = getCached<KlipyMediaItem[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/${encodeURIComponent(apiKey)}/gifs/trending?limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`KLIPY API error: ${response.status}`);
  }
  const result = await response.json();
  const items: KlipyMediaItem[] = result?.data?.data ?? [];
  setCached(cacheKey, items);
  return items;
}

/**
 * Searches GIFs by term.
 */
export async function searchGifs(apiKey: string, query: string, limit = 30): Promise<KlipyMediaItem[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return getTrendingGifs(apiKey, limit);

  const cacheKey = `gifs:search:${apiKey}:${trimmed}:${limit}`;
  const cached = getCached<KlipyMediaItem[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/${encodeURIComponent(apiKey)}/gifs/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`KLIPY API error: ${response.status}`);
  }
  const result = await response.json();
  const items: KlipyMediaItem[] = result?.data?.data ?? [];
  setCached(cacheKey, items);
  return items;
}

/**
 * Fetches trending stickers.
 */
export async function getTrendingStickers(apiKey: string, limit = 30): Promise<KlipyMediaItem[]> {
  const cacheKey = `stickers:trending:${apiKey}:${limit}`;
  const cached = getCached<KlipyMediaItem[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/${encodeURIComponent(apiKey)}/stickers/trending?limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`KLIPY API error: ${response.status}`);
  }
  const result = await response.json();
  const items: KlipyMediaItem[] = result?.data?.data ?? [];
  setCached(cacheKey, items);
  return items;
}

/**
 * Searches stickers by term.
 */
export async function searchStickers(apiKey: string, query: string, limit = 30): Promise<KlipyMediaItem[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return getTrendingStickers(apiKey, limit);

  const cacheKey = `stickers:search:${apiKey}:${trimmed}:${limit}`;
  const cached = getCached<KlipyMediaItem[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/${encodeURIComponent(apiKey)}/stickers/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`KLIPY API error: ${response.status}`);
  }
  const result = await response.json();
  const items: KlipyMediaItem[] = result?.data?.data ?? [];
  setCached(cacheKey, items);
  return items;
}

/**
 * Extracts the best preview URL (compact size) for displaying in the picker grid.
 */
export function getMediaPreviewUrl(item: KlipyMediaItem): string {
  const file = item.file;
  return (
    file.sm?.webp?.url ||
    file.sm?.gif?.url ||
    file.md?.webp?.url ||
    file.md?.gif?.url ||
    file.hd?.webp?.url ||
    file.hd?.gif?.url ||
    file.sm?.png?.url ||
    file.md?.png?.url ||
    file.hd?.png?.url ||
    ""
  );
}

/**
 * Extracts the best full-size URL for sending to chat as direct media.
 */
export function getMediaSendUrl(item: KlipyMediaItem): string {
  const file = item.file;
  return (
    file.hd?.gif?.url ||
    file.hd?.webp?.url ||
    file.hd?.png?.url ||
    file.md?.gif?.url ||
    file.md?.webp?.url ||
    file.md?.png?.url ||
    getMediaPreviewUrl(item)
  );
}
