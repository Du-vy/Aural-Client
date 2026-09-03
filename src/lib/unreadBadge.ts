/**
 * The unread count as the operating system sees it: the window title, the
 * taskbar or dock icon, and the badge a browser puts on an installed app.
 *
 * The rail already draws a badge per server. This is the same arithmetic
 * summed once more, over every connection rather than one, because the taskbar
 * has room for a single number and that number is "how much is waiting for me
 * anywhere".
 *
 * It runs as a subscription rather than a React effect: the connections come
 * and go, each one is its own store, and a component re-subscribing to all of
 * them on every render would be doing more work than the arithmetic.
 */

import { isTauri } from "@tauri-apps/api/core";

import { unreadTotals } from "@/store/selectors";
import { useServers } from "@/store/servers";

import { onNotificationsChanged, readNotifications } from "./storage";

/** The window title with nothing waiting. Matches `tauri.conf.json`. */
const BASE_TITLE = "Aural";

export interface UnreadSummary {
  /** Every unread message, across servers, channels and conversations. */
  count: number;
  /** How many of those named this user. Decides the colour of the badge. */
  mentions: number;
}

/** Adds up what every open connection is holding. */
export function totalUnread(): UnreadSummary {
  let count = 0;
  let mentions = 0;
  for (const store of useServers.getState().connections.values()) {
    const state = store.getState();
    const totals = unreadTotals(state.unread);
    count += totals.count;
    mentions += totals.mentions;
    for (const conversation of state.conversations.values()) {
      // A direct message is a mention by construction: it was addressed to
      // this person and to nobody else.
      count += conversation.unread;
      mentions += conversation.unread;
    }
  }
  return { count, mentions };
}

/* --- Drawing the Windows overlay ------------------------------------------- */

/**
 * Windows has no badge API. It has an overlay icon, which is a picture the
 * shell draws over the corner of the taskbar button, so the number has to be
 * rendered as one.
 */
const OVERLAY_SIZE = 32;

/** Keyed by what is drawn, because the same count is drawn over and over. */
const overlayCache = new Map<string, Uint8Array>();

function drawOverlay(label: string, colour: string): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = OVERLAY_SIZE;
    canvas.height = OVERLAY_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(null);
      return;
    }

    const centre = OVERLAY_SIZE / 2;
    ctx.beginPath();
    ctx.arc(centre, centre, centre - 1, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();

    if (label) {
      // Two digits is the most that stays legible once the shell has scaled
      // this down to sixteen pixels; past that the dot alone says "a lot".
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${label.length > 1 ? 17 : 21}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, centre, centre + 1);
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      void blob
        .arrayBuffer()
        .then((bytes) => resolve(new Uint8Array(bytes)))
        .catch(() => resolve(null));
    }, "image/png");
  });
}

async function overlayFor(summary: UnreadSummary): Promise<Uint8Array | null> {
  const label = summary.count > 99 ? "" : String(summary.count);
  // Mentions use danger red, general unreads use brand accent teal.
  const colour = summary.mentions > 0 ? "#e5534b" : "#12b8a0";
  const key = `${label}:${colour}`;

  const cached = overlayCache.get(key);
  if (cached) return cached;

  const drawn = await drawOverlay(label, colour);
  if (drawn) overlayCache.set(key, drawn);
  return drawn;
}

/* --- Applying it ----------------------------------------------------------- */

function onWindows(): boolean {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
}

/**
 * Puts the count on the icon.
 *
 * Three platforms, three mechanisms, none of which exists on the other two:
 * Windows draws an overlay image, macOS and Linux take a number, and a browser
 * has the badging API once the client has been installed. All of them are
 * best-effort — a badge that cannot be drawn is not worth surfacing as an
 * error, because the title still carries the count.
 */
async function applyIconBadge(summary: UnreadSummary): Promise<void> {
  const enabled = readNotifications().taskbarBadge;
  const count = enabled ? summary.count : 0;

  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      if (onWindows()) {
        const overlay = count > 0 ? await overlayFor(summary) : null;
        await window.setOverlayIcon(overlay ?? undefined);
      } else {
        await window.setBadgeCount(count > 0 ? count : undefined);
      }
    } catch {
      // An older shell, or a platform with neither. The title still says it.
    }
    return;
  }

  try {
    const badging = navigator as Navigator & {
      setAppBadge?(count?: number): Promise<void>;
      clearAppBadge?(): Promise<void>;
    };
    if (count > 0) await badging.setAppBadge?.(count);
    else await badging.clearAppBadge?.();
  } catch {
    // Not installed, or a browser without the badging API.
  }
}

function applyTitle(summary: UnreadSummary): void {
  if (typeof document === "undefined") return;
  // Unconditional, unlike the icon badge: a count in the title is the one
  // thing that works everywhere, including the taskbar tooltip on a build too
  // old for an overlay icon, and it is not what the badge setting turns off.
  document.title = summary.count > 0 ? `(${summary.count}) ${BASE_TITLE}` : BASE_TITLE;
}

/**
 * Starts keeping the title and the icon in step with what is unread.
 *
 * Returns the function that stops it, so a caller mounting this in an effect
 * unsubscribes from the connections as well as from the registry.
 */
export function startUnreadBadgeSync(): () => void {
  /** Per-connection unsubscribes, keyed the way the registry keys them. */
  const watched = new Map<string, () => void>();
  let last = "";
  let scheduled = false;

  const apply = () => {
    scheduled = false;
    const summary = totalUnread();
    // Most store writes change neither number — a message in a channel that is
    // already unread, somebody going idle — and re-encoding an overlay icon
    // for an unchanged count is work with no result.
    const signature = `${summary.count}:${summary.mentions}`;
    if (signature === last) return;
    last = signature;
    applyTitle(summary);
    void applyIconBadge(summary);
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

  const stopRegistry = useServers.subscribe(reconcile);
  // Turning the badge off has to rub out what was drawn and turning it back on
  // has to draw it again. Neither changes the count, so neither would be
  // noticed by the subscriptions above.
  const stopSettings = onNotificationsChanged(() => {
    last = "";
    schedule();
  });
  reconcile();

  return () => {
    stopRegistry();
    stopSettings();
    for (const unsubscribe of watched.values()) unsubscribe();
    watched.clear();
  };
}
