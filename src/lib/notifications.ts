/**
 * Everything a message does once it has been decided it is worth interrupting
 * somebody: the toast, the sound, and the taskbar entry asking for attention.
 *
 * There are two ways to raise a toast and the client uses whichever it has.
 * In the desktop build it is the Tauri notification plugin, because a webview
 * cannot raise a system notification by itself. In a browser it is the
 * Notification API, which can, and which also gives a click to handle — the
 * desktop plugin's activation callback needs an action type registered per
 * platform, so a desktop toast is read rather than clicked for now.
 *
 * Nothing here decides *whether* to notify. That is `shouldNotify`, which the
 * connection asks before building a request, so a connection never pays for a
 * notification the settings have already ruled out.
 */

import { isTauri } from "@tauri-apps/api/core";

import { playNotificationSound } from "./notificationSounds";
import { readNotifications, type NotificationSettings } from "./storage";

/** What arrived, in the terms a toast is written in. */
export interface NotificationRequest {
  /** Who sent it, and where — this becomes the toast's heading. */
  title: string;
  /** The message text. Dropped when the preview setting is off. */
  body: string;
  /** Whether it named this user, which is what "mentions only" filters on. */
  mention: boolean;
  /**
   * Collapses repeats: a second notification with the same tag replaces the
   * first rather than stacking under it, so a busy channel is one toast.
   */
  tag: string;
  /** Brings the sender's channel to the front. Only wired up in a browser. */
  activate?(): void;
}

/**
 * Whether one arriving message clears the bar the settings set.
 *
 * `direct` is separate from `mention` because a direct message is addressed to
 * one person whether or not it spells their name, and the setting that says so
 * is its own.
 */
export function shouldNotify(
  { mention, direct }: { mention: boolean; direct: boolean },
  settings: NotificationSettings = readNotifications(),
): boolean {
  if (direct) return settings.directMessages;
  if (settings.scope === "none") return false;
  if (settings.scope === "mentions") return mention;
  return true;
}

/* --- Permission ------------------------------------------------------------ */

/**
 * The answer, once it is a real one.
 *
 * Only a settled yes or no is remembered. A browser asked outside a click can
 * answer neither — it leaves the permission at "default" and shows nothing —
 * and caching that as a no would mean a first run with the switch already on
 * never showing a toast again, however many messages arrive afterwards.
 */
let permission: Promise<boolean> | null = null;

/** Yes, no, or "still nobody has said" — which is not an answer to remember. */
function settled(answer: NotificationPermission): boolean | null {
  return answer === "default" ? null : answer === "granted";
}

async function ask(): Promise<boolean | null> {
  try {
    if (isTauri()) {
      const plugin = await import("@tauri-apps/plugin-notification");
      if (await plugin.isPermissionGranted()) return true;
      return settled(await plugin.requestPermission());
    }
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return settled(await Notification.requestPermission());
  } catch {
    // A webview without the plugin, or a browser that refuses to be asked
    // outside a user gesture. Neither is a settled answer.
    return null;
  }
}

export function requestNotificationPermission(): Promise<boolean> {
  permission ??= (async () => {
    const answer = await ask();
    if (answer === null) {
      permission = null;
      return false;
    }
    return answer;
  })();
  return permission;
}

/** Forgets the answer, so the next notification asks again. */
export function resetNotificationPermission(): void {
  permission = null;
}

/** Whether a system toast is possible here at all, before asking for it. */
export function desktopNotificationsSupported(): boolean {
  return isTauri() || (typeof Notification !== "undefined" && Notification.permission !== "denied");
}

/* --- Raising one ----------------------------------------------------------- */

/**
 * The last time a sound was played.
 *
 * Ten messages landing together is one event to the person hearing it, and ten
 * overlapping chimes is not a notification, it is a noise. The toasts still
 * collapse by tag; only the sound is rationed.
 */
let lastSoundAt = 0;
const SOUND_INTERVAL_MS = 1_500;

async function playSound(settings: NotificationSettings): Promise<void> {
  const now = Date.now();
  if (now - lastSoundAt < SOUND_INTERVAL_MS) return;
  lastSoundAt = now;
  await playNotificationSound(settings.sound, settings.soundVolume);
}

/**
 * Flashes the taskbar entry, which is the one signal that survives a window
 * buried behind three others without stealing focus from what is in front.
 */
async function askForAttention(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow, UserAttentionType } = await import("@tauri-apps/api/window");
    await getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
  } catch {
    // Not every platform has a taskbar to flash.
  }
}

/** When each tag last raised a toast, for the platforms that cannot replace one. */
const toastedAt = new Map<string, number>();
const TOAST_INTERVAL_MS = 10_000;

function claimToastSlot(tag: string): boolean {
  const now = Date.now();
  const previous = toastedAt.get(tag);
  if (previous !== undefined && now - previous < TOAST_INTERVAL_MS) return false;
  toastedAt.set(tag, now);
  // A client left open for a day would otherwise hold a row per channel it has
  // ever been notified about, none of which is worth keeping once it is stale.
  if (toastedAt.size > 64) {
    for (const [key, at] of toastedAt) {
      if (now - at >= TOAST_INTERVAL_MS) toastedAt.delete(key);
    }
  }
  return true;
}

async function showToast(
  request: NotificationRequest,
  settings: NotificationSettings,
): Promise<void> {
  if (!settings.desktop) return;
  // Somebody looking at the client does not need the operating system to
  // tell them about it: the rail badge is already in front of them, and a
  // toast over the window it is about is only in the way. The sound and the
  // badge still happen, which is what makes another channel noticeable.
  if (typeof document !== "undefined" && document.hasFocus()) return;
  if (!(await requestNotificationPermission())) return;

  const body = settings.preview ? request.body : "";
  try {
    if (isTauri()) {
      // The desktop toast has no tag to replace an earlier one by, so a busy
      // channel would leave a stack of them in the notification centre. One
      // per channel per burst is the same thing `tag` achieves in a browser,
      // reached the only way this side can reach it.
      if (!claimToastSlot(request.tag)) return;
      const plugin = await import("@tauri-apps/plugin-notification");
      plugin.sendNotification({
        title: request.title,
        body,
        // The plugin plays the system sound on top of ours otherwise, and two
        // sounds for one message is worse than either.
        silent: true,
      });
      return;
    }
    if (typeof Notification === "undefined") return;
    const toast = new Notification(request.title, {
      body,
      tag: request.tag,
      icon: `${import.meta.env.BASE_URL || "/"}icon.png`,
      silent: true,
    });
    toast.onclick = () => {
      window.focus();
      request.activate?.();
      toast.close();
    };
  } catch {
    // A toast that will not be shown is not worth an error anybody can act on.
  }
}

/**
 * Announces one message: sound, toast, and a taskbar that asks to be looked at.
 *
 * The three are independent on purpose — somebody who wants a sound and no
 * toast, or a toast and no sound, has said so in the settings — so one being
 * off or failing never takes the others with it.
 */
export function announce(request: NotificationRequest): void {
  const settings = readNotifications();
  void playSound(settings);
  void showToast(request, settings);
  if (request.mention && settings.flashOnMention) void askForAttention();
}
