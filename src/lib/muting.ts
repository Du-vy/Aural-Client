/**
 * Muting: what a person wants to be told about one server or one channel,
 * where that differs from what they want in general.
 *
 * The general answer lives in the notification settings and is one setting for
 * the whole client. This is the exceptions to it, and they are what makes a
 * busy server survivable: the announcements channel that names everybody twice
 * a day, the server somebody joined to read rather than to be in, the role
 * that is mentioned every time a game starts.
 *
 * Three things are kept per target, and they answer different questions:
 *
 *   - `scope` is which messages are worth a notification here at all. It
 *     inherits when unset, so a channel says nothing until it disagrees with
 *     its server, and a server says nothing until it disagrees with the
 *     client.
 *   - `mutedUntil` is silence with an end. It outranks `scope` entirely: a
 *     muted target raises nothing and lights no badge, whatever else says.
 *   - `suppressEveryone` and `suppressRoles` are about who a message reached
 *     rather than how many arrived. Somebody's own name still gets through
 *     both, because a message addressed to one person is not the same event as
 *     one addressed to a room they happen to be in.
 *
 * All of it is per device, in `localStorage`, and never reaches a server. It is
 * a statement about attention, which is a property of where somebody is
 * sitting rather than of who they are.
 */

import { useMemo, useSyncExternalStore } from "react";

import type { MentionReach } from "./mentions";
import { readNotifications, type NotificationScope, type NotificationSettings } from "./storage";

const KEY = "aural.muting.v1";

/** Forever, as an instant. Distinguishable from "muted until some time". */
export const MUTED_FOREVER = -1;

export interface NotificationOverride {
  /** Which messages notify here, or null to take the answer from above. */
  scope: NotificationScope | null;
  /**
   * When the silence lifts, in epoch milliseconds. `0` is not muted and
   * `MUTED_FOREVER` never lifts.
   */
  mutedUntil: number;
  /** Whether `@everyone` and `@here` stop notifying here. */
  suppressEveryone: boolean;
  /** Whether a mention of a role this person holds stops notifying here. */
  suppressRoles: boolean;
}

const NOTHING: NotificationOverride = {
  scope: null,
  mutedUntil: 0,
  suppressEveryone: false,
  suppressRoles: false,
};

/** Every override this client holds, keyed as below. */
type Overrides = Record<string, NotificationOverride>;

function serverKey(serverId: string): string {
  return `s:${serverId}`;
}

function channelKey(serverId: string, channelId: number): string {
  return `c:${serverId}:${channelId}`;
}

/**
 * Held in memory because every arriving message asks for it and the answer only
 * changes when this file changes it.
 */
let cache: Overrides | null = null;

function isScope(value: unknown): value is NotificationScope {
  return value === "all" || value === "mentions" || value === "none";
}

function parse(): Overrides {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const stored = JSON.parse(raw) as Record<string, Partial<NotificationOverride>>;
    const out: Overrides = {};
    for (const [key, value] of Object.entries(stored)) {
      if (!value || typeof value !== "object") continue;
      out[key] = {
        scope: isScope(value.scope) ? value.scope : null,
        mutedUntil:
          typeof value.mutedUntil === "number" && Number.isFinite(value.mutedUntil)
            ? value.mutedUntil
            : 0,
        suppressEveryone: value.suppressEveryone === true,
        suppressRoles: value.suppressRoles === true,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function all(): Overrides {
  cache ??= parse();
  return cache;
}

/**
 * A number that changes whenever anything here does.
 *
 * None of this lives in a store the interface already watches, so components
 * read this through `useSyncExternalStore` to be redrawn when an override
 * changes underneath them.
 */
let version = 0;
const listeners = new Set<() => void>();

export function mutingVersion(): number {
  return version;
}

export function onMutingChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * When the soonest timed mute lifts.
 *
 * A mute with an end is silence that stops on its own, and nothing writes when
 * it does. Without this the channel would stay dimmed and its badge dark until
 * something unrelated happened to redraw it.
 */
let expiry: ReturnType<typeof setTimeout> | null = null;

function armExpiry(overrides: Overrides): void {
  if (expiry !== null) clearTimeout(expiry);
  expiry = null;

  const now = Date.now();
  let soonest = Infinity;
  for (const override of Object.values(overrides)) {
    if (override.mutedUntil > now && override.mutedUntil < soonest) soonest = override.mutedUntil;
  }
  if (soonest === Infinity) return;
  expiry = setTimeout(() => {
    expiry = null;
    version += 1;
    for (const listener of listeners) listener();
    armExpiry(all());
  }, soonest - now);
}

function write(next: Overrides): void {
  cache = next;
  version += 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage is unavailable. The change still applies to this session.
  }
  armExpiry(next);
  for (const listener of listeners) listener();
}

/** What is stored against one server, or the empty override. */
export function serverOverride(serverId: string): NotificationOverride {
  return all()[serverKey(serverId)] ?? NOTHING;
}

/** What is stored against one channel, or the empty override. */
export function channelOverride(serverId: string, channelId: number): NotificationOverride {
  return all()[channelKey(serverId, channelId)] ?? NOTHING;
}

function patch(key: string, changes: Partial<NotificationOverride>): void {
  const next = { ...all() };
  const merged: NotificationOverride = { ...(next[key] ?? NOTHING), ...changes };
  // An override that says nothing is not kept: it is the absence of one, and
  // storing it would grow this by every channel anybody ever right-clicked.
  if (
    merged.scope === null &&
    merged.mutedUntil === 0 &&
    !merged.suppressEveryone &&
    !merged.suppressRoles
  ) {
    delete next[key];
  } else {
    next[key] = merged;
  }
  write(next);
}

export function setServerOverride(serverId: string, changes: Partial<NotificationOverride>): void {
  patch(serverKey(serverId), changes);
}

export function setChannelOverride(
  serverId: string,
  channelId: number,
  changes: Partial<NotificationOverride>,
): void {
  patch(channelKey(serverId, channelId), changes);
}

/** Drops every override for a server, which forgetting one should. */
export function forgetServerMuting(serverId: string): void {
  const prefix = `c:${serverId}:`;
  const next: Overrides = {};
  for (const [key, value] of Object.entries(all())) {
    if (key === serverKey(serverId) || key.startsWith(prefix)) continue;
    next[key] = value;
  }
  write(next);
}

/** Whether a mute is in force right now. */
export function muted(override: NotificationOverride, now = Date.now()): boolean {
  return override.mutedUntil === MUTED_FOREVER || override.mutedUntil > now;
}

/** Whether this server is silenced, which silences everything inside it. */
export function serverMuted(serverId: string, now = Date.now()): boolean {
  return muted(serverOverride(serverId), now);
}

/**
 * Whether this channel is silenced, by its own mute or by its server's.
 *
 * A muted server mutes its channels: somebody who silenced a whole server did
 * not mean "except the one channel I muted separately last week".
 */
export function channelMuted(serverId: string, channelId: number, now = Date.now()): boolean {
  return serverMuted(serverId, now) || muted(channelOverride(serverId, channelId), now);
}

/** Where one message landed, in the terms the rules above are written in. */
export interface NotificationTarget {
  serverId: string;
  /** Null for a private conversation, which belongs to no channel. */
  channelId: number | null;
  /** How far the message reached towards this user. */
  reach: MentionReach;
  /** Whether it was a private message, which has no channel to inherit from. */
  direct: boolean;
}

/**
 * Whether one arriving message clears the bar its channel, its server and the
 * client settings between them set.
 *
 * A private message answers to the client setting and to its server's mute, and
 * to nothing else: it has no channel, and the scope somebody set for a server's
 * channels is not a statement about people writing to them directly.
 */
export function shouldNotifyHere(
  target: NotificationTarget,
  settings: NotificationSettings = readNotifications(),
  now = Date.now(),
): boolean {
  const server = serverOverride(target.serverId);
  if (muted(server, now)) return false;

  if (target.direct) return settings.directMessages;

  const channel =
    target.channelId === null ? NOTHING : channelOverride(target.serverId, target.channelId);
  if (muted(channel, now)) return false;

  // Somebody's own name is not something the keyword and role switches speak
  // for: those are about being one of many, and this was addressed to one.
  if (target.reach === "keyword" && (channel.suppressEveryone || server.suppressEveryone)) {
    return false;
  }
  if (target.reach === "role" && (channel.suppressRoles || server.suppressRoles)) {
    return false;
  }

  const scope = channel.scope ?? server.scope ?? settings.scope;
  if (scope === "none") return false;
  if (scope === "mentions") return target.reach !== "none";
  return true;
}

/* --- Reading it from a component ------------------------------------------- */

/**
 * The overrides, as something React will redraw for.
 *
 * The snapshots are the stored objects themselves, which are replaced rather
 * than mutated, so an unchanged override is the same reference on every read
 * and nothing re-renders for a change somewhere else.
 */
function useMuting<T>(read: () => T): T {
  return useSyncExternalStore(onMutingChanged, read, read);
}

export function useServerOverride(serverId: string | null): NotificationOverride {
  return useMuting(() => (serverId === null ? NOTHING : serverOverride(serverId)));
}

export function useChannelOverride(
  serverId: string | null,
  channelId: number,
): NotificationOverride {
  return useMuting(() => (serverId === null ? NOTHING : channelOverride(serverId, channelId)));
}

/**
 * Which channels of a server are silenced, as one set.
 *
 * The sidebar draws every channel at once, and a hook per row would be a
 * subscription per row. The set is rebuilt only when an override changes,
 * which is the only thing that can change the answer.
 */
export function useMutedChannels(serverId: string | null): ReadonlySet<number> {
  const version = useSyncExternalStore(onMutingChanged, mutingVersion, mutingVersion);
  return useMemo(() => {
    const out = new Set<number>();
    if (serverId === null) return out;
    const prefix = `c:${serverId}:`;
    const now = Date.now();
    const everything = serverMuted(serverId, now);
    for (const [key, override] of Object.entries(all())) {
      if (!key.startsWith(prefix)) continue;
      if (everything || muted(override, now)) out.add(Number(key.slice(prefix.length)));
    }
    // A muted server silences channels that have no override of their own, and
    // those have no key here to be found by. The caller checks the server too.
    return out;
  }, [serverId, version]);
}
