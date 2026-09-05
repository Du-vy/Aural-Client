/**
 * Reporting what somebody is doing outside Aural, to every server they are on.
 *
 * Two readers in the shell produce readings — the system's media session, and
 * the socket a game writes its rich presence to — and this decides what to do
 * with them. The decisions are all here rather than in the shell because they
 * are product decisions: which source wins, how often a server may be told,
 * what happens to a picture when somebody has asked for no pictures.
 *
 * Like the idle watcher next door, this is started once for the life of the
 * client rather than per connection. The connections come and go underneath
 * it, and a watcher mounted per connection would race the others over one
 * person's activity.
 */

import type { Activity } from "./protocol";
import {
  configureNativeActivity,
  nativeActivitySupported,
  onNativeActivity,
  onNativeRpc,
  readNativeActivity,
  type ActivitySource,
  type NativeActivityReport,
  type RpcReport,
} from "./nativeActivity";
import { onActivityChanged, readActivity, type ActivitySettings } from "./storage";
import { useServers } from "@/store/servers";

/**
 * How long a burst of readings is allowed to settle before a server hears
 * about it.
 *
 * A track change arrives as two or three readings in quick succession — the
 * title first, the artwork a moment later — and a game may report every second
 * it is open. None of that is worth a frame each.
 */
const SETTLE_MS = 2_000;

/**
 * The least time between two reports to one server.
 *
 * The server refills its allowance twice a second with a burst of eight, so
 * this sits comfortably under what it will accept even when something upstream
 * is changing constantly.
 */
const MIN_GAP_MS = 3_000;

/**
 * A clear waits far less. The server exempts one from its rate limit for the
 * same reason: the report that matters most is the one saying the music
 * stopped, and a member left listening to a track that ended is the worst
 * thing this feature can do.
 */
const CLEAR_SETTLE_MS = 400;

/** How long a server that refused a report is left alone. */
const BACKOFF_MS = 5_000;

/** The latest reading from each source, whether or not it is being used. */
const readings: Record<ActivitySource, Activity | null> = { media: null, games: null };

/** What each server has been told, as a signature. Empty means "nothing". */
const told = new Map<string, string>();
/** Servers with a report in flight, so two are never sent at once. */
const sending = new Set<string>();
/** Servers that refused, and when they may be tried again. */
const blocked = new Map<string, number>();

let settings: ActivitySettings = readActivity();
let native: NativeActivityReport | null = null;

const stateListeners = new Set<(report: NativeActivityReport | null) => void>();

/**
 * What the shell last said about this machine.
 *
 * The settings page reads this to draw the notice about the socket being held
 * elsewhere. It is null in a browser, and from a shell too old to answer.
 */
export function readNativeActivityState(): NativeActivityReport | null {
  return native;
}

/** Watches for the shell changing its mind — the socket freeing up, or being taken. */
export function onNativeActivityState(
  listener: (report: NativeActivityReport | null) => void,
): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

function publishState(next: NativeActivityReport | null): void {
  native = next;
  for (const listener of stateListeners) listener(next);
}

/**
 * What to report, given everything on hand and what the settings allow.
 *
 * A game outranks music: somebody playing something with a playlist on is
 * playing the game, and that is what the two lines under their name should
 * say.
 *
 * Exported because it is the whole of the product decision in this file and
 * the only part worth testing on its own — everything around it is scheduling
 * and bookkeeping.
 */
export function chooseActivity(
  sources: Record<ActivitySource, Activity | null>,
  allowed: ActivitySettings,
): Activity | null {
  if (!allowed.share) return null;
  const winner =
    (allowed.games ? sources.games : null) ?? (allowed.media ? sources.media : null);
  if (!winner) return null;
  if (allowed.artwork) return winner;
  // Dropping the pictures rather than the activity. Somebody on a metered
  // connection asked not to broadcast a cover, not to stop saying what they
  // are listening to.
  const { image: _image, icon: _icon, ...text } = winner;
  return text;
}

function chosen(): Activity | null {
  return chooseActivity(readings, settings);
}

/** A stable identity for a report, so an unchanged one is not sent twice. */
function signature(activity: Activity | null): string {
  return activity === null ? "" : JSON.stringify(activity);
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSentAt = 0;

/**
 * Arranges for `apply` to run, once, after things have settled.
 *
 * Both bounds matter. The first coalesces a burst into one report; the second
 * keeps a source that changes constantly from spending a server's whole
 * allowance, which would mean the report that finally mattered being refused.
 */
function schedule(): void {
  if (timer !== null) return;
  const clearing = chosen() === null;
  const settle = clearing ? CLEAR_SETTLE_MS : SETTLE_MS;
  const gap = clearing ? 0 : Math.max(0, MIN_GAP_MS - (Date.now() - lastSentAt));
  timer = setTimeout(() => {
    timer = null;
    apply();
  }, Math.max(settle, gap));
}

/** Brings every connected server up to date, and nothing else. */
function apply(): void {
  const activity = chosen();
  const want = signature(activity);
  const now = Date.now();

  for (const [serverId, store] of useServers.getState().connections) {
    const state = store.getState();
    // Not connected yet, or connected and not signed in: either way there is
    // nobody to tell. The moment that changes, the registry subscription
    // brings this round again.
    if (state.status !== "connected" || !state.self) continue;
    if (told.get(serverId) === want) continue;
    if (sending.has(serverId)) continue;

    const until = blocked.get(serverId);
    if (until !== undefined && until > now) continue;
    blocked.delete(serverId);

    sending.add(serverId);
    lastSentAt = now;
    void state.reportActivity(activity).then(
      () => {
        sending.delete(serverId);
        told.set(serverId, want);
        // What was wanted may have moved on while this was in flight.
        schedule();
      },
      () => {
        // Refused, or the connection went. Neither is worth telling anybody
        // about: this is a watcher on a timer, not something a person asked
        // for. It is left to be retried, after a pause so that a server which
        // is saying no is not asked again immediately.
        sending.delete(serverId);
        blocked.set(serverId, Date.now() + BACKOFF_MS);
      },
    );
  }
}

/**
 * Resets what a server is known to hold, which a fresh session is empty of.
 *
 * A connection that dropped and came back is a server that has forgotten: the
 * activity lived on the session that ended. Without this the client would
 * believe it had already said everything, and the member would sit there doing
 * nothing until their next track change.
 *
 * It is set to the empty signature rather than dropped, and the difference
 * matters on every connect: a server that has just been signed in to holds no
 * activity, so a client with nothing to report has nothing to say. Dropping it
 * would make "unknown" and "nothing" look different and send a clear to every
 * server on startup, for a feature most people will never turn on.
 */
function forget(serverId: string): void {
  told.set(serverId, "");
  blocked.delete(serverId);
}

/** Pushes the switches down to the shell, so a reader that is off does not run. */
function configure(): void {
  void configureNativeActivity({
    media: settings.share && settings.media,
    games: settings.share && settings.games,
    artwork: settings.artwork,
  });
}

/**
 * Starts watching, and returns the way to stop.
 *
 * Nothing is read until the settings say to: the shell starts both readers
 * dormant, and `configure` is what wakes them.
 */
export function startActivityWatch(): () => void {
  let stopped = false;
  const unlisteners: Array<() => void> = [];

  /** Adds a subscription that may still be pending when this is torn down. */
  const track = (pending: Promise<() => void>) => {
    void pending.then((unlisten) => {
      if (stopped) unlisten();
      else unlisteners.push(unlisten);
    });
  };

  if (nativeActivitySupported()) {
    void readNativeActivity().then((report) => {
      if (!stopped) publishState(report);
    });

    track(
      onNativeActivity((event) => {
        readings[event.source] = event.activity;
        schedule();
      }),
    );

    track(
      onNativeRpc((rpc: RpcReport) => {
        // The state of the socket is not a reading, so it changes nothing about
        // what is being reported. It exists so the settings page can say why
        // games are not showing up.
        publishState(native === null ? { mediaSupported: false, rpc } : { ...native, rpc });
      }),
    );
  }

  configure();

  const offSettings = onActivityChanged((next) => {
    settings = next;
    configure();
    if (!next.share) {
      // Nothing else may be believed about the readings while sharing is off,
      // and the clear has to go out whatever they say.
      readings.media = null;
      readings.games = null;
    }
    schedule();
  });
  unlisteners.push(offSettings);

  /**
   * Which connections are up, so that one coming back can be told again.
   *
   * The status is what is watched rather than the connection's existence: a
   * reconnect reuses the same entry in the registry, and the server on the
   * other side of it has forgotten everything the old session reported.
   */
  const statuses = new Map<string, string>();
  const watched = new Map<string, () => void>();
  let scheduled = false;

  const settle = () => {
    scheduled = false;
    const { connections } = useServers.getState();
    for (const [serverId, store] of connections) {
      const status = store.getState().status;
      const was = statuses.get(serverId);
      statuses.set(serverId, status);
      // Including the first sighting: a connection that was already up when
      // the watcher started is one this client has told nothing.
      if (was !== status && status === "connected") forget(serverId);
    }
    apply();
  };

  /** Coalesces the burst of store writes one arriving message causes. */
  const nudge = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(settle);
  };

  const reconcile = () => {
    const { connections } = useServers.getState();
    for (const [serverId, store] of connections) {
      if (!watched.has(serverId)) watched.set(serverId, store.subscribe(nudge));
    }
    for (const [serverId, unsubscribe] of watched) {
      if (!connections.has(serverId)) {
        unsubscribe();
        watched.delete(serverId);
        statuses.delete(serverId);
        told.delete(serverId);
        blocked.delete(serverId);
        sending.delete(serverId);
      }
    }
    nudge();
  };

  const stopRegistry = useServers.subscribe(reconcile);
  reconcile();

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    for (const unlisten of unlisteners) unlisten();
    unlisteners.length = 0;
    stopRegistry();
    for (const unsubscribe of watched.values()) unsubscribe();
    watched.clear();

    // Stopping the watcher must not leave somebody playing a game they closed
    // hours ago, so one last clear goes out — but only to the servers that
    // were actually told something. Everybody else already holds nothing, and
    // saying so would be a frame per connection for no change.
    const stale = [...told].filter(([, held]) => held !== "").map(([serverId]) => serverId);
    readings.media = null;
    readings.games = null;
    told.clear();
    blocked.clear();
    sending.clear();
    const { connections } = useServers.getState();
    for (const serverId of stale) {
      const state = connections.get(serverId)?.getState();
      if (state?.status === "connected" && state.self) {
        void state.reportActivity(null).catch(() => {
          // The connection is going anyway, and the activity goes with it.
        });
      }
    }
    void configureNativeActivity({ media: false, games: false, artwork: false });
  };
}
