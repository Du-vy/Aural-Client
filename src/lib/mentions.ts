/**
 * Mentions: the `@name` in a message, and the picker that writes one.
 *
 * The protocol has no mention of its own — a message is text, and text is all
 * the server stores — so a mention here is a convention over the words rather
 * than a field beside them. The rest follows from that. A mention is written
 * as the name it names; it is resolved against whoever this client knows at
 * the moment it is drawn, which is why renaming somebody renames them
 * throughout the history; and it renders as a mention only when it resolves.
 * An `@` in front of a name nobody answers to stays the characters somebody
 * typed, because pretending otherwise would be the client inventing a person.
 */

import type { Role, User } from "./protocol";

/** The two keyword mentions: everybody, and everybody who is here. */
export const EVERYONE = "everyone";
export const HERE = "here";

/** How many suggestions the picker offers at once. */
export const MENTION_SUGGESTIONS = 8;

/** The longest `@…` still taken for somebody being named rather than prose. */
export const MAX_MENTION_QUERY = 32;

/**
 * A character that continues a word.
 *
 * It decides both ends of a mention: an `@` straight after one belongs to
 * something else, which is what keeps an email address out of this, and a name
 * that runs into one is a longer name — `@Pablonia` is not `@Pablo`.
 */
const WORDISH = /[\p{L}\p{N}_-]/u;

export type MentionKind = "user" | "role" | "keyword";

/** Somebody, or something, that can be named. */
export interface MentionTarget {
  kind: MentionKind;
  /** The user or role id. 0 for a keyword, which names no record. */
  id: number;
  /** What is written after the `@`, and what is drawn in place of it. */
  name: string;
  /** A second spelling of the same target: an account's username. */
  alias: string | null;
  /** The role's colour, when it sets one. */
  color: string | null;
  /** The live record, so a picker can draw a face and a presence. */
  user: User | null;
}

/**
 * Everyone who can be named, indexed by every spelling they answer to.
 *
 * The index is built once per change to the member list rather than once per
 * message, because every message in the window is resolved against it on every
 * render.
 */
export interface MentionDirectory {
  /** Every target, in the order a picker offers them before ranking. */
  targets: readonly MentionTarget[];
  /** Each lowercased spelling, to what it names. */
  byName: ReadonlyMap<string, MentionTarget>;
  /** The longest spelling held, which bounds how far a match looks ahead. */
  longest: number;
}

/** A directory that resolves nothing, for a view with no server behind it. */
export const EMPTY_MENTIONS: MentionDirectory = {
  targets: [],
  byName: new Map(),
  longest: 0,
};

/** Where a `@…` is being typed, and what has been typed of it so far. */
export interface MentionQuery {
  /** Index of the `@` itself. */
  start: number;
  /** The caret, which is where the name being typed ends. */
  end: number;
  /** What was typed after the `@`, which may be empty. */
  query: string;
}

/**
 * Indexes everyone who may be named on a server.
 *
 * Keywords are offered to everybody, because the server has no permission for
 * them to be checked against: what `@everyone` does here is light a badge on
 * the clients that see it, and the client cannot honestly claim more authority
 * over that than the person typing already has.
 */
export function buildMentions(
  users: ReadonlyMap<number, User>,
  roles: ReadonlyMap<number, Role>,
  keywords = true,
): MentionDirectory {
  const targets: MentionTarget[] = [];

  for (const user of users.values()) {
    targets.push({
      kind: "user",
      id: user.id,
      name: user.nickname,
      alias: user.username,
      color: null,
      user,
    });
  }

  for (const role of roles.values()) {
    // The managed everyone role is the `@everyone` keyword under another name,
    // and offering both would be offering one thing twice.
    if (role.managed === "everyone") continue;
    targets.push({
      kind: "role",
      id: role.id,
      name: role.name,
      alias: null,
      color: role.color || null,
      user: null,
    });
  }

  if (keywords) {
    for (const name of [EVERYONE, HERE]) {
      targets.push({ kind: "keyword", id: 0, name, alias: null, color: null, user: null });
    }
  }

  const byName = new Map<string, MentionTarget>();
  let longest = 0;
  for (const target of targets) {
    for (const spelling of [target.name, target.alias]) {
      if (!spelling) continue;
      const key = spelling.toLowerCase();
      // A person wins a name a role also answers to. The clash is rare, and
      // resolving it towards the person is the guess that is wrong less often.
      if (!byName.has(key) || target.kind === "user") byName.set(key, target);
      if (key.length > longest) longest = key.length;
    }
  }

  return { targets, byName, longest };
}

export type MentionToken =
  | { type: "text"; value: string }
  | { type: "mention"; value: string; target: MentionTarget };

/**
 * Reads the name starting at `from`, longest first.
 *
 * Longest first is what lets a nickname hold a space: where both a person and
 * the first word of their name could be meant, the longer one is the one that
 * was actually written.
 */
function matchName(
  text: string,
  from: number,
  directory: MentionDirectory,
): { target: MentionTarget; length: number } | null {
  const reach = Math.min(directory.longest, text.length - from);
  for (let length = reach; length > 0; length -= 1) {
    const after = text[from + length];
    if (after !== undefined && WORDISH.test(after)) continue;
    const target = directory.byName.get(text.slice(from, from + length).toLowerCase());
    if (target) return { target, length };
  }
  return null;
}

/** Splits text into what it says and who it names. */
export function splitMentions(text: string, directory: MentionDirectory): MentionToken[] {
  if (text === "") return [];
  if (directory.longest === 0 || !text.includes("@")) return [{ type: "text", value: text }];

  const tokens: MentionToken[] = [];
  let plain = "";
  let at = 0;

  const flush = () => {
    if (plain) {
      tokens.push({ type: "text", value: plain });
      plain = "";
    }
  };

  while (at < text.length) {
    const opens = text[at] === "@" && (at === 0 || !WORDISH.test(text[at - 1]!));
    const found = opens ? matchName(text, at + 1, directory) : null;
    if (!found) {
      plain += text[at];
      at += 1;
      continue;
    }
    flush();
    // The canonical name is drawn rather than what was typed, so a lowercased
    // nickname and the username behind it both read as the person they reached.
    tokens.push({ type: "mention", value: `@${found.target.name}`, target: found.target });
    at += 1 + found.length;
  }

  flush();
  return tokens;
}

/** Every spelling that reaches one user: their names, their roles, the keywords. */
function spellingsOf(self: User, roles?: ReadonlyMap<number, Role>): string[] {
  const spellings = [self.nickname, self.username, EVERYONE, HERE].filter(
    (name): name is string => typeof name === "string" && name.length > 0,
  );
  if (roles) {
    for (const id of self.roles) {
      const role = roles.get(id);
      // The everyone role is `@everyone`, which is already in the list above.
      if (role && role.managed !== "everyone" && role.name) spellings.push(role.name);
    }
  }
  return spellings;
}

/**
 * Whether a message names this user.
 *
 * This is what an unread badge is decided by, so it runs on every message that
 * arrives and holds no directory of its own: only the handful of spellings
 * that reach one person. It is generous about case and mean about substrings,
 * because a badge that lights up for somebody else's name is worse than one
 * that misses.
 */
export function mentionsSelf(
  content: string,
  self: User | null,
  roles?: ReadonlyMap<number, Role>,
): boolean {
  if (!self) return false;
  const text = content.toLowerCase();
  for (const spelling of spellingsOf(self, roles)) {
    const needle = `@${spelling.toLowerCase()}`;
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
      const before = at === 0 ? undefined : text[at - 1]!;
      if (before !== undefined && WORDISH.test(before)) continue;
      const after = text[at + needle.length];
      if (after === undefined || !WORDISH.test(after)) return true;
    }
  }
  return false;
}

/**
 * Finds the `@…` the caret is inside, if it is inside one.
 *
 * The query may hold spaces, because a nickname may, but a space the caret is
 * sitting on ends it: the name has been typed, or has just been chosen, and
 * either way somebody has finished naming and gone back to writing.
 *
 * Nothing here decides whether a picker is shown. A query that names nobody
 * ranks to nothing, which closes it on its own.
 */
export function findMentionQuery(value: string, caret: number): MentionQuery | null {
  const upto = value.slice(0, Math.max(0, Math.min(caret, value.length)));

  for (let at = upto.length - 1; at >= 0; at -= 1) {
    if (upto.length - at > MAX_MENTION_QUERY + 1) return null;
    const char = upto[at]!;
    if (char === "\n" || char === "\t") return null;
    if (char !== "@") continue;
    const before = at === 0 ? undefined : upto[at - 1]!;
    if (before !== undefined && WORDISH.test(before)) return null;
    const query = upto.slice(at + 1);
    // Two spaces is a sentence that happens to follow an `@`, not a name, and
    // a trailing one is a name already finished — including the one a pick
    // just wrote, which must not open the picker again on its own insertion.
    if (query.includes("  ") || query.endsWith(" ")) return null;
    return { start: at, end: upto.length, query };
  }
  return null;
}

/**
 * How well a target answers to what has been typed.
 *
 * Negative means it does not. The ladder is what somebody typing expects to
 * see: the name they are spelling out, then the one that contains it, then the
 * account behind it — with whoever is actually around lifted over whoever is
 * not, since a mention is usually addressed to somebody who can answer.
 */
function scoreMention(needle: string, target: MentionTarget): number {
  const presence = target.kind !== "user" ? 0 : target.user?.online ? 6 : 0;
  const kind = target.kind === "user" ? 2 : target.kind === "role" ? 1 : 0;
  if (needle === "") return presence + kind;

  const name = target.name.toLowerCase();
  const alias = target.alias?.toLowerCase() ?? "";

  let matched = -1;
  if (name.startsWith(needle)) matched = 100;
  else if (alias.startsWith(needle)) matched = 90;
  else if (name.includes(` ${needle}`)) matched = 70;
  else if (name.includes(needle)) matched = 50;
  else if (alias.includes(needle)) matched = 40;

  return matched < 0 ? -1 : matched + presence + kind;
}

/** The best few targets for what has been typed, in the order to offer them. */
export function rankMentions(
  query: string,
  directory: MentionDirectory,
  limit = MENTION_SUGGESTIONS,
): MentionTarget[] {
  const needle = query.trim().toLowerCase();
  const scored: Array<{ target: MentionTarget; score: number }> = [];

  for (const target of directory.targets) {
    if (!target.name) continue;
    const score = scoreMention(needle, target);
    if (score >= 0) scored.push({ target, score });
  }

  scored.sort((a, b) => b.score - a.score || a.target.name.localeCompare(b.target.name));
  return scored.slice(0, limit).map((entry) => entry.target);
}
