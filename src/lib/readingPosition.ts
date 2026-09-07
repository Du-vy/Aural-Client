/**
 * Where the reader was in each channel and conversation.
 *
 * A message list is unmounted the moment another channel is opened, so what it
 * knows about where the reader had got to goes with it. Held here instead, that
 * survives leaving and coming back — by Back and Forward, by the sidebar, by
 * any of the ways a channel is opened, since they are all the same arrival as
 * far as the list is concerned.
 *
 * A position is a message and how far below the top of the viewport it sat,
 * rather than a number of pixels: the window a channel holds is trimmed and
 * paged at both ends, and a pixel measured against one window means something
 * else in the next. Being at the bottom is not a position — it is the absence
 * of one, and what a list does with no position is follow along.
 *
 * This is deliberately not in a store. Nothing renders from it; it is read once
 * on the way into a list and written as the reader scrolls, and putting it in
 * state would re-render every list on every scroll event to no purpose.
 */

export interface ReadingPosition {
  /** The topmost message still on screen. */
  anchorId: number;
  /** How far below the top of the scroller that message sat, in pixels. */
  offset: number;
}

const positions = new Map<string, ReadingPosition>();

/**
 * Names one channel's position.
 *
 * Scoped by connection, because a channel id is only unique within the server
 * that issued it and two servers open at once would otherwise be restoring each
 * other's places.
 */
export function channelPositionKey(serverId: string, channelId: number): string {
  return `${serverId}:c${channelId}`;
}

/** Names one private conversation's position, scoped the same way. */
export function conversationPositionKey(serverId: string, userId: number): string {
  return `${serverId}:d${userId}`;
}

/**
 * Records where the reader is, or that they are at the bottom.
 *
 * A null position is not a gap to be left alone: it is the reader having caught
 * up, which is worth forgetting an older place for.
 */
export function rememberReadingPosition(key: string, position: ReadingPosition | null): void {
  if (position === null) positions.delete(key);
  else positions.set(key, position);
}

/** Where the reader left off, or null if they were at the bottom or never here. */
export function recallReadingPosition(key: string): ReadingPosition | null {
  return positions.get(key) ?? null;
}

/** Forgets one place, for when what it pointed into is no longer held. */
export function forgetReadingPosition(key: string): void {
  positions.delete(key);
}

/** Forgets everything remembered about one connection. */
export function forgetReadingPositions(serverId: string): void {
  const prefix = `${serverId}:`;
  for (const key of positions.keys()) {
    if (key.startsWith(prefix)) positions.delete(key);
  }
}
