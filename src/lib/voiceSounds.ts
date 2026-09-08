/**
 * Sound effects for voice channels: connecting, disconnecting, and participant updates.
 *
 * Audio assets in `public/sounds/` are synthesized by `scripts/make-sounds.mjs`.
 * Decoded AudioBuffers are cached for zero-latency playback. In the event an asset
 * cannot be retrieved, a live Web Audio synthesis fallback runs transparently.
 */

import { getAudioContext } from "./audioContext";
import { readAccessibility, readSoundPack, type SoundPackId } from "./storage";
import { readPreferences } from "./voice/settings";

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

/** 8-bit arcade style chimes */
function playRetroSound(type: VoiceSoundType, ctx: AudioContext, volume: number): void {
  try {
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.min(1, Math.max(0, volume)), now);
    masterGain.connect(ctx.destination);

    const playBit = (freq: number, delay: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, now + delay);

      gain.gain.setValueAtTime(0.35, now + delay);
      gain.gain.setValueAtTime(0.0001, now + delay + duration);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(now + delay);
      osc.stop(now + delay + duration + 0.01);
    };

    switch (type) {
      case "join":
        playBit(523.25, 0.0, 0.05); // C5
        playBit(659.25, 0.05, 0.05); // E5
        playBit(783.99, 0.1, 0.05); // G5
        playBit(1046.5, 0.15, 0.12); // C6
        break;
      case "leave":
        playBit(1046.5, 0.0, 0.05); // C6
        playBit(783.99, 0.05, 0.05); // G5
        playBit(659.25, 0.1, 0.05); // E5
        playBit(523.25, 0.15, 0.1); // C5
        break;
      case "user-join":
        playBit(880.0, 0.0, 0.04);
        playBit(1318.5, 0.045, 0.08);
        break;
      case "user-leave":
        playBit(1318.5, 0.0, 0.04);
        playBit(880.0, 0.045, 0.08);
        break;
    }
  } catch {}
}

/** Sci-fi futuristic frequency-swept synthesizers */
function playScifiSound(type: VoiceSoundType, ctx: AudioContext, volume: number): void {
  try {
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.min(1, Math.max(0, volume)), now);
    masterGain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";

    switch (type) {
      case "join":
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(1100, now + 0.22);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now);
        osc.stop(now + 0.3);
        break;
      case "leave":
        osc.frequency.setValueAtTime(1050, now);
        osc.frequency.exponentialRampToValueAtTime(260, now + 0.24);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now);
        osc.stop(now + 0.3);
        break;
      case "user-join":
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1600, now + 0.12);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.4, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.18);
        break;
      case "user-leave":
        osc.type = "sine";
        osc.frequency.setValueAtTime(1400, now);
        osc.frequency.exponentialRampToValueAtTime(650, now + 0.12);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.4, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.18);
        break;
    }

    osc.connect(gain);
    gain.connect(masterGain);
  } catch {}
}

/** Soft acoustic mellow sine chimes */
function playSoftSound(type: VoiceSoundType, ctx: AudioContext, volume: number): void {
  try {
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.min(1, Math.max(0, volume)), now);
    masterGain.connect(ctx.destination);

    const playSoft = (freq: number, delay: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + delay);

      gain.gain.setValueAtTime(0.001, now + delay);
      gain.gain.linearRampToValueAtTime(0.4, now + delay + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + duration);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(now + delay);
      osc.stop(now + delay + duration + 0.02);
    };

    switch (type) {
      case "join":
        playSoft(440.0, 0.0, 0.35); // A4
        playSoft(554.37, 0.07, 0.35); // C#5
        playSoft(659.25, 0.14, 0.45); // E5
        break;
      case "leave":
        playSoft(659.25, 0.0, 0.3); // E5
        playSoft(554.37, 0.07, 0.3); // C#5
        playSoft(440.0, 0.14, 0.4); // A4
        break;
      case "user-join":
        playSoft(740.0, 0.0, 0.18);
        playSoft(880.0, 0.08, 0.25);
        break;
      case "user-leave":
        playSoft(880.0, 0.0, 0.18);
        playSoft(740.0, 0.08, 0.25);
        break;
    }
  } catch {}
}

export interface PlayVoiceSoundOptions {
  /** Override preference checks (used by test buttons in settings). */
  force?: boolean;
  /** Volume between 0 and 1. Defaults to the listener's cue volume. */
  volume?: number;
  /** Specific sound pack override. Defaults to saved user setting. */
  soundPack?: SoundPackId;
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
  const { force = false, volume = readPreferences().cueVolume / 100, soundPack } = options;
  if (volume <= 0) return;

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

  const pack = soundPack || readSoundPack();

  if (pack === "retro") {
    playRetroSound(type, ctx, volume);
    return;
  }
  if (pack === "scifi") {
    playScifiSound(type, ctx, volume);
    return;
  }
  if (pack === "soft") {
    playSoftSound(type, ctx, volume);
    return;
  }

  // Default: load pre-rendered audio asset with procedural fallback
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
      playProceduralFallback(type, ctx, volume);
    }
  } else {
    playProceduralFallback(type, ctx, volume);
  }
}

