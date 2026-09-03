import { getAudioContext } from "./audioContext";
import { readAccessibility } from "./storage";

/**
 * Synthesizes a soft, pleasant audio chime for mute / unmute states.
 * Zero external mp3/wav files required, zero latency, runs on the device.
 */
export function playChime(muted: boolean): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";

    if (muted) {
      // Descending tone for mute (440Hz -> 310Hz)
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(310, now + 0.1);
    } else {
      // Ascending tone for unmute (320Hz -> 520Hz)
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.1);
    }

    // Soft envelope to prevent clicks or harsh transients
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.13);
  } catch {
    // Audio playback not permitted or unavailable
  }
}

export function playMuteCue(muted: boolean): void {
  if (!readAccessibility().micAudioCues) return;
  playChime(muted);
}
