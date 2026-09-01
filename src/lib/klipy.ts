/**
 * GIFs and stickers, fetched through the connected Aural server rather than
 * from api.klipy.com directly.
 *
 * The credential is the operator's, and Klipy carries it in the request path,
 * so a client that held it would leak it into every proxy log between here and
 * there. The server keeps it and answers these calls under it, which also means
 * one cache in front of one key serves the whole room: a Klipy key is rated by
 * the hour, not by the member.
 *
 * The shapes below are Klipy's own, unchanged — the proxy hands its answer back
 * untouched, so it is invisible to this module beyond the address.
 */

import { useSession } from "@/store/session";
import { AuralError, type ProtocolError } from "./protocol";

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

/**
 * A short cache in front of the server's own longer one. This is only about
 * saving a round trip while somebody flicks between tabs; the cache that keeps
 * the server inside its Klipy allowance lives on the server.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
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

/** Thrown when the picker is opened against a server that cannot answer. */
export class KlipyUnavailable extends Error {
  constructor() {
    super("This server has no Klipy integration configured.");
    this.name = "KlipyUnavailable";
  }
}

/** The proxy endpoint for one lookup on the connected server. */
function endpoint(kind: "gifs" | "stickers", action: string, params: Record<string, string>): string {
  const { address } = useSession.getState();
  if (!address) throw new KlipyUnavailable();

  const scheme = address.secure ? "https" : "http";
  const host = address.host.includes(":") && !address.host.startsWith("[")
    ? `[${address.host}]`
    : address.host;

  const query = new URLSearchParams(params).toString();
  return `${scheme}://${host}:${address.port}/klipy/${kind}/${action}${query ? `?${query}` : ""}`;
}

/**
 * Runs one lookup, caching the parsed result under the request that produced it.
 *
 * A failure is not cached: unlike a result, it says nothing about the query, and
 * remembering it would keep a picker empty long after the server recovered.
 */
async function lookup<T>(
  kind: "gifs" | "stickers",
  action: string,
  params: Record<string, string>,
  pick: (body: unknown) => T,
): Promise<T> {
  const cacheKey = `${kind}/${action}?${new URLSearchParams(params).toString()}`;
  const cached = getCached<T>(cacheKey);
  if (cached) return cached;

  const { token } = useSession.getState();
  if (!token) throw new KlipyUnavailable();

  const response = await fetch(endpoint(kind, action, params), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const raw = await response.text();
    try {
      const body = JSON.parse(raw) as { error?: ProtocolError };
      if (body.error?.code) throw new AuralError(body.error);
    } catch (caught) {
      if (caught instanceof AuralError) throw caught;
    }
    throw new Error(`The server answered ${response.status}.`);
  }

  const picked = pick(await response.json());
  setCached(cacheKey, picked);
  return picked;
}

/** The list of items Klipy wraps in its envelope, whatever the collection. */
function itemsOf(body: unknown): KlipyMediaItem[] {
  return (body as { data?: { data?: KlipyMediaItem[] } })?.data?.data ?? [];
}

/** Fetches GIF categories for the initial category card grid. */
export function getGifCategories(): Promise<KlipyCategory[]> {
  return lookup("gifs", "categories", {}, (body) =>
    (body as { data?: { categories?: KlipyCategory[] } })?.data?.categories ?? []);
}

/** Fetches trending GIFs. */
export function getTrendingGifs(limit = 30): Promise<KlipyMediaItem[]> {
  return lookup("gifs", "trending", { limit: String(limit) }, itemsOf);
}

/** Searches GIFs by term. */
export function searchGifs(query: string, limit = 30): Promise<KlipyMediaItem[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return getTrendingGifs(limit);
  return lookup("gifs", "search", { q: trimmed, limit: String(limit) }, itemsOf);
}

/** Fetches trending stickers. */
export function getTrendingStickers(limit = 30): Promise<KlipyMediaItem[]> {
  return lookup("stickers", "trending", { limit: String(limit) }, itemsOf);
}

/** Searches stickers by term. */
export function searchStickers(query: string, limit = 30): Promise<KlipyMediaItem[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return getTrendingStickers(limit);
  return lookup("stickers", "search", { q: trimmed, limit: String(limit) }, itemsOf);
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
