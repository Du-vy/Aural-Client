/**
 * RNNoise, loaded into the audio graph when somebody asks for it.
 *
 * RNNoise is Jean-Marc Valin's — the author of Opus — which is why it works in
 * 10 ms frames at 48 kHz and needs no adapting to fit here. It is a hybrid
 * rather than a network end to end: classic DSP splits the signal into 22 Bark
 * bands and does the pitch analysis, and a small recurrent network decides how
 * much to attenuate each band. That is why a model this good is under 200 KB
 * and runs in a fraction of one core.
 *
 * What it is not is Krisp. It is markedly better than the browser's suppressor
 * on things that come and go — a door, a dog, keys — because it learned what
 * speech looks like rather than what the noise floor looked like a moment ago.
 * It does not remove other people's voices, because a voice is what it was
 * trained to keep. That is worth saying plainly wherever it is offered.
 *
 * Everything here fails to null rather than throwing. The caller then asks the
 * browser for its own suppression instead, which is a worse answer than
 * RNNoise and a much better one than no suppression at all.
 */

import type { RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";

/**
 * The only rate RNNoise works at.
 *
 * It is not resampled to fit. A context running at anything else is declined,
 * because a model fed audio at the wrong rate does not fail, it quietly hears
 * speech as too fast or too slow and suppresses the wrong things.
 */
export const RNNOISE_SAMPLE_RATE = 48000;

/**
 * The model and its loader, fetched once and only once anybody wants them.
 *
 * The import is deferred rather than written at the top of the file for two
 * reasons. The model is most of a megabyte between the wasm and the worklet,
 * and nobody who leaves this setting alone should pay for it. And the URLs are
 * resolved by the bundler, which means they exist in a browser build and
 * nowhere else — a top-level import would drag them into every tool that
 * loads this module for something unrelated.
 */
async function load() {
  const [module, worklet, wasm, simdWasm] = await Promise.all([
    import("@sapphi-red/web-noise-suppressor"),
    import("@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url"),
    import("@sapphi-red/web-noise-suppressor/rnnoise.wasm?url"),
    import("@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url"),
  ]);
  return {
    Node: module.RnnoiseWorkletNode,
    workletUrl: worklet.default,
    // The loader picks the SIMD build where the platform has it.
    binary: await module.loadRnnoise({ url: wasm.default, simdUrl: simdWasm.default }),
  };
}

/** The loaded model, shared by every microphone for the life of the page. */
let loaded: ReturnType<typeof load> | null = null;

/** Contexts that already have the processor registered. */
const registered = new WeakSet<BaseAudioContext>();

/**
 * The denoiser node for a context, or null if it cannot be had.
 *
 * The node is built here rather than by the caller so that by the time this
 * returns the answer is settled: the model is fetched, the processor is
 * registered, and the node exists. A caller has to know which suppression it
 * is getting *before* it opens the microphone, because the two are
 * alternatives and asking for both makes them fight.
 */
export async function prepareDenoiser(context: AudioContext): Promise<RnnoiseWorkletNode | null> {
  if (context.sampleRate !== RNNOISE_SAMPLE_RATE) return null;

  try {
    loaded ??= load().catch((error: unknown) => {
      // A failed load is not remembered. A network that was not there when the
      // client started may well be there by the time somebody joins a call,
      // and one bad moment should not disable this until a reload.
      loaded = null;
      throw error;
    });
    const { Node, workletUrl, binary } = await loaded;

    if (!registered.has(context)) {
      await context.audioWorklet.addModule(workletUrl);
      registered.add(context);
    }

    // The binary crosses to the worklet by structured clone, not transfer, so
    // the cached copy stays usable for every later microphone.
    return new Node(context, { maxChannels: 1, wasmBinary: binary });
  } catch (error) {
    // The caller falls back to the browser's own suppressor, and the interface
    // says so. What it cannot say is *why*, and the difference between a
    // blocked fetch, a worklet the platform refused and a context in the wrong
    // state is the whole of diagnosing a report of this, so it is logged.
    console.warn("Aural: RNNoise could not be loaded", error);
    return null;
  }
}

/** Releases a denoiser's state on the audio thread. */
export function disposeDenoiser(node: RnnoiseWorkletNode): void {
  try {
    node.disconnect();
    node.destroy();
  } catch {
    // A node belonging to a context that is already closing is already gone.
  }
}

export type { RnnoiseWorkletNode as DenoiserNode };
