/**
 * The search query language.
 *
 * A search is typed as one line: filters written `key:value`, and everything
 * else as the words to look for. That is the grammar every chat client has
 * taught people, and it has the property that a query survives being copied,
 * pasted and edited as text, which a row of dropdowns does not.
 *
 * This module is the whole of it: parsing a line into filters and free text,
 * writing filters back out, resolving the names people type into the ids the
 * server matches on, and turning a date into the two Unix seconds that bound it.
 */

import type {
  Channel,
  Message,
  MessageSearchRequest,
  SearchHas,
  SearchSort,
  User,
} from "./protocol";

/** The filters a query line can carry. */
export const FILTER_KEYS = ["from", "in", "has", "before", "during", "after"] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

/** The values `has:` accepts, in the order they are offered. */
export const HAS_VALUES: readonly SearchHas[] = ["link", "file", "image", "video", "sound"];

/** One `key:value` filter, with where it sits in the line it was read from. */
export interface SearchToken {
  key: FilterKey;
  /** The value as typed, with any quotes already stripped. */
  value: string;
  /** Half-open range of the whole `key:value` run in the source string. */
  start: number;
  end: number;
}

export interface ParsedQuery {
  filters: SearchToken[];
  /** Everything that was not a filter, with runs of spaces collapsed. */
  text: string;
}

const KEY_PATTERN = new RegExp(`^(${FILTER_KEYS.join("|")}):`, "i");

/**
 * Splits a line into its `key:value` filters and the free text around them.
 *
 * A value may be quoted, which is how a channel or a nickname with a space in
 * it is written. A key with nothing after it yet is still a filter — that is
 * the state the line is in while somebody is choosing the value — so it parses
 * to an empty value rather than falling back to being a word.
 */
export function parseSearchInput(input: string): ParsedQuery {
  const filters: SearchToken[] = [];
  const words: string[] = [];

  let at = 0;
  while (at < input.length) {
    if (/\s/.test(input[at]!)) {
      at += 1;
      continue;
    }

    const start = at;
    const key = KEY_PATTERN.exec(input.slice(at));
    if (key) {
      at += key[0].length;
      const { value, end } = readValue(input, at);
      filters.push({
        key: key[1]!.toLowerCase() as FilterKey,
        value,
        start,
        end,
      });
      at = end;
      continue;
    }

    const { value, end } = readValue(input, at);
    if (value !== "") words.push(value);
    at = end;
  }

  return { filters, text: words.join(" ") };
}

/**
 * Reads one value: a quoted run, or everything up to the next space. The
 * quotes are dropped here and put back by {@link writeSearchInput}, so nothing
 * downstream has to think about them.
 */
function readValue(input: string, at: number): { value: string; end: number } {
  if (input[at] === '"') {
    const close = input.indexOf('"', at + 1);
    if (close === -1) return { value: input.slice(at + 1), end: input.length };
    return { value: input.slice(at + 1, close), end: close + 1 };
  }
  let end = at;
  while (end < input.length && !/\s/.test(input[end]!)) end += 1;
  return { value: input.slice(at, end), end };
}

/** Writes one filter back out, quoting a value that would otherwise split. */
export function writeFilter(key: FilterKey, value: string): string {
  return /[\s"]/.test(value) ? `${key}:"${value.replaceAll('"', "")}"` : `${key}:${value}`;
}

/** Writes a whole query back out: filters first, then the words. */
export function writeSearchInput(query: ParsedQuery): string {
  const parts = query.filters.map((filter) => writeFilter(filter.key, filter.value));
  if (query.text) parts.push(query.text);
  return parts.join(" ");
}

/**
 * Replaces the token covering `caret` with `replacement`, which is what
 * accepting a suggestion does. With no token under the caret the replacement is
 * inserted there instead. The returned caret sits just past what was written,
 * ready for the next word.
 */
export function replaceTokenAt(
  input: string,
  caret: number,
  replacement: string,
): { input: string; caret: number } {
  const { start, end } = tokenBoundsAt(input, caret);
  // A key that is still waiting for its value is written without a space, so
  // that typing the value continues the same token.
  const wantsSpace = !replacement.endsWith(":");
  const spaceFollows = /\s/.test(input[end] ?? "");
  const written = wantsSpace && !spaceFollows ? `${replacement} ` : replacement;
  return {
    input: input.slice(0, start) + written + input.slice(end),
    // The caret ends past the separator either way, whether that space was
    // written here or was already in the line.
    caret: start + written.length + (wantsSpace && spaceFollows ? 1 : 0),
  };
}

/** The bounds of the whitespace-delimited run the caret sits in or against. */
export function tokenBoundsAt(input: string, caret: number): { start: number; end: number } {
  let start = Math.min(caret, input.length);
  while (start > 0 && !/\s/.test(input[start - 1]!)) start -= 1;
  let end = Math.min(caret, input.length);
  while (end < input.length && !/\s/.test(input[end]!)) end += 1;
  return { start, end };
}

/**
 * What the caret is in the middle of typing: a filter whose value is being
 * chosen, a word that could still become a filter key, or nothing at all.
 */
export type ActiveToken =
  | { kind: "value"; key: FilterKey; value: string }
  | { kind: "word"; value: string };

export function activeTokenAt(input: string, caret: number): ActiveToken {
  const { start, end } = tokenBoundsAt(input, caret);
  const run = input.slice(start, end);
  const key = KEY_PATTERN.exec(run);
  if (key) {
    return {
      kind: "value",
      key: key[1]!.toLowerCase() as FilterKey,
      value: run.slice(key[0].length).replaceAll('"', ""),
    };
  }
  return { kind: "word", value: run };
}

// --- dates -------------------------------------------------------------------

/**
 * A date filter is written the way a date is read: `2026`, `2026-08` or
 * `2026-08-31`. Each names a span rather than an instant, which is what lets
 * `during:2026-08` mean the whole of that month.
 *
 * The span is resolved in the reader's own time zone, because the day a message
 * was sent on is the day it was sent on where they are.
 */
export interface DateSpan {
  /** Unix seconds, inclusive. */
  start: number;
  /** Unix seconds, exclusive. */
  end: number;
}

export function parseDateSpan(value: string): DateSpan | null {
  const match = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]) - 1;
  const day = match[3] === undefined ? null : Number(match[3]);
  if (month !== null && (month < 0 || month > 11)) return null;
  if (day !== null && (day < 1 || day > 31)) return null;

  const start = new Date(year, month ?? 0, day ?? 1);
  // A Date rolls an impossible day over into the next month, which is how an
  // invalid date such as 2026-02-31 is caught.
  if (day !== null && start.getDate() !== day) return null;

  const end = new Date(start);
  if (day !== null) end.setDate(end.getDate() + 1);
  else if (month !== null) end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);

  return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
}

/** Today, written the way a date filter is. */
export function todayAsFilterValue(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// --- highlighting ------------------------------------------------------------

/** A run of a message that matched, as indices into the original text. */
export interface Highlight {
  start: number;
  end: number;
}

/**
 * Finds where the terms of a query appear in a message.
 *
 * Folding can change a string's length — ß folds to two letters — so the folded
 * copy is built one character at a time alongside a table of where each folded
 * character came from. That is what lets a match found in the folded text be
 * pointed back at the exact characters of the original.
 */
export function highlightRanges(text: string, terms: readonly string[]): Highlight[] {
  if (terms.length === 0) return [];

  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  for (const character of text) {
    const piece = foldName(character);
    for (let i = 0; i < piece.length; i += 1) {
      starts.push(at);
      ends.push(at + character.length);
    }
    folded += piece;
    at += character.length;
  }

  const found: Highlight[] = [];
  for (const term of terms) {
    const needle = foldName(term);
    if (needle === "") continue;
    for (let from = folded.indexOf(needle); from !== -1; from = folded.indexOf(needle, from + 1)) {
      const last = from + needle.length - 1;
      if (starts[from] === undefined || ends[last] === undefined) break;
      found.push({ start: starts[from]!, end: ends[last]! });
    }
  }

  // Two terms can match overlapping runs, and drawing them as two marks would
  // put a seam through the middle of one word.
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Highlight[] = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * Splits text into the runs that matched and the runs that did not, in order,
 * which is exactly what a renderer needs to draw the marks.
 */
export function splitHighlights(
  text: string,
  terms: readonly string[],
): { value: string; match: boolean }[] {
  const ranges = highlightRanges(text, terms);
  if (ranges.length === 0) return [{ value: text, match: false }];

  const parts: { value: string; match: boolean }[] = [];
  let at = 0;
  for (const range of ranges) {
    if (range.start > at) parts.push({ value: text.slice(at, range.start), match: false });
    parts.push({ value: text.slice(range.start, range.end), match: true });
    at = range.end;
  }
  if (at < text.length) parts.push({ value: text.slice(at), match: false });
  return parts;
}

/**
 * The words a query looks for, split the way the server splits them: whitespace
 * separates terms and double quotes hold a phrase together.
 */
export function searchTerms(text: string): string[] {
  const terms: string[] = [];
  for (const [, phrase, word] of text.matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = (phrase ?? word ?? "").trim();
    if (term !== "") terms.push(term);
  }
  return terms;
}

// --- resolving ---------------------------------------------------------------

/** A thing a filter can name: a member to search from, or a channel to search in. */
export interface NamedEntry {
  id: number;
  /** What the user types to pick it. */
  name: string;
  /** A second name that also matches, such as an account username. */
  alias?: string;
}

export interface SearchDirectory {
  users: NamedEntry[];
  channels: NamedEntry[];
}

/** Case- and accent-insensitive comparison, matching how the server folds text. */
export function foldName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    // Combining marks, which is what an accent decomposes into. Only the Latin
    // block is stripped, for the same reason the server only strips that one:
    // in Devanagari the very same category holds vowels, not accents.
    .replace(/[̀-ͯ]/g, "");
}

function findNamed(entries: readonly NamedEntry[], value: string): NamedEntry | undefined {
  const wanted = foldName(value.replace(/^[#@]/, ""));
  return entries.find(
    (entry) => foldName(entry.name) === wanted || (entry.alias && foldName(entry.alias) === wanted),
  );
}

/** Entries whose name contains what has been typed, best matches first. */
export function matchNamed(entries: readonly NamedEntry[], value: string): NamedEntry[] {
  const wanted = foldName(value.replace(/^[#@]/, ""));
  if (wanted === "") return [...entries];
  return entries
    .map((entry) => {
      const name = foldName(entry.name);
      const alias = entry.alias ? foldName(entry.alias) : "";
      const at = name.indexOf(wanted);
      const aliasAt = alias ? alias.indexOf(wanted) : -1;
      const best = at === -1 ? aliasAt : aliasAt === -1 ? at : Math.min(at, aliasAt);
      return { entry, rank: best };
    })
    .filter(({ rank }) => rank !== -1)
    .sort((a, b) => a.rank - b.rank || a.entry.name.localeCompare(b.entry.name))
    .map(({ entry }) => entry);
}

/**
 * The members and channels a filter can name.
 *
 * Presence is not persisted, so the members this client knows are the ones
 * connected right now. Everybody else who has ever written in a channel it has
 * read is added from that history, which is what makes `from:` work for
 * somebody who has gone offline since they were last read.
 */
export function buildDirectory(
  channels: ReadonlyMap<number, Channel>,
  users: ReadonlyMap<number, User>,
  history: ReadonlyMap<number, { messages: readonly Message[] }>,
): SearchDirectory {
  const members = new Map<number, NamedEntry>();
  for (const user of users.values()) {
    members.set(user.id, {
      id: user.id,
      name: user.nickname,
      ...(user.username ? { alias: user.username } : {}),
    });
  }
  for (const channel of history.values()) {
    for (const message of channel.messages) {
      if (message.userId === null || members.has(message.userId)) continue;
      members.set(message.userId, { id: message.userId, name: message.author });
    }
  }

  return {
    users: [...members.values()].sort((a, b) => a.name.localeCompare(b.name)),
    channels: [...channels.values()]
      .filter((channel) => channel.type === "text")
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((channel) => ({ id: channel.id, name: channel.name })),
  };
}

export interface BuiltSearch {
  request: MessageSearchRequest;
  /**
   * Filters that named something this client cannot resolve — a member who has
   * never been seen, a mistyped date. They are reported rather than dropped
   * silently, because a search that quietly ignores half of what was asked for
   * is worse than one that says so.
   */
  unresolved: SearchToken[];
  /** Whether there is anything here worth sending at all. */
  empty: boolean;
}

/**
 * Turns a parsed line into the request the server answers.
 *
 * Repeating a filter widens it: two `in:` are two channels to look in. The one
 * exception is the date bounds, where the last one written wins, because two
 * different "before" are a correction rather than a choice.
 */
export function buildSearchRequest(
  query: ParsedQuery,
  directory: SearchDirectory,
  options: { sort: SearchSort; offset?: number; limit?: number } = { sort: "newest" },
): BuiltSearch {
  const request: MessageSearchRequest = { sort: options.sort };
  const unresolved: SearchToken[] = [];

  const channelIds: number[] = [];
  const authorIds: number[] = [];
  const has: SearchHas[] = [];

  for (const filter of query.filters) {
    switch (filter.key) {
      case "in": {
        const found = findNamed(directory.channels, filter.value);
        if (found) channelIds.push(found.id);
        else unresolved.push(filter);
        break;
      }
      case "from": {
        const found = findNamed(directory.users, filter.value);
        if (found) authorIds.push(found.id);
        else unresolved.push(filter);
        break;
      }
      case "has": {
        const value = filter.value.toLowerCase() as SearchHas;
        if (HAS_VALUES.includes(value)) has.push(value);
        else unresolved.push(filter);
        break;
      }
      case "during": {
        const span = parseDateSpan(filter.value);
        if (!span) unresolved.push(filter);
        else {
          request.after = span.start;
          request.before = span.end;
        }
        break;
      }
      case "after": {
        // "after the 3rd" means from the 4th onwards, not from that morning.
        const span = parseDateSpan(filter.value);
        if (!span) unresolved.push(filter);
        else request.after = span.end;
        break;
      }
      case "before": {
        const span = parseDateSpan(filter.value);
        if (!span) unresolved.push(filter);
        else request.before = span.start;
        break;
      }
    }
  }

  if (query.text) request.query = query.text;
  if (channelIds.length > 0) request.channelIds = [...new Set(channelIds)];
  if (authorIds.length > 0) request.authorIds = [...new Set(authorIds)];
  if (has.length > 0) request.has = [...new Set(has)];
  if (options.offset) request.offset = options.offset;
  if (options.limit) request.limit = options.limit;

  const empty =
    !request.query &&
    !request.channelIds &&
    !request.authorIds &&
    !request.has &&
    request.after === undefined &&
    request.before === undefined;

  return { request, unresolved, empty };
}
