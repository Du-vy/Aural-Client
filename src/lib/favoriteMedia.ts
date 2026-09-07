/**
 * The GIFs and stickers somebody has starred in the picker.
 *
 * A favourite is kept whole rather than as an id: Klipy has no endpoint that
 * turns an id back into an item, so a list of ids would need the picker to
 * search for what it already had. Storing the two URLs and the title costs a
 * few hundred bytes and makes the favourites tab answerable offline, before
 * any lookup has run — which is the point of it.
 *
 * Only Klipy media is starrable. A server's own stickers are served from that
 * server's address, so a favourite of one would be a broken picture from
 * anywhere else, and they already have a section of their own in the picker.
 */

export type FavoriteKind = "gif" | "sticker";

export interface FavoriteMedia {
  /** Klipy's id for the item, as a string so a number id and "12" agree. */
  id: string;
  kind: FavoriteKind;
  title: string;
  /** The compact URL the grid draws. */
  preview: string;
  /** The full-size URL a click sends. */
  url: string;
  addedAt: number;
}

const FAVORITES_KEY = "aural.media.favorites.v1";

/**
 * How many are kept. Well past what anybody scrolls, and small enough that the
 * whole list still parses in a frame when the picker opens.
 */
const MAX_FAVORITES = 200;

function isFavorite(value: unknown): value is FavoriteMedia {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    (item.kind === "gif" || item.kind === "sticker") &&
    typeof item.title === "string" &&
    typeof item.preview === "string" &&
    typeof item.url === "string" &&
    typeof item.addedAt === "number"
  );
}

/** Everything starred, newest first. */
export function readFavorites(): FavoriteMedia[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFavorite).sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

function write(favorites: readonly FavoriteMedia[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.slice(0, MAX_FAVORITES)));
  } catch {
    // Storage is unavailable; the change still holds for this session.
  }
}

/** The favourites of one kind, for the tab that shows them. */
export function favoritesOf(
  favorites: readonly FavoriteMedia[],
  kind: FavoriteKind,
): FavoriteMedia[] {
  return favorites.filter((item) => item.kind === kind);
}

/** Whether one item is already starred. */
export function isFavorited(
  favorites: readonly FavoriteMedia[],
  kind: FavoriteKind,
  id: string,
): boolean {
  return favorites.some((item) => item.kind === kind && item.id === id);
}

/**
 * Stars an item, or unstars it if it was already starred, and returns the new
 * list. The caller holds that list as state, so the picker redraws the star
 * without reading storage back.
 */
export function toggleFavorite(entry: Omit<FavoriteMedia, "addedAt">): FavoriteMedia[] {
  const current = readFavorites();
  const without = current.filter((item) => !(item.kind === entry.kind && item.id === entry.id));

  const next =
    without.length === current.length
      ? [{ ...entry, addedAt: Date.now() }, ...without].slice(0, MAX_FAVORITES)
      : without;

  write(next);
  return next;
}
