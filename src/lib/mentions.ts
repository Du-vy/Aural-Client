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
 *
 * There is a second spelling, `<@12>` and `<@&3>`, which names an id instead
 * of a name. It exists because that is what a Discord-shaped webhook posts,
 * and this server answers on Discord's own webhook path: a service already
 * written against that API changes one URL and its mentions keep working.
 * It is read but never written. The picker goes on inserting `@name`, so
 * nothing this client sends depends on a reader who understands the form,
 * and the raw text of a message stays something a person can read.
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
 * How many digits of `<@…>` are read before it stops being an id.
 *
 * Ids here are small, and Discord's snowflakes are twenty digits; twenty-four
 * is past both and still short enough that a wall of digits costs nothing.
 */
const MAX_MENTION_ID_DIGITS = 24;

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
  /**
   * Each `<@id>` and `<@&id>`, to what it names.
   *
   * Keyed by the whole body between the brackets, `&` and all, so a user and a
   * role that share an id stay two different keys.
   */
  byId: ReadonlyMap<string, MentionTarget>;
  /** The longest spelling held, which bounds how far a match looks ahead. */
  longest: number;
}

/** A directory that resolves nothing, for a view with no server behind it. */
export const EMPTY_MENTIONS: MentionDirectory = {
  targets: [],
  byName: new Map(),
  byId: new Map(),
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
 * How a target is keyed by id: `12` for a user, `&3` for a role.
 *
 * It is the text between the brackets of the mention itself, so writing a key
 * and reading one are the same operation spelled once.
 */
function idKey(kind: MentionKind, id: number): string {
  return kind === "role" ? `&${id}` : `${id}`;
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

  let everyoneRoleId: number | null = null;
  for (const role of roles.values()) {
    // The managed everyone role is the `@everyone` keyword under another name,
    // and offering both would be offering one thing twice. Its id is kept, so
    // a webhook naming it by id still reaches the keyword standing for it.
    if (role.managed === "everyone") {
      everyoneRoleId = role.id;
      continue;
    }
    targets.push({
      kind: "role",
      id: role.id,
      name: role.name,
      alias: null,
      color: role.color || null,
      user: null,
    });
  }

  const everyone: MentionTarget = {
    kind: "keyword",
    id: 0,
    name: EVERYONE,
    alias: null,
    color: null,
    user: null,
  };
  if (keywords) {
    targets.push(everyone);
    targets.push({ kind: "keyword", id: 0, name: HERE, alias: null, color: null, user: null });
  }

  const byName = new Map<string, MentionTarget>();
  const byId = new Map<string, MentionTarget>();
  let longest = 0;
  for (const target of targets) {
    // A keyword names no record, so there is no id that could reach it.
    if (target.kind !== "keyword") byId.set(idKey(target.kind, target.id), target);
    for (const spelling of [target.name, target.alias]) {
      if (!spelling) continue;
      const key = spelling.toLowerCase();
      // A person wins a name a role also answers to. The clash is rare, and
      // resolving it towards the person is the guess that is wrong less often.
      if (!byName.has(key) || target.kind === "user") byName.set(key, target);
      if (key.length > longest) longest = key.length;
    }
  }

  // `<@&1>` is the everyone role, which is drawn as the keyword that replaced
  // it. Without this the id would resolve to nothing while still lighting an
  // unread badge, and the two halves would disagree about the same message.
  if (everyoneRoleId !== null && keywords) byId.set(idKey("role", everyoneRoleId), everyone);

  return { targets, byName, byId, longest };
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

/**
 * Reads a `<@12>` or `<@&3>` starting at the `<`.
 *
 * The id is bounded so a long run of digits cannot be walked over on every
 * `<@` in a message, and it must be digits only: anything else between the
 * brackets is not this form, and is left to be read as the text it is.
 */
function matchId(
  text: string,
  from: number,
  directory: MentionDirectory,
): { target: MentionTarget; length: number } | null {
  if (text[from + 1] !== "@") return null;
  let at = from + 2;
  if (text[at] === "&") at += 1;
  const digits = at;
  while (at < text.length && at - digits < MAX_MENTION_ID_DIGITS && text[at]! >= "0" && text[at]! <= "9") {
    at += 1;
  }
  if (at === digits || text[at] !== ">") return null;
  const target = directory.byId.get(text.slice(from + 2, at));
  return target ? { target, length: at + 1 - from } : null;
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
    // An `<@id>` is looked for first. It cannot be confused with a name — the
    // two start on different characters — so the order is only about which
    // test is cheaper to fail.
    let found = text[at] === "<" ? matchId(text, at, directory) : null;
    let consumed = found?.length ?? 0;
    if (!found) {
      const opens = text[at] === "@" && (at === 0 || !WORDISH.test(text[at - 1]!));
      found = opens ? matchName(text, at + 1, directory) : null;
      consumed = found ? 1 + found.length : 0;
    }
    if (!found) {
      plain += text[at];
      at += 1;
      continue;
    }
    flush();
    // The canonical name is drawn rather than what was typed, so a lowercased
    // nickname, the username behind it and a bare id all read as the person
    // they reached.
    tokens.push({ type: "mention", value: `@${found.target.name}`, target: found.target });
    at += consumed;
  }

  flush();
  return tokens;
}

/**
 * How a message reached somebody.
 *
 * The three ways are kept apart because they are worth interrupting somebody
 * for by different amounts, and because that is exactly what a person muting a
 * busy channel is choosing between: their own name, a group they happen to be
 * in, and a word that means the whole room.
 */
export type MentionReach = "none" | "keyword" | "role" | "direct";

/** The spellings that name one person and nobody else. */
function directSpellings(self: User): string[] {
  return [self.nickname, self.username].filter(
    (name): name is string => typeof name === "string" && name.length > 0,
  );
}

/** The spellings that name a group this person is in. */
function roleSpellings(self: User, roles?: ReadonlyMap<number, Role>): string[] {
  const spellings: string[] = [];
  if (!roles) return spellings;
  for (const id of self.roles) {
    const role = roles.get(id);
    // The everyone role is `@everyone`, which is a keyword rather than a group.
    if (role && role.managed !== "everyone" && role.name) spellings.push(role.name);
  }
  return spellings;
}

/** Whether any of `spellings` is written as an `@…` in `text`, lowercased. */
function namesAny(text: string, spellings: readonly string[]): boolean {
  for (const spelling of spellings) {
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

/** Whether any of `ids` appears. The brackets are the boundary. */
function holdsAny(text: string, ids: readonly string[]): boolean {
  for (const id of ids) {
    if (text.includes(id)) return true;
  }
  return false;
}

/**
 * How far a message reaches towards this user: by name, by a role they hold,
 * by a word that means the room, or not at all.
 *
 * This is what an unread badge and every notification rule are decided by, so
 * it runs on every message that arrives and holds no directory of its own:
 * only the handful of spellings that reach one person. It is generous about
 * case and mean about substrings, because a badge that lights up for somebody
 * else's name is worse than one that misses.
 *
 * The strongest reach wins. A message that spells out a name and also says
 * `@everyone` was addressed to that person, and muting the keyword must not
 * take it away from them.
 */
export function mentionReach(
  content: string,
  self: User | null,
  roles?: ReadonlyMap<number, Role>,
): MentionReach {
  if (!self) return "none";
  const text = content.toLowerCase();

  if (namesAny(text, directSpellings(self)) || text.includes(`<@${self.id}>`)) return "direct";

  const roleIds: string[] = [];
  if (roles) {
    for (const id of self.roles) {
      // The everyone role is included here where it is left out of the
      // spellings: a webhook naming that role by its id means everyone by it,
      // and there is no `<@…>` for the keyword to have covered it already.
      if (roles.get(id)?.managed === "everyone") continue;
      if (roles.has(id)) roleIds.push(`<@&${id}>`);
    }
  }
  if (namesAny(text, roleSpellings(self, roles)) || holdsAny(text, roleIds)) return "role";

  if (namesAny(text, [EVERYONE, HERE])) return "keyword";
  if (roles) {
    for (const [id, role] of roles) {
      if (role.managed === "everyone" && text.includes(`<@&${id}>`)) return "keyword";
    }
  }
  return "none";
}

/** Whether a message names this user at all, by any of the three routes. */
export function mentionsSelf(
  content: string,
  self: User | null,
  roles?: ReadonlyMap<number, Role>,
): boolean {
  return mentionReach(content, self, roles) !== "none";
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
