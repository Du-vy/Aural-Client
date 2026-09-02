/**
 * Voice preferences: everything about how audio behaves that is this person's
 * choice rather than the server's.
 *
 * They live in `localStorage` and never reach a server. A device id, an input
 * threshold and a per-person volume are properties of the machine somebody is
 * sitting at, not of their identity, and syncing them would only get them wrong
 * on the next machine.
 */

import type { VoiceConfig } from "@/lib/protocol";
import type { NoiseSuppression } from "./audio";

const PREFS_KEY = "aural.voice.prefs";
const VOLUMES_KEY = "aural.voice.volumes";

/** How a microphone is opened: by hearing speech, or by holding a key. */
export type InputMode = "activity" | "ptt";

export interface VoicePreferences {
  /** Empty means whatever the system calls the default. */
  inputDeviceId: string;
  outputDeviceId: string;
  /** Percentages. 100 is unity gain; above it is amplification. */
  inputVolume: number;
  outputVolume: number;
  mode: InputMode;
  /**
   * A `KeyboardEvent.code`, which is the physical key rather than the
   * character it produces: push-to-talk has to work the same on every layout.
   */
  pttKey: string;
  /** How long the microphone stays open after the key is let go. */
  pttReleaseMs: number;
  /**
   * The level speech has to reach, 0 to 100 on the same scale the meter draws.
   * It is only consulted in activity mode.
   */
  threshold: number;
  echoCancellation: boolean;
  noiseSuppression: NoiseSuppression;
  autoGainControl: boolean;
  /**
   * The bitrate to ask the encoder for, in bits per second. It is clamped into
   * whatever range the server allows every time a session opens, so a
   * preference set on a generous server does not break a session on a strict
   * one.
   */
  bitrate: number;
  /** Whether joining a channel starts muted. */
  joinMuted: boolean;
}

export const DEFAULT_PREFERENCES: VoicePreferences = {
  inputDeviceId: "",
  outputDeviceId: "",
  inputVolume: 100,
  outputVolume: 100,
  mode: "activity",
  pttKey: "KeyV",
  pttReleaseMs: 250,
  threshold: 22,
  echoCancellation: true,
  noiseSuppression: "standard",
  autoGainControl: true,
  bitrate: 64000,
  joinMuted: false,
};

/** Bounds every numeric preference is forced into before it is used. */
const LIMITS = {
  inputVolume: [0, 200],
  outputVolume: [0, 200],
  pttReleaseMs: [0, 2000],
  threshold: [0, 100],
  bitrate: [6000, 510000],
} as const;

export function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(value, low), high);
}

/**
 * Reads the stored preferences, filling anything missing or nonsensical from
 * the defaults.
 *
 * Storage is not always there to read from — a private window, cleared site
 * data, a browser set to refuse it — and it can hold whatever an older version
 * of this client wrote, so every field is checked rather than trusted.
 */
export function readPreferences(): VoicePreferences {
  const stored = readJSON<Partial<VoicePreferences>>(PREFS_KEY) ?? {};
  const prefs: VoicePreferences = { ...DEFAULT_PREFERENCES };

  if (typeof stored.inputDeviceId === "string") prefs.inputDeviceId = stored.inputDeviceId;
  if (typeof stored.outputDeviceId === "string") prefs.outputDeviceId = stored.outputDeviceId;
  if (stored.mode === "activity" || stored.mode === "ptt") prefs.mode = stored.mode;
  if (typeof stored.pttKey === "string" && stored.pttKey) prefs.pttKey = stored.pttKey;
  if (typeof stored.echoCancellation === "boolean") prefs.echoCancellation = stored.echoCancellation;
  // Until voice shipped a choice this was a plain on/off, and some clients
  // have that boolean on disk. On becomes the setting it always was, which is
  // the one now called standard; nobody is moved onto RNNoise by an upgrade.
  const suppression: unknown = stored.noiseSuppression;
  if (typeof suppression === "boolean") {
    prefs.noiseSuppression = suppression ? "standard" : "off";
  } else if (suppression === "off" || suppression === "standard" || suppression === "rnnoise") {
    prefs.noiseSuppression = suppression;
  }
  if (typeof stored.autoGainControl === "boolean") prefs.autoGainControl = stored.autoGainControl;
  if (typeof stored.joinMuted === "boolean") prefs.joinMuted = stored.joinMuted;

  for (const key of ["inputVolume", "outputVolume", "pttReleaseMs", "threshold", "bitrate"] as const) {
    const value = stored[key];
    if (typeof value === "number") {
      const [low, high] = LIMITS[key];
      prefs[key] = clamp(value, low, high);
    }
  }
  return prefs;
}

export function writePreferences(prefs: VoicePreferences): void {
  writeJSON(PREFS_KEY, prefs);
}

/**
 * Per-person output volumes, as percentages.
 *
 * They are keyed by server as well as by user, because an identity belongs to
 * one server: user 4 on one server and user 4 on another are two people, and
 * turning one of them down must not turn the other down too.
 */
export type UserVolumes = Record<string, number>;

function volumeKey(serverId: string, userId: number): string {
  return `${serverId}:${userId}`;
}

export function readUserVolumes(): UserVolumes {
  const stored = readJSON<UserVolumes>(VOLUMES_KEY) ?? {};
  const out: UserVolumes = {};
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === "number") out[key] = clamp(value, 0, 200);
  }
  return out;
}

export function userVolume(volumes: UserVolumes, serverId: string | null, userId: number): number {
  if (!serverId) return 100;
  return volumes[volumeKey(serverId, userId)] ?? 100;
}

/** Sets one person's volume and returns the whole map, ready to be stored. */
export function setUserVolume(
  volumes: UserVolumes,
  serverId: string,
  userId: number,
  volume: number,
): UserVolumes {
  const next = { ...volumes };
  const key = volumeKey(serverId, userId);
  if (volume === 100) {
    // The default is not worth a row: storing it would grow this map by one
    // entry for every person ever spoken to.
    delete next[key];
  } else {
    next[key] = clamp(volume, 0, 200);
  }
  writeJSON(VOLUMES_KEY, next);
  return next;
}

/**
 * The bitrate to actually ask for: this person's preference, held inside what
 * the server allows. A server that has not advertised an audio plane leaves
 * the preference alone.
 */
export function resolveBitrate(prefs: VoicePreferences, config: VoiceConfig | undefined): number {
  if (!config) return prefs.bitrate;
  return clamp(prefs.bitrate, config.minBitrate, config.maxBitrate);
}

/**
 * How a shortcut is written out. `KeyboardEvent.code` is what is stored,
 * because it is the physical key; this is the part a person reads.
 */
export function describeKey(code: string): string {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  if (code.startsWith("Arrow")) return code.slice(5);
  switch (code) {
    case "Space":
      return "Space";
    case "ControlLeft":
      return "Left Ctrl";
    case "ControlRight":
      return "Right Ctrl";
    case "ShiftLeft":
      return "Left Shift";
    case "ShiftRight":
      return "Right Shift";
    case "AltLeft":
      return "Left Alt";
    case "AltRight":
      return "Right Alt";
    default:
      return code;
  }
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A browser refusing storage costs this person their preferences on the
    // next start, and nothing else. It must not stop them talking now.
  }
}
