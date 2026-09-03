/**
 * The soundboard: cutting a clip out of whatever file somebody picked, and
 * playing one back when the server says somebody pressed a button.
 *
 * ## Why the clip is re-encoded
 *
 * A clip goes to the server as WAV, whatever arrived here — an MP3, an OGG, a
 * three-minute song. The trimmer decodes it, takes the range that was chosen
 * and writes a fresh RIFF file.
 *
 * That is not about quality. It is what makes the server's length limit
 * enforceable: a WAV header states its own duration exactly, so the server
 * reads how long a clip runs rather than believing a number this client sent.
 * A clip is played at everybody in a channel at once, and its length is the
 * whole of how annoying that can be made, so it is not a limit to leave on the
 * honour system. The cost is size — ten seconds of mono 48 kHz audio is about
 * a megabyte — which is why the server's ceiling for a sound is generous where
 * its ceiling for a picture is not.
 *
 * ## Why playback is local
 *
 * A sound is not mixed into anybody's microphone. The server tells everybody in
 * the channel which clip was played, and each client fetches it and mixes it
 * into its own output. So it sounds the same to everybody, it works identically
 * whether the call is relayed by the server or by another participant, and
 * being deafened silences it exactly as it silences everything else.
 */

import { getAudioContext } from "./audioContext";

/** What the trimmer hands back, ready to upload. */
export interface TrimmedClip {
  /** A WAV file, named after whatever was picked. */
  file: File;
  /** How long it runs, which the picker shows before anything is sent. */
  durationMs: number;
}

/** A decoded file, which is what the trimmer draws and cuts from. */
export interface DecodedAudio {
  buffer: AudioBuffer;
  durationSeconds: number;
  /** A coarse envelope, one value per pixel column the waveform is drawn in. */
  peaks: number[];
}

/** How many columns the waveform is reduced to. Enough for a 600px strip. */
const WAVEFORM_COLUMNS = 600;

/**
 * Decodes a picked file so it can be drawn and cut.
 *
 * Decoding is what makes the trimmer possible at all, and it is also the check
 * that the file is audio: a picture renamed to `.mp3` fails here, before
 * anybody has chosen a range out of it.
 */
export async function decodeAudioFile(file: File): Promise<DecodedAudio> {
  const context = getAudioContext();
  if (!context) throw new Error("This browser cannot decode audio.");

  const bytes = await file.arrayBuffer();
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(bytes);
  } catch {
    throw new Error("That file could not be read as audio.");
  }
  return {
    buffer,
    durationSeconds: buffer.duration,
    peaks: envelope(buffer, WAVEFORM_COLUMNS),
  };
}

/**
 * Reduces a decoded file to one value per column of the waveform.
 *
 * The peak of each window rather than its average: an average of a loud but
 * balanced waveform is near zero, which would draw silence over the loudest
 * part of the clip.
 */
function envelope(buffer: AudioBuffer, columns: number): number[] {
  const channel = buffer.getChannelData(0);
  const perColumn = Math.max(1, Math.floor(channel.length / columns));
  const peaks: number[] = [];

  for (let column = 0; column < columns; column += 1) {
    const start = column * perColumn;
    let peak = 0;
    for (let i = start; i < start + perColumn && i < channel.length; i += 1) {
      const value = Math.abs(channel[i] ?? 0);
      if (value > peak) peak = value;
    }
    peaks.push(peak);
  }
  return peaks;
}

/**
 * Cuts `[startSeconds, endSeconds)` out of a decoded file and writes it as WAV.
 *
 * The result is mono at the source's own rate: a soundboard clip is an effect
 * rather than music, nobody is listening to it in stereo, and halving the
 * channels halves what has to be uploaded and stored.
 */
export function trimToWav(
  decoded: DecodedAudio,
  startSeconds: number,
  endSeconds: number,
  filename: string,
): TrimmedClip {
  const { buffer } = decoded;
  const rate = buffer.sampleRate;

  const from = Math.max(0, Math.floor(startSeconds * rate));
  const to = Math.min(buffer.length, Math.ceil(endSeconds * rate));
  const length = Math.max(1, to - from);

  // Mixed down rather than taking the first channel: a clip whose interesting
  // half was panned right would otherwise come out silent.
  const mono = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      mono[i] = (mono[i] ?? 0) + (data[from + i] ?? 0);
    }
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < length; i += 1) mono[i] = (mono[i] ?? 0) / buffer.numberOfChannels;
  }

  const wav = encodeWav(mono, rate);
  const name = wavName(filename);
  return {
    file: new File([wav], name, { type: "audio/wav" }),
    durationMs: Math.round((length / rate) * 1000),
  };
}

/** The name the clip is uploaded under, which the server only ever shows. */
function wavName(filename: string): string {
  const stem = filename.replace(/\.[^./\\]+$/, "").trim();
  return `${stem || "sound"}.wav`;
}

/**
 * Writes 16-bit PCM samples into a RIFF/WAVE file.
 *
 * The plainest possible variant — one `fmt ` chunk, one `data` chunk, no
 * metadata — because the server reads the header to enforce its length limit,
 * and the fewer shapes it has to walk past to find the data chunk the better.
 */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const out = new ArrayBuffer(44 + dataLength);
  const view = new DataView(out);

  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  ascii(8, "WAVE");

  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // chunk length
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  ascii(36, "data");
  view.setUint32(40, dataLength, true);

  for (let i = 0; i < samples.length; i += 1) {
    // Clamped before scaling: a decoded file can hold values outside [-1, 1],
    // and letting one wrap turns a loud clip into a burst of noise.
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * bytesPerSample, Math.round(value * 0x7fff), true);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Playback                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Clips already fetched, so pressing the same button twice does not fetch the
 * same file twice. Keyed by URL, which carries the storage key and is therefore
 * unique per clip and stable for its life.
 */
const decoded = new Map<string, Promise<AudioBuffer>>();

/** What is playing right now, so a clip can be stopped when a call ends. */
const playing = new Set<AudioBufferSourceNode>();

/**
 * Plays a clip.
 *
 * `volume` is the clip's own level, 0..100, so one recorded hot sits beside the
 * others without being re-cut. `gain` on top of it is the listener's: it is
 * where being deafened, or turning the soundboard down, is applied.
 */
export async function playSoundClip(url: string, volume: number, gain = 1): Promise<void> {
  const context = getAudioContext();
  if (!context || gain <= 0) return;

  let buffer: AudioBuffer;
  try {
    buffer = await fetchClip(context, url);
  } catch {
    // A clip that was deleted between the event and the fetch, or a server
    // that has gone. Nothing worth interrupting a call over.
    return;
  }

  const source = context.createBufferSource();
  source.buffer = buffer;

  const level = context.createGain();
  level.gain.value = Math.max(0, Math.min(1, volume / 100)) * Math.max(0, Math.min(1, gain));

  source.connect(level);
  level.connect(context.destination);

  playing.add(source);
  source.onended = () => {
    playing.delete(source);
    source.disconnect();
    level.disconnect();
  };
  source.start();
}

/** Stops everything the soundboard is playing, which leaving a call does. */
export function stopAllSounds(): void {
  for (const source of playing) {
    try {
      source.stop();
    } catch {
      // Already finished between the iteration and the call.
    }
  }
  playing.clear();
}

function fetchClip(context: AudioContext, url: string): Promise<AudioBuffer> {
  const held = decoded.get(url);
  if (held) return held;

  const pending = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The clip could not be fetched (${response.status}).`);
    return await context.decodeAudioData(await response.arrayBuffer());
  })();

  // A failed fetch is not cached: the next press should try again rather than
  // be answered from a rejection that is now minutes old.
  decoded.set(url, pending);
  pending.catch(() => decoded.delete(url));
  return pending;
}

/** Forgets every cached clip, which disconnecting from a server does. */
export function forgetSoundCache(): void {
  decoded.clear();
}
