/**
 * Formatting for message timestamps.
 *
 * The wire carries Unix seconds, so everything here takes seconds and converts
 * once, at the boundary.
 */

const MS = 1000;

/** How far apart two messages may be and still be grouped under one header. */
export const GROUPING_WINDOW_SECONDS = 5 * 60;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The clock time a message was sent, in the viewer's locale. */
export function formatTime(seconds: number): string {
  return new Date(seconds * MS).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A full date and time, for the tooltip on a timestamp. */
export function formatFull(seconds: number): string {
  return new Date(seconds * MS).toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  });
}

/**
 * The label of a day separator: "Today" and "Yesterday" by name, anything
 * older by date.
 */
export function formatDay(seconds: number, now: Date = new Date()): string {
  const date = new Date(seconds * MS);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * MS));

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Whether two timestamps fall on the same calendar day for the viewer. */
export function sameDay(a: number, b: number): boolean {
  return startOfDay(new Date(a * MS)) === startOfDay(new Date(b * MS));
}
