/**
 * Sound effects for voice channels: connecting, disconnecting, and participant updates.
 *
 * Audio assets in `public/sounds/` are synthesized by `scripts/make-sounds.mjs`.
 * Decoded AudioBuffers are cached for zero-latency playback. In the event an asset
 * cannot be retrieved, a live Web Audio synthesis fallback runs transparently.
 */

import { getAudioContext } from "./audioContext";
import { readAccessibility } from "./storage";

export type VoiceSoundType = "join" | "leave" | "user-join" | "user-leave";

export const VOICE_SOUND_FILES: Record<VoiceSoundType, string> = {
  join: "voice-join.wav",
  leave: "voice-leave.wav",
  "user-join": "voice-user-join.wav",
  "user-leave": "voice-user-leave.wav",
};

const decodedBuffers = new Map<VoiceSoundType, AudioBuffer>();
const inFlightRequests = new Map<VoiceSoundType, Promise<AudioBuffer | null>>();
const lastPlayedTimes = new Map<VoiceSoundType, number>();

function soundUrl(file: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.endsWith("/") ? base : `${base}/`}sounds/${file}`;
}

async function loadBuffer(type: VoiceSoundType): Promise<AudioBuffer | null> {
  const cached = decodedBuffers.get(type);
  if (cached) return cached;

  const inFlight = inFlightRequests.get(type);
  if (inFlight) return inFlight;

  const ctx = getAudioContext();
  const file = VOICE_SOUND_FILES[type];
  if (!ctx || !file) return null;

  const request = (async () => {
    try {
      const response = await fetch(soundUrl(file));
      if (!response.ok) return null;
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      decodedBuffers.set(type, buffer);
      return buffer;
    } catch {
      return null;
    } finally {
      inFlightRequests.delete(type);
    }
  })();

  inFlightRequests.set(type, request);
  return request;
}

/** Preloads all voice sound effects into memory. */
export function preloadVoiceSounds(): void {
  for (const type of Object.keys(VOICE_SOUND_FILES) as VoiceSoundType[]) {
    void loadBuffer(type);
  }
}

/**
 * Procedural fallback synthesis using Web Audio oscillators in case external assets
 * are unavailable or haven't finished loading.
 */
function playProceduralFallback(type: VoiceSoundType, ctx: AudioContext, volume: number): void {
  try {
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.min(1, Math.max(0, volume)), now);
    masterGain.connect(ctx.destination);

    const playTone = (freq: number, delay: number, duration: number, peakGain: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + delay);

      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.linearRampToValueAtTime(peakGain, now + delay + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(now + delay);
      osc.stop(now + delay + duration + 0.02);
    };

    switch (type) {
      case "join":
        playTone(587.33, 0.0, 0.22, 0.5); // D5
        playTone(739.99, 0.08, 0.24, 0.55); // F#5
        playTone(880.0, 0.16, 0.38, 0.65); // A5
        break;
      case "leave":
        playTone(880.0, 0.0, 0.2, 0.55); // A5
        playTone(659.25, 0.08, 0.22, 0.5); // E5
        playTone(587.33, 0.16, 0.36, 0.6); // D5
        break;
      case "user-join":
        playTone(783.99, 0.0, 0.1, 0.45); // G5
        playTone(1046.5, 0.065, 0.2, 0.55); // C6
        break;
      case "user-leave":
        playTone(1046.5, 0.0, 0.1, 0.45); // C6
        playTone(783.99, 0.065, 0.2, 0.55); // G5
        break;
    }
  } catch {
    // Audio synthesis context unready or disallowed
  }
}

export interface PlayVoiceSoundOptions {
  /** Override preference checks (used by test buttons in settings). */
  force?: boolean;
  /** Volume between 0 and 1. Defaults to 0.6. */
  volume?: number;
}

/**
 * Plays a voice channel sound cue.
 *
 * Checks user accessibility preferences before playing unless `force` is true.
 * Throttles rapid duplicate triggers (< 150ms) to ensure smooth feedback.
 */
export async function playVoiceSound(
  type: VoiceSoundType,
  options: PlayVoiceSoundOptions = {},
): Promise<void> {
  const { force = false, volume = 0.6 } = options;

  if (!force) {
    const access = readAccessibility();
    if (type === "join" || type === "leave") {
      if (!access.voiceAudioCues) return;
    } else if (type === "user-join" || type === "user-leave") {
      if (!access.voiceParticipantCues) return;
    }
  }

  const nowMs = Date.now();
  const lastPlayed = lastPlayedTimes.get(type) ?? 0;
  if (nowMs - lastPlayed < 150) return;
  lastPlayedTimes.set(type, nowMs);

  const ctx = getAudioContext();
  if (!ctx) return;

  const buffer = await loadBuffer(type);
  if (buffer) {
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = Math.min(1, Math.max(0, volume));
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    } catch {
      // Buffer playback failed, attempt fallback
      playProceduralFallback(type, ctx, volume);
    }
  } else {
    // Fallback to real-time synthesis
    playProceduralFallback(type, ctx, volume);
  }
}
