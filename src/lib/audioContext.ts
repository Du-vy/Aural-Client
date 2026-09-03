/**
 * The one audio context the client plays through.
 *
 * Shared rather than one per caller: browsers cap how many a page may hold,
 * and a context unlocked by a gesture is unlocked for everything that goes
 * through it. It lives on its own so that the two things that make sound —
 * the synthesized microphone cues and the notification sounds — do not have
 * to import each other to share it.
 */

let audioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      audioCtx = new AudioCtx();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}
