/**
 * Screen sharing: capturing a screen or a window, and deciding how it is
 * encoded.
 *
 * Everything about *where* the picture goes is the engine's; everything about
 * what the picture is — how large, how often, how compressed, and which codec
 * carries it — is here.
 *
 * The picker itself is deliberately not ours. `getDisplayMedia` opens the one
 * the platform already has, and that is the right answer rather than a
 * shortcut: on Windows it is the Chromium chooser inside WebView2, on Linux
 * the desktop portal, on macOS the system sheet. Each of them enumerates every
 * monitor separately and every open window by name, each of them is the dialog
 * the person is used to seeing when anything captures their screen, and none
 * of them can be talked into handing over a surface the operating system was
 * not willing to give. A picker of our own would be a worse list, in a window
 * that has no business being trusted with that decision.
 */

import type { ScreenConfig, VideoQuality } from "@/lib/protocol";

const PREFS_KEY = "aural.voice.screen";

/** Heights a share can be sent at, which is what a picker offers. */
export const SCREEN_HEIGHTS = [480, 720, 1080, 1440, 2160] as const;

/** Frame rates a share can be sent at. */
export const SCREEN_FRAMERATES = [15, 30, 60] as const;

/**
 * What the encoder is asked to protect when it cannot have everything.
 *
 * They are the two halves of the same trade and there is no third answer. A
 * spreadsheet, a terminal or a diagram is unreadable the moment it is blurred
 * and perfectly fine at ten frames a second, so its resolution is kept and its
 * frame rate is spent. A game or a video is the other way round entirely.
 */
export type ScreenPriority = "detail" | "motion";

/**
 * Which codec a share is offered under.
 *
 * `auto` is the only value most people should ever have, and it is not a
 * refusal to choose: the right codec genuinely depends on what is being sent.
 * Up to 1080p30, VP9 wins outright — a shared screen is large flat areas and
 * text that does not move, which is what its screen-content tools are for, and
 * it stays legible at a bitrate where H.264 has already smeared. Past that,
 * software VP9 costs more CPU than the machine sharing usually has spare while
 * H.264 is encoded by the graphics card for nothing, and a stream that stutters
 * because the encoder cannot keep up is worse than one that is slightly softer.
 */
export type ScreenCodec = "auto" | "vp9" | "h264" | "vp8" | "av1";

export interface ScreenPreferences {
  height: number;
  framerate: number;
  /** Bits per second, or 0 to take whatever suits the size and rate chosen. */
  bitrate: number;
  /** Whether to try to carry the machine's own sound as well. */
  audio: boolean;
  priority: ScreenPriority;
  codec: ScreenCodec;
}

export const DEFAULT_SCREEN_PREFERENCES: ScreenPreferences = {
  height: 1080,
  framerate: 30,
  bitrate: 0,
  audio: true,
  priority: "detail",
  codec: "auto",
};

/**
 * What a share of a given size and rate is worth spending.
 *
 * The numbers are the ones the shape of the problem gives: a screen is mostly
 * still, so it costs far less than video of the same size, right up until
 * somebody plays something full screen, at which point it costs rather more
 * than the average suggests. These sit where a still picture is untouched and
 * a moving one is merely soft, which is the correct side to err on — a bitrate
 * too low is visible every second, a bitrate too high is only visible on the
 * one evening somebody's connection is already struggling.
 */
const BITRATE_LADDER: Record<number, number> = {
  480: 800_000,
  720: 1_500_000,
  1080: 2_500_000,
  1440: 5_000_000,
  2160: 10_000_000,
};

/** The bitrate a height and frame rate suggest, in bits per second. */
export function suggestedBitrate(height: number, framerate: number): number {
  const nearest = [...SCREEN_HEIGHTS].reduce((best, candidate) =>
    Math.abs(candidate - height) < Math.abs(best - height) ? candidate : best,
  );
  const base = BITRATE_LADDER[nearest] ?? BITRATE_LADDER[1080]!;
  // Doubling the frame rate does not double the bits: consecutive frames are
  // more alike the closer together they are, so each one costs less to code.
  const scale = framerate <= 15 ? 0.7 : framerate <= 30 ? 1 : 1.6;
  return Math.round(base * scale);
}

/** The quality a set of preferences asks for, before any server has seen it. */
export function requestedQuality(prefs: ScreenPreferences): VideoQuality {
  return {
    height: prefs.height,
    framerate: prefs.framerate,
    bitrate: prefs.bitrate > 0 ? prefs.bitrate : suggestedBitrate(prefs.height, prefs.framerate),
  };
}

/**
 * Holds a quality inside what the server will carry.
 *
 * The ceilings only bind when the server said they do, which is exactly when
 * it is the server carrying the picture. In `client_host` mode the stream
 * never touches it, so its opinion about how large a stream may be is an
 * opinion about somebody else's bandwidth and is not applied — the server says
 * so itself, in `enforced`, rather than either end deciding for itself and the
 * two of them drifting apart on what the rule was.
 */
export function clampQuality(quality: VideoQuality, screen: ScreenConfig | undefined): VideoQuality {
  if (!screen?.enforced) return quality;
  return {
    height: Math.min(quality.height, screen.maxHeight),
    framerate: Math.min(quality.framerate, screen.maxFramerate),
    bitrate: Math.min(quality.bitrate, screen.maxBitrate),
  };
}

/** The heights a server will accept, for a picker to offer. */
export function availableHeights(screen: ScreenConfig | undefined): number[] {
  const heights = [...SCREEN_HEIGHTS];
  if (!screen?.enforced) return heights;
  const allowed = heights.filter((height) => height <= screen.maxHeight);
  // A server whose ceiling is below the lowest rung still allows something:
  // that ceiling itself. Offering nothing would be a picker with no options.
  return allowed.length > 0 ? allowed : [screen.maxHeight];
}

/** The frame rates a server will accept. */
export function availableFramerates(screen: ScreenConfig | undefined): number[] {
  const rates = [...SCREEN_FRAMERATES];
  if (!screen?.enforced) return rates;
  const allowed = rates.filter((rate) => rate <= screen.maxFramerate);
  return allowed.length > 0 ? allowed : [screen.maxFramerate];
}

/** What a capture turned out to be, once the platform picker has answered. */
export interface ScreenCapture {
  stream: MediaStream;
  video: MediaStreamTrack;
  /** Present only when the platform gave sound with the picture. */
  audio: MediaStreamTrack | null;
  /** What was actually picked, which is not always what was asked for. */
  source: "screen" | "window";
}

/** Why a capture did not happen. */
export type ScreenFailure = "denied" | "unsupported" | "cancelled" | "unknown";

export class ScreenError extends Error {
  readonly reason: ScreenFailure;
  constructor(reason: ScreenFailure, message: string) {
    super(message);
    this.name = "ScreenError";
    this.reason = reason;
  }
}

/**
 * Opens the platform's own picker and captures what comes back.
 *
 * The quality asked for here is a hint and not a promise. A screen is captured
 * at whatever size it really is and scaled down towards the height wanted,
 * because the alternative — asking the platform for an exact size — is
 * answered by different platforms in different ways, one of which is refusing
 * outright. Constraining the track afterwards is the part that works
 * everywhere, and a share that came out slightly larger than asked for is
 * bounded by the bitrate anyway.
 */
export async function captureScreen(
  quality: VideoQuality,
  wantAudio: boolean,
): Promise<ScreenCapture> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new ScreenError("unsupported", "This platform cannot capture a screen.");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: quality.framerate, max: quality.framerate },
        height: { ideal: quality.height },
      },
      // Sound is asked for and never insisted on. Windows gives it for a whole
      // desktop and usually not for one window; Linux and macOS mostly give
      // none at all. A share with no sound is still a share, so an absent
      // audio track is not a failure.
      audio: wantAudio
        ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : false,
      ...({
        systemAudio: wantAudio ? "include" : "exclude",
        // Sharing the window this is running in shows a picture of itself
        // showing a picture of itself, which is a novelty for about a second.
        selfBrowserSurface: "exclude",
        // Letting somebody change which window they are sharing without
        // stopping is the single most requested thing about screen sharing.
        surfaceSwitching: "include",
        monitorTypeSurfaces: "include",
      } as Record<string, string>),
    });
  } catch (error) {
    throw new ScreenError(classify(error), messageOf(error));
  }

  const video = stream.getVideoTracks()[0];
  if (!video) {
    for (const track of stream.getTracks()) track.stop();
    throw new ScreenError("cancelled", "No screen was chosen.");
  }

  await constrain(video, quality);

  // "monitor" is a whole display, and on a machine with several the picker
  // named which one. Anything else is one window or one tab.
  const surface = (video.getSettings() as MediaTrackSettings & { displaySurface?: string })
    .displaySurface;

  return {
    stream,
    video,
    audio: stream.getAudioTracks()[0] ?? null,
    source: surface === "monitor" ? "screen" : "window",
  };
}

/**
 * Points a live capture at a different size or frame rate.
 *
 * Changing quality mid-share does not restart the capture: the picker is not
 * shown again, nothing flickers, and somebody who has been talking over a
 * shared screen for ten minutes does not have to find the right window again
 * because they turned the frame rate down.
 */
export async function constrain(track: MediaStreamTrack, quality: VideoQuality): Promise<void> {
  try {
    await track.applyConstraints({
      frameRate: { max: quality.framerate },
      height: { max: quality.height },
    });
  } catch {
    // Some platforms will not rescale a capture in place. The bitrate ceiling
    // still applies, and it is the half that decides what the connection
    // actually costs; the picture is merely larger than it needed to be.
  }
}

/**
 * Tells the encoder what this picture is, so it knows what to throw away.
 *
 * `contentHint` is the one knob here that is worth more than everything else
 * put together. Without it the encoder assumes a camera, and a camera is
 * neither of the two things anybody ever shares: text that must stay sharp
 * while it sits perfectly still, or a game that must stay smooth while every
 * pixel changes.
 */
export function hintContent(track: MediaStreamTrack, priority: ScreenPriority): void {
  const hinted = track as MediaStreamTrack & { contentHint?: string };
  hinted.contentHint = priority === "detail" ? "detail" : "motion";
}

/** The other half of that trade, applied to the sender rather than the track. */
export function degradationFor(priority: ScreenPriority): RTCDegradationPreference {
  return priority === "detail" ? "maintain-resolution" : "maintain-framerate";
}

/** The codec a preference and a quality resolve to. */
export function resolveCodec(prefs: ScreenPreferences, quality: VideoQuality): ScreenCodec {
  if (prefs.codec !== "auto") return prefs.codec;
  // Past 1080p30 the encoder, not the network, is what gives out first.
  return quality.framerate > 30 || quality.height > 1080 ? "h264" : "vp9";
}

/** The MIME types a codec choice maps to, most preferred first. */
function mimeTypesFor(codec: ScreenCodec): string[] {
  switch (codec) {
    case "vp9":
      return ["video/VP9"];
    case "h264":
      return ["video/H264"];
    case "vp8":
      return ["video/VP8"];
    case "av1":
      return ["video/AV1", "video/AV01"];
    default:
      return [];
  }
}

/**
 * Asks a transceiver to prefer one codec, and leaves the rest of the list
 * behind it untouched.
 *
 * Reordering rather than filtering is deliberate. A preference that removed
 * everything else would turn "this machine cannot encode AV1" into a share
 * that silently never starts, whereas a preference that only reorders
 * degrades into the next best thing both ends have.
 */
export function preferCodec(transceiver: RTCRtpTransceiver, codec: ScreenCodec): void {
  const wanted = mimeTypesFor(codec);
  if (wanted.length === 0 || typeof transceiver.setCodecPreferences !== "function") return;

  const capabilities = RTCRtpSender.getCapabilities?.("video");
  if (!capabilities?.codecs?.length) return;

  const matches = (entry: { mimeType: string }): boolean =>
    wanted.some((mime) => entry.mimeType.toLowerCase() === mime.toLowerCase());

  const preferred = capabilities.codecs.filter(matches);
  if (preferred.length === 0) return;

  try {
    transceiver.setCodecPreferences([
      ...preferred,
      ...capabilities.codecs.filter((entry) => !matches(entry)),
    ]);
  } catch {
    // A browser that will not take the list keeps the order it had, which is
    // its own preference and is not a wrong answer.
  }
}

// --- preferences -------------------------------------------------------------

/**
 * Reads the stored screen preferences, filling anything missing or nonsensical
 * from the defaults. Storage is not always there to read from, and it can hold
 * whatever an older version of this client wrote.
 */
export function readScreenPreferences(): ScreenPreferences {
  const prefs: ScreenPreferences = { ...DEFAULT_SCREEN_PREFERENCES };
  let stored: Partial<ScreenPreferences> | null = null;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    stored = raw ? (JSON.parse(raw) as Partial<ScreenPreferences>) : null;
  } catch {
    return prefs;
  }
  if (!stored) return prefs;

  if (typeof stored.height === "number" && stored.height > 0) {
    prefs.height = Math.min(Math.max(Math.round(stored.height), 144), 2160);
  }
  if (typeof stored.framerate === "number" && stored.framerate > 0) {
    prefs.framerate = Math.min(Math.max(Math.round(stored.framerate), 1), 120);
  }
  if (typeof stored.bitrate === "number" && stored.bitrate >= 0) {
    prefs.bitrate = Math.min(stored.bitrate, 40_000_000);
  }
  if (typeof stored.audio === "boolean") prefs.audio = stored.audio;
  if (stored.priority === "detail" || stored.priority === "motion") prefs.priority = stored.priority;
  if (
    stored.codec === "auto" ||
    stored.codec === "vp9" ||
    stored.codec === "h264" ||
    stored.codec === "vp8" ||
    stored.codec === "av1"
  ) {
    prefs.codec = stored.codec;
  }
  return prefs;
}

export function writeScreenPreferences(prefs: ScreenPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Losing these costs one person their choice of resolution on the next
    // start. It must not stop them sharing now.
  }
}

function classify(error: unknown): ScreenFailure {
  if (!(error instanceof Error)) return "unknown";
  switch (error.name) {
    case "NotAllowedError":
      // Both a refusal and a cancelled picker arrive as this, and the two are
      // not worth distinguishing: neither is a fault and neither needs saying
      // out loud, because the person who closed the picker knows they did.
      return "cancelled";
    case "NotFoundError":
    case "NotReadableError":
      return "denied";
    case "NotSupportedError":
    case "TypeError":
      return "unsupported";
    default:
      return "unknown";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
