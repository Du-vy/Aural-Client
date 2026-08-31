/**
 * Searching and personalising the generated emoji catalogue.
 *
 * This module pulls in `emoji-data.ts`, which is a large generated file, so it
 * is imported only by the picker — which is itself loaded on demand. Anything
 * needed to *render* a message lives in `emoji.ts` instead, which stays free of
 * the catalogue.
 */

import { EMOJI_GROUPS, type EmojiEntry } from "./emoji-data";

export { EMOJI_GROUPS, UNICODE_EMOJI_VERSION } from "./emoji-data";
export type { EmojiEntry, EmojiGroup } from "./emoji-data";

/** The five Fitzpatrick modifiers, light to dark, plus the untoned default. */
export const SKIN_TONES = [
  { key: "default", label: "Default", modifier: "", swatch: "\u{1F44B}" },
  { key: "light", label: "Light", modifier: "\u{1F3FB}", swatch: "\u{1F44B}\u{1F3FB}" },
  { key: "medium-light", label: "Medium light", modifier: "\u{1F3FC}", swatch: "\u{1F44B}\u{1F3FC}" },
  { key: "medium", label: "Medium", modifier: "\u{1F3FD}", swatch: "\u{1F44B}\u{1F3FD}" },
  { key: "medium-dark", label: "Medium dark", modifier: "\u{1F3FE}", swatch: "\u{1F44B}\u{1F3FE}" },
  { key: "dark", label: "Dark", modifier: "\u{1F3FF}", swatch: "\u{1F44B}\u{1F3FF}" },
] as const;

export type SkinToneKey = (typeof SKIN_TONES)[number]["key"];

/** Whether an entry takes a skin tone. */
export function tonable(entry: EmojiEntry): boolean {
  return entry.length === 3;
}

/**
 * Applies a skin tone by inserting the modifier straight after the first
 * codepoint, which is the character the tone modifies.
 *
 * `scripts/make-emoji.mjs` marks an emoji as tonable only when this rule
 * reproduces all five of Unicode's own toned sequences for it, so applying it
 * to a marked entry cannot produce a sequence that renders as two glyphs.
 */
export function withTone(emoji: string, modifier: string): string {
  if (modifier === "") return emoji;
  const points = [...emoji];
  return [points[0], modifier, ...points.slice(1)].join("");
}

/** An entry rendered for a particular tone preference. */
export function display(entry: EmojiEntry, modifier: string): string {
  return tonable(entry) ? withTone(entry[0], modifier) : entry[0];
}

/**
 * Ranks a name against a query. A lower score is a better match, and
 * `Infinity` means no match at all.
 *
 * Matching whole words first is what makes this useful rather than merely
 * correct. Plain substring matching answers "hand" with "handbag", and
 * prefix matching alone never finds "smiling face" for "smile" — so a word
 * that *equals* the query beats a word that merely *starts* with it, which
 * beats a match buried anywhere else.
 */
function score(name: string, query: string): number {
  if (name === query) return 0;

  const words = name.split(/[\s-]+/);
  if (words.some((word) => word === query)) return 1;
  if (words.some((word) => word.startsWith(query))) return 2;

  return name.includes(query) ? 3 : Infinity;
}

/**
 * Extra terms to search for a given query.
 *
 * Unicode names are formal descriptions, not the words people reach for:
 * nothing is named "smile" or "happy", and no amount of prefix matching
 * bridges "smile" to "smiling", since the shared stem stops at "smil". These
 * are the gaps worth closing by hand — an explicit list stays predictable,
 * where fuzzy matching would start answering "cat" with "catch".
 */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  angry: ["pouting", "rage", "enraged"],
  clap: ["clapping"],
  cool: ["sunglasses"],
  cry: ["crying"],
  dead: ["skull"],
  happy: ["smiling", "grinning", "beaming"],
  hi: ["waving"],
  hug: ["hugging", "hugs"],
  kiss: ["kissing"],
  laugh: ["laughing", "tears of joy", "grinning squinting"],
  like: ["thumbs up"],
  lol: ["laughing", "tears of joy"],
  love: ["heart", "heart-eyes", "hearts"],
  ok: ["OK"],
  pray: ["folded hands"],
  sad: ["frowning", "crying", "pensive", "disappointed"],
  shrug: ["shrugging"],
  sick: ["nauseated", "vomiting", "thermometer"],
  sleep: ["sleeping", "sleepy", "zzz"],
  smile: ["smiling", "grinning", "slightly smiling"],
  sorry: ["pleading", "frowning"],
  thanks: ["folded hands", "thumbs up"],
  think: ["thinking"],
  wave: ["waving"],
  wink: ["winking"],
  yes: ["check mark", "thumbs up"],
  no: ["cross mark", "prohibited", "thumbs down"],
};

export interface EmojiMatch {
  entry: EmojiEntry;
  group: string;
}

/** How many results a search returns, which is more than fills the panel. */
export const SEARCH_LIMIT = 120;

/** Finds emoji whose name matches a query, best first. */
export function searchEmoji(query: string, limit = SEARCH_LIMIT): EmojiMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];

  // An alias is worth less than the word actually typed, so a direct hit always
  // outranks a synonym of it.
  const terms: Array<{ text: string; penalty: number }> = [{ text: needle, penalty: 0 }];
  for (const alias of ALIASES[needle] ?? []) {
    terms.push({ text: alias.toLowerCase(), penalty: 0.5 });
  }

  const scored: Array<{ match: EmojiMatch; rank: number }> = [];
  for (const group of EMOJI_GROUPS) {
    for (const entry of group.emoji) {
      const name = entry[1].toLowerCase();
      let rank = Infinity;
      for (const term of terms) {
        rank = Math.min(rank, score(name, term.text) + term.penalty);
      }
      if (rank === Infinity) continue;
      scored.push({ match: { entry, group: group.name }, rank });
    }
  }

  return scored
    .sort((a, b) => a.rank - b.rank || a.match.entry[1].length - b.match.entry[1].length)
    .slice(0, limit)
    .map(({ match }) => match);
}

/** Looks an entry up by its untoned character. */
export function findEntry(emoji: string): EmojiEntry | undefined {
  for (const group of EMOJI_GROUPS) {
    for (const entry of group.emoji) {
      if (entry[0] === emoji) return entry;
    }
  }
  return undefined;
}

// --- personalisation --------------------------------------------------------

const RECENT_KEY = "aural.emoji.recent.v1";
const TONE_KEY = "aural.emoji.tone.v1";

/** How many recent emoji are remembered, which is one row of the picker. */
export const MAX_RECENT = 27;

/**
 * localStorage is wrapped everywhere it is touched: a private window, cleared
 * site data, or a browser set to block storage can make it throw outright, and
 * an emoji preference is never worth breaking the composer over.
 */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the preference simply will not persist.
  }
}

/** The emoji used most recently, newest first. */
export function recentEmoji(): string[] {
  const raw = readStorage(RECENT_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Records a use, moving it to the front, and returns the new list. */
export function rememberEmoji(emoji: string): string[] {
  const next = [emoji, ...recentEmoji().filter((held) => held !== emoji)].slice(0, MAX_RECENT);
  writeStorage(RECENT_KEY, JSON.stringify(next));
  return next;
}

/** The stored skin tone preference. */
export function storedTone(): SkinToneKey {
  const raw = readStorage(TONE_KEY);
  const known = SKIN_TONES.find((tone) => tone.key === raw);
  return known?.key ?? "default";
}

export function storeTone(key: SkinToneKey): void {
  writeStorage(TONE_KEY, key);
}

export function modifierFor(key: SkinToneKey): string {
  return SKIN_TONES.find((tone) => tone.key === key)?.modifier ?? "";
}
