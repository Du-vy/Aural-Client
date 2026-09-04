/**
 * Away by itself: showing somebody as idle once they have stopped using the
 * client, and putting them back when they come back.
 *
 * What counts as "using the client" is activity in this window — a key, a
 * pointer, a scroll, the window being focused. There is no system-wide idle
 * signal available to a webview, so somebody working in another application
 * with Aural open behind it does go away, which is the same answer every other
 * chat client gives and the one people expect from the marker.
 *
 * Only a status of `online` is ever changed. Away is a guess about somebody who
 * has said nothing; do-not-disturb, invisible and a manually chosen idle are
 * all statements they made on purpose, and a guess does not overrule one. For
 * the same reason coming back only restores the servers this changed.
 *
 * The guess is written down, in `readAutoAway`, rather than only remembered.
 * The status lives on the server, so it outlasts the connection that set it: a
 * client that quits or drops while away signs back in still away, and the note
 * on disk is the only thing that knows to take it back.
 */

import {
  onPresenceChanged,
  readAutoAway,
  readPresence,
  writeAutoAway,
  type PresenceSettings,
} from "./storage";
import { useServers } from "@/store/servers";

/** The events that mean somebody is still there. */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "focus",
] as const;

/**
 * How long activity is ignored after the last time it was noticed.
 *
 * A pointer moving across the window fires hundreds of events a second and
 * every one of them would otherwise reset a timer and read the whole registry.
 */
const ACTIVITY_THROTTLE_MS = 1_000;

/** Which connections were put away by this rather than by their owner. */
const auto = new Set<string>();

/**
 * Connections a status is being written to.
 *
 * A status set here is not on the connection until the server has said so, so
 * for one round trip `self` still reads whatever it read before. Waiting for
 * the answer rather than trusting what is on hand is what keeps somebody who
 * comes back during that trip from being left away for good: the check that
 * would have taken the marker back sees `online`, decides there is nothing to
 * undo, and the `idle` lands a moment later with nobody left to notice.
 */
const writing = new Set<string>();

/** Whether the person is currently taken to have stopped using the client. */
let away = false;

function mark(serverId: string): void {
  if (auto.has(serverId)) return;
  auto.add(serverId);
  writeAutoAway([...auto]);
}

function unmark(serverId: string): void {
  if (!auto.delete(serverId)) return;
  writeAutoAway([...auto]);
}

function setStatusOn(serverId: string, status: "online" | "idle"): void {
  const store = useServers.getState().connections.get(serverId);
  if (!store) return;
  writing.add(serverId);
  void store.getState().setStatus(status).then(
    () => {
      writing.delete(serverId);
      // The answer is in, so `self` now carries the new status. This is where a
      // guess that was taken back while it was still in flight gets noticed.
      settle();
    },
    () => {
      // A connection that dropped between deciding and saying. The marker
      // stands: reconnecting is what retries it, and until then the status is
      // whatever the server has.
      writing.delete(serverId);
    },
  );
}

function goAway(): void {
  for (const [serverId, store] of useServers.getState().connections) {
    const self = store.getState().self;
    if (!self || (self.status ?? "online") !== "online") continue;
    mark(serverId);
    setStatusOn(serverId, "idle");
  }
}

/**
 * Takes back every guess still standing, now that somebody is here.
 *
 * What decides each one is the status the connection reports, not the status
 * that was asked for: chosen by hand in the meantime, it stands and the marker
 * is dropped; still `idle`, it was ours and goes back to `online`; not
 * connected, the marker waits for the connection to come back, which is how a
 * client that quit while away puts itself right on the next sign-in.
 */
function settle(): void {
  if (away || auto.size === 0) return;
  const { connections } = useServers.getState();
  for (const serverId of [...auto]) {
    if (writing.has(serverId)) continue;
    const self = connections.get(serverId)?.getState().self;
    if (!self) continue;
    if ((self.status ?? "online") === "idle") {
      setStatusOn(serverId, "online");
      continue;
    }
    unmark(serverId);
  }
}

/**
 * Starts watching, and returns the way to stop.
 *
 * Called once for the life of the client: the connections it acts on come and
 * go underneath it, and a watcher that were mounted per connection would race
 * the others over one person's status.
 */
export function startIdleWatch(): () => void {
  // What a previous session wrote down before it stopped, read at the moment
  // this one starts caring about it rather than when the module loaded. Added
  // to rather than replacing: a watcher restarted mid-session still holds the
  // markers made since it began.
  for (const serverId of readAutoAway()) auto.add(serverId);

  let settings: PresenceSettings = readPresence();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSeen = 0;

  function arm(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!settings.autoAway) return;
    timer = setTimeout(() => {
      away = true;
      goAway();
    }, settings.autoAwayMinutes * 60_000);
  }

  function active(): void {
    const now = Date.now();
    if (!away && now - lastSeen < ACTIVITY_THROTTLE_MS) return;
    lastSeen = now;
    if (away) {
      away = false;
      settle();
    }
    arm();
  }

  /** Per-connection unsubscribes, keyed the way the registry keys them. */
  const watched = new Map<string, () => void>();
  let scheduled = false;

  /**
   * What a connection changing means, which is one of two things.
   *
   * Signing in while everybody is away has to be shown away as well, or the
   * server just opened would be the one place this person looks present.
   * Signing in while they are here is the other half: a marker left over from a
   * session that ended away is taken back the moment there is a connection to
   * take it back on.
   */
  const apply = () => {
    scheduled = false;
    if (away) goAway();
    else settle();
  };

  /** Coalesces the burst of store writes one arriving message causes. */
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(apply);
  };

  const reconcile = () => {
    const { connections } = useServers.getState();
    for (const [id, store] of connections) {
      if (!watched.has(id)) watched.set(id, store.subscribe(schedule));
    }
    for (const [id, unsubscribe] of watched) {
      if (!connections.has(id)) {
        unsubscribe();
        watched.delete(id);
      }
    }
    schedule();
  };

  for (const event of ACTIVITY_EVENTS) {
    window.addEventListener(event, active, { passive: true, capture: true });
  }
  // A window that is hidden is not being used, whatever the pointer did last;
  // a window that comes back is being used before anything has been touched.
  const onVisibility = () => {
    if (document.visibilityState === "visible") active();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const offSettings = onPresenceChanged((next) => {
    settings = next;
    if (!next.autoAway && away) {
      away = false;
      settle();
    }
    arm();
  });

  const stopRegistry = useServers.subscribe(reconcile);

  arm();
  reconcile();

  return () => {
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, active, { capture: true });
    }
    document.removeEventListener("visibilitychange", onVisibility);
    offSettings();
    stopRegistry();
    for (const unsubscribe of watched.values()) unsubscribe();
    watched.clear();
    if (timer !== null) clearTimeout(timer);
    // The markers are deliberately left alone: they are what a client that
    // stops while away is remembered by, and clearing them here would throw
    // away the one record that could put the status right again.
    away = false;
  };
}
