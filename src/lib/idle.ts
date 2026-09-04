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
 * the same reason coming back only restores the servers this changed, and only
 * while they still read `idle`: a status set by hand in the meantime stands.
 */

import { onPresenceChanged, readPresence, type PresenceSettings } from "./storage";
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

function setStatusOn(serverId: string, status: "online" | "idle"): void {
  const store = useServers.getState().connections.get(serverId);
  void store?.getState().setStatus(status).catch(() => {
    // A connection that dropped between deciding and saying. Its status is
    // whatever the server has, and reconnecting sends the current one anyway.
  });
}

function goAway(): void {
  for (const [serverId, store] of useServers.getState().connections) {
    const self = store.getState().self;
    if (!self || (self.status ?? "online") !== "online") continue;
    auto.add(serverId);
    setStatusOn(serverId, "idle");
  }
}

function comeBack(): void {
  if (auto.size === 0) return;
  const { connections } = useServers.getState();
  for (const serverId of auto) {
    const self = connections.get(serverId)?.getState().self;
    if (self?.status === "idle") setStatusOn(serverId, "online");
  }
  auto.clear();
}

/**
 * Starts watching, and returns the way to stop.
 *
 * Called once for the life of the client: the connections it acts on come and
 * go underneath it, and a watcher that were mounted per connection would race
 * the others over one person's status.
 */
export function startIdleWatch(): () => void {
  let settings: PresenceSettings = readPresence();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSeen = 0;
  let away = false;

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
      comeBack();
    }
    arm();
  }

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
      comeBack();
    }
    arm();
  });

  arm();

  return () => {
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, active, { capture: true });
    }
    document.removeEventListener("visibilitychange", onVisibility);
    offSettings();
    if (timer !== null) clearTimeout(timer);
    auto.clear();
  };
}
