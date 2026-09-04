/**
 * Generates the notification sounds in `public/sounds/`.
 *
 * The alternative to synthesizing them is downloading somebody's sample and
 * hoping its licence survives contact with an AGPL client. These are built
 * from oscillators and shaped noise, so they are ours, they are auditable as
 * the code that made them, and a new one is a recipe rather than a file.
 *
 *   node scripts/make-sounds.mjs
 *
 * The generated files are committed, so this is only run to change a sound or
 * add one. Adding one means a recipe here and an entry in
 * `src/lib/notificationSounds.ts`, which is what the settings list reads.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 44100;
const OUTPUT_DIR = fileURLToPath(new URL("../public/sounds/", import.meta.url));

/* --- Synthesis primitives --------------------------------------------------
 *
 * Everything below writes into a float buffer that is normalized once at the
 * end, so a recipe can add as many partials as it likes without having to
 * budget headroom between them.
 */

/** Exponential decay from 1 to silence, the envelope a struck thing has. */
function decay(t, tau) {
  return Math.exp(-t / tau);
}

/**
 * The first few milliseconds of every voice, ramped from zero.
 *
 * A partial that starts at full amplitude starts with a step, and a step is a
 * click. Three milliseconds is short enough to still read as a strike.
 */
function attack(t, seconds = 0.003) {
  return t >= seconds ? 1 : t / seconds;
}

/**
 * Adds one decaying sine partial.
 *
 * `bend` is a multiplier the frequency reaches by the end of the partial's
 * life, which is what turns a tone into a pop when it is well below 1.
 */
function partial(buffer, { freq, gain, tau, delay = 0, bend = 1, phase = 0 }) {
  const start = Math.round(delay * SAMPLE_RATE);
  let angle = phase;
  for (let i = start; i < buffer.length; i += 1) {
    const t = (i - start) / SAMPLE_RATE;
    // The break tests the decay alone: the attack is zero on the first
    // sample of every voice, and testing the product would end it there.
    const shape = decay(t, tau);
    if (shape < 1e-5) break;
    const envelope = shape * attack(t);
    // Integrating the swept frequency rather than evaluating sin(2π f(t) t)
    // keeps the phase continuous, which is the difference between a bend and
    // a buzz.
    const swept = freq * (bend === 1 ? 1 : bend ** (t / tau));
    angle += (2 * Math.PI * swept) / SAMPLE_RATE;
    buffer[i] += Math.sin(angle) * gain * envelope;
  }
}

/**
 * Adds a burst of lowpassed noise: the body a knock has and a sine does not.
 *
 * The filter is one pole, which is all that is needed to take the hiss off
 * white noise and leave something wooden behind.
 */
function noiseBurst(buffer, { gain, tau, delay = 0, cutoff = 1200, seed = 1 }) {
  const start = Math.round(delay * SAMPLE_RATE);
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
  let state = 0;
  // A small deterministic generator, so the committed files are reproducible.
  let rng = seed >>> 0 || 1;
  const random = () => {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    rng >>>= 0;
    return (rng / 0xffffffff) * 2 - 1;
  };
  for (let i = start; i < buffer.length; i += 1) {
    const t = (i - start) / SAMPLE_RATE;
    const shape = decay(t, tau);
    if (shape < 1e-5) break;
    const envelope = shape * attack(t, 0.001);
    state += alpha * (random() - state);
    buffer[i] += state * gain * envelope;
  }
}

/**
 * Peak-normalizes, trims the silence a fixed-length buffer leaves behind, and
 * fades the tail so no sound can end on a step.
 */
function finish(samples, peak = 0.82) {
  let loudest = 0;
  for (const sample of samples) loudest = Math.max(loudest, Math.abs(sample));
  const scale = loudest > 0 ? peak / loudest : 0;

  // Everything past the last audible sample is buffer the recipe asked for and
  // did not use, and it would be committed as silence.
  let end = samples.length;
  while (end > 1 && Math.abs(samples[end - 1]) * scale < 2e-4) end -= 1;
  const trimmed = samples.subarray(0, end);

  // Long enough to be inaudible as a fade, which matters because the bells
  // are still ringing at a few percent when their buffer runs out.
  const fade = Math.round(0.025 * SAMPLE_RATE);
  for (let i = 0; i < trimmed.length; i += 1) {
    const remaining = trimmed.length - i;
    const taper = remaining < fade ? remaining / fade : 1;
    trimmed[i] *= scale * taper;
  }
  return trimmed;
}

/** 16-bit mono PCM in a RIFF container: the format every engine can decode. */
function encodeWav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16); // PCM header length
  bytes.writeUInt16LE(1, 20); // PCM
  bytes.writeUInt16LE(1, 22); // mono
  bytes.writeUInt32LE(SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  bytes.writeUInt16LE(2, 32); // block align
  bytes.writeUInt16LE(16, 34); // bits per sample
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    bytes.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return bytes;
}

function buffer(seconds) {
  return new Float64Array(Math.round(seconds * SAMPLE_RATE));
}

/* --- The sounds ------------------------------------------------------------
 *
 * Five that are told apart across a room, rather than five variations on a
 * beep. Each one says what it is for in a comment, because "which one is
 * pop again" is the question this list exists to answer.
 */

const SOUNDS = {
  /** The default. A struck bell, two notes a fifth apart, warm and short. */
  chime() {
    const out = buffer(0.75);
    for (const [freq, delay] of [[659.25, 0], [987.77, 0.085]]) {
      partial(out, { freq, gain: 0.55, tau: 0.24, delay });
      partial(out, { freq: freq * 2.01, gain: 0.16, tau: 0.13, delay });
      partial(out, { freq: freq * 2.98, gain: 0.06, tau: 0.08, delay });
    }
    return out;
  },

  /** Minimal and clean: one note, no tail worth speaking of. */
  ping() {
    const out = buffer(0.45);
    partial(out, { freq: 880, gain: 0.6, tau: 0.11 });
    partial(out, { freq: 1760, gain: 0.14, tau: 0.06 });
    partial(out, { freq: 2640, gain: 0.04, tau: 0.035 });
    return out;
  },

  /** A blip. Almost no pitch, mostly the fact that something happened. */
  pop() {
    const out = buffer(0.18);
    partial(out, { freq: 520, gain: 0.7, tau: 0.035, bend: 0.42 });
    partial(out, { freq: 1040, gain: 0.12, tau: 0.02, bend: 0.42 });
    noiseBurst(out, { gain: 0.1, tau: 0.006, cutoff: 4200, seed: 0x51ed });
    return out;
  },

  /** Two soft wooden taps. The one to pick when a bell is too much. */
  knock() {
    const out = buffer(0.4);
    for (const delay of [0, 0.105]) {
      partial(out, { freq: 196, gain: 0.5, tau: 0.045, delay, bend: 0.7 });
      partial(out, { freq: 392, gain: 0.14, tau: 0.03, delay });
      noiseBurst(out, { gain: 0.3, tau: 0.018, delay, cutoff: 900, seed: 0xb1a5 });
    }
    return out;
  },

  /** Bright and long-tailed, for a mention that should carry over music. */
  glass() {
    const out = buffer(1.1);
    // Inharmonic ratios: a struck glass has no harmonic series, and using one
    // is what makes a synthesized bell sound like a synthesizer.
    for (const [ratio, gain, tau] of [
      [1, 0.5, 0.42],
      [2.76, 0.24, 0.3],
      [5.4, 0.11, 0.2],
      [8.93, 0.05, 0.12],
    ]) {
      partial(out, { freq: 1174.66 * ratio, gain, tau });
    }
    partial(out, { freq: 1567.98, gain: 0.18, tau: 0.34, delay: 0.13 });
    return out;
  },

  /** Connecting to a voice channel. A warm, ascending three-note major arpeggio with rich decay. */
  "voice-join"() {
    const out = buffer(0.7);
    const notes = [
      { freq: 587.33, delay: 0.0, gain: 0.5, tau: 0.22 },   // D5
      { freq: 739.99, delay: 0.08, gain: 0.55, tau: 0.24 }, // F#5
      { freq: 880.0, delay: 0.16, gain: 0.65, tau: 0.38 },  // A5
    ];
    for (const { freq, delay, gain, tau } of notes) {
      partial(out, { freq, gain, tau, delay });
      partial(out, { freq: freq * 2.005, gain: gain * 0.25, tau: tau * 0.65, delay });
      partial(out, { freq: freq * 2.99, gain: gain * 0.08, tau: tau * 0.45, delay });
      noiseBurst(out, { gain: 0.03, tau: 0.005, delay, cutoff: 3200, seed: Math.round(freq) });
    }
    return out;
  },

  /** Leaving a voice channel. A gentle, descending resolution tone. */
  "voice-leave"() {
    const out = buffer(0.65);
    const notes = [
      { freq: 880.0, delay: 0.0, gain: 0.55, tau: 0.2 },    // A5
      { freq: 659.25, delay: 0.08, gain: 0.5, tau: 0.22 },  // E5
      { freq: 587.33, delay: 0.16, gain: 0.6, tau: 0.36 },  // D5
    ];
    for (const { freq, delay, gain, tau } of notes) {
      partial(out, { freq, gain, tau, delay });
      partial(out, { freq: freq * 2.002, gain: gain * 0.22, tau: tau * 0.6, delay });
      partial(out, { freq: freq * 2.98, gain: gain * 0.07, tau: tau * 0.4, delay });
      noiseBurst(out, { gain: 0.025, tau: 0.005, delay, cutoff: 2800, seed: Math.round(freq) });
    }
    return out;
  },

  /** Another participant joined your voice channel. Discreet, warm upward chime. */
  "voice-user-join"() {
    const out = buffer(0.35);
    const notes = [
      { freq: 783.99, delay: 0.0, gain: 0.45, tau: 0.09 },   // G5
      { freq: 1046.5, delay: 0.065, gain: 0.55, tau: 0.18 }, // C6
    ];
    for (const { freq, delay, gain, tau } of notes) {
      partial(out, { freq, gain, tau, delay });
      partial(out, { freq: freq * 2.01, gain: gain * 0.2, tau: tau * 0.5, delay });
    }
    return out;
  },

  /** Another participant left your voice channel. Discreet, soft downward chime. */
  "voice-user-leave"() {
    const out = buffer(0.35);
    const notes = [
      { freq: 1046.5, delay: 0.0, gain: 0.45, tau: 0.09 },   // C6
      { freq: 783.99, delay: 0.065, gain: 0.55, tau: 0.18 }, // G5
    ];
    for (const { freq, delay, gain, tau } of notes) {
      partial(out, { freq, gain, tau, delay });
      partial(out, { freq: freq * 2.01, gain: gain * 0.2, tau: tau * 0.5, delay });
    }
    return out;
  },
};

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const [name, build] of Object.entries(SOUNDS)) {
  const wav = encodeWav(finish(build()));
  writeFileSync(join(OUTPUT_DIR, name + ".wav"), wav);
  console.log(`${name}.wav  ${(wav.length / 1024).toFixed(1)} KiB`);
}
