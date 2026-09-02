/**
 * The two ends of the local audio path: the microphone that is sent, and the
 * speakers everybody else is played through.
 *
 * Neither knows anything about the network. The engine wires the microphone's
 * outbound track into a peer connection and hands arriving streams to the
 * playback, and that is the whole of the contact between them.
 */

import {
  RNNOISE_SAMPLE_RATE,
  disposeDenoiser,
  prepareDenoiser,
  type DenoiserNode,
} from "./denoise";

/** How often the level is sampled, in milliseconds. */
const METER_INTERVAL_MS = 40;

/**
 * How long the gate stays open after speech drops below the threshold.
 *
 * Without it every pause between words closes the microphone and the far end
 * hears speech chopped into pieces. A quarter of a second is longer than the
 * gaps inside a sentence and shorter than the gaps between them.
 */
const ACTIVITY_HANGOVER_MS = 300;

/**
 * How long the gain takes to move when the gate opens or closes. A step
 * change in gain is a click; ten milliseconds is inaudible as a fade and short
 * enough not to swallow the start of a word.
 */
const GATE_RAMP_S = 0.01;

/** The quietest level the meter shows, in decibels below full scale. */
const FLOOR_DB = -70;

/**
 * Which noise suppression sits in front of the microphone.
 *
 * These are alternatives, not layers. Two suppressors in series fight: the
 * first has already flattened the bands the second estimates its noise floor
 * from, so the second over-suppresses and the result is a metallic voice. This
 * is why choosing `rnnoise` turns the browser's own suppressor off, and it is
 * what every client offering a choice like this does.
 *
 * Echo cancellation and gain control are separate modules and are unaffected.
 * RNNoise cannot cancel echo — it has no reference of what the speakers are
 * playing — so switching suppression must never be allowed to switch that off.
 */
export type NoiseSuppression = "off" | "standard" | "rnnoise";

export interface CaptureOptions {
  /** Empty means whatever the system calls the default. */
  deviceId: string;
  echoCancellation: boolean;
  noiseSuppression: NoiseSuppression;
  autoGainControl: boolean;
}

/**
 * Why a microphone could not be opened.
 *
 * This is a code and not a sentence on purpose. Every one of these has a
 * different thing to do about it, and the client says which in the reader's
 * own language; a message carried up from here could do neither.
 */
export type MicrophoneFailure = "denied" | "missing" | "busy" | "unsupported" | "unknown";

/** A microphone that would not open, and what kind of refusal it was. */
export class MicrophoneError extends Error {
  readonly reason: MicrophoneFailure;

  constructor(reason: MicrophoneFailure, message: string) {
    super(message);
    this.name = "MicrophoneError";
    this.reason = reason;
  }
}

function describeCaptureFailure(error: unknown): MicrophoneError {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new MicrophoneError("denied", "Microphone access was refused.");
    case "NotFoundError":
    case "OverconstrainedError":
      return new MicrophoneError("missing", "No microphone was found.");
    case "NotReadableError":
    case "AbortError":
      return new MicrophoneError("busy", "The microphone is in use by something else.");
    default:
      return new MicrophoneError(
        "unknown",
        error instanceof Error ? error.message : "The microphone could not be opened.",
      );
  }
}

/**
 * The capture constraints, given whether RNNoise is really in the graph.
 *
 * `denoising` is the answer to "did it load", not "was it asked for". Somebody
 * who chose RNNoise on a machine where it could not be fetched gets the
 * browser's suppressor instead — a worse answer than what they picked, and a
 * far better one than the silence-with-a-fan they would get from honouring the
 * choice literally.
 */
function constraintsFor(options: CaptureOptions, denoising: boolean): MediaStreamConstraints {
  const browserSuppression =
    options.noiseSuppression === "standard" ||
    (options.noiseSuppression === "rnnoise" && !denoising);
  return {
    audio: {
      ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
      echoCancellation: options.echoCancellation,
      noiseSuppression: browserSuppression,
      autoGainControl: options.autoGainControl,
      // One channel is what a microphone produces and what Opus is asked for.
      channelCount: 1,
    },
    video: false,
  };
}

/**
 * The graph's context, at 48 kHz wherever the platform allows it.
 *
 * Opus runs on a 48 kHz clock and RNNoise was written against the same one, so
 * this is the rate everything downstream already wants. A platform that
 * refuses is given its own rate and simply does not get RNNoise.
 */
function createContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: RNNOISE_SAMPLE_RATE });
  } catch {
    return new AudioContext();
  }
}

/**
 * The microphone, and the gate and gain in front of it.
 *
 * The track this hands out is deliberately not the track the operating system
 * produced. It is the output of a small audio graph, which buys two things
 * worth the indirection: the gate can fade rather than switch, so opening the
 * microphone does not click; and changing input device rewires the graph
 * instead of replacing the track, so it needs no renegotiation and cannot
 * interrupt a call.
 *
 * When the audio graph is unavailable the raw track is used instead and both
 * of those become slightly worse, which is the right trade against not working.
 */
export class Microphone {
  /** The track to send. It does not change for the life of this object. */
  readonly track: MediaStreamTrack;
  /** The stream that track belongs to, which is what a sender wants. */
  readonly stream: MediaStream;
  /** Set when the audio graph could not be built and the raw track is in use. */
  readonly raw: boolean;

  private context: AudioContext | null;
  private gain: GainNode | null;
  private analyser: AnalyserNode | null;
  private samples: Float32Array<ArrayBuffer> | null;
  private source: MediaStreamAudioSourceNode | null = null;
  private denoise: DenoiserNode | null = null;

  private capture: MediaStream;
  private options: CaptureOptions;

  private inputVolume = 1;
  private open = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(level: number) => void>();
  private closed = false;

  private constructor(
    capture: MediaStream,
    options: CaptureOptions,
    graph: {
      context: AudioContext;
      gain: GainNode;
      analyser: AnalyserNode;
      destination: MediaStreamAudioDestinationNode;
      denoise: DenoiserNode | null;
    } | null,
  ) {
    this.capture = capture;
    this.options = options;

    if (graph) {
      this.context = graph.context;
      this.gain = graph.gain;
      this.analyser = graph.analyser;
      this.denoise = graph.denoise;
      this.samples = new Float32Array(graph.analyser.fftSize);
      this.stream = graph.destination.stream;
      this.raw = false;
    } else {
      this.context = null;
      this.gain = null;
      this.analyser = null;
      this.samples = null;
      this.stream = capture;
      this.raw = true;
    }

    const track = this.stream.getAudioTracks()[0];
    if (!track) {
      throw new MicrophoneError("unknown", "The microphone produced no audio track.");
    }
    this.track = track;
    this.connectSource();
    this.setOpen(false);
    this.startMeter();
  }

  /** Opens a microphone, or explains why it could not be opened. */
  static async open(options: CaptureOptions): Promise<Microphone> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicrophoneError(
        "unsupported",
        "This browser will not give a page a microphone. A secure origin is usually what is missing.",
      );
    }

    // The graph comes first, and RNNoise with it, because whether RNNoise
    // actually loaded is what decides which suppression the microphone is
    // opened with. Finding out afterwards would mean opening it with no
    // suppression at all and then having to open it a second time.
    let context: AudioContext | null = null;
    let denoise: DenoiserNode | null = null;
    try {
      context = createContext();
      if (options.noiseSuppression === "rnnoise") {
        denoise = await prepareDenoiser(context);
      }
    } catch {
      // No audio graph. The raw track is used below, and RNNoise is not
      // possible without a graph to put it in.
      context = null;
    }

    let capture: MediaStream;
    try {
      capture = await navigator.mediaDevices.getUserMedia(
        constraintsFor(options, denoise !== null),
      );
    } catch (error) {
      void context?.close().catch(() => {});
      throw describeCaptureFailure(error);
    }

    try {
      if (!context) throw new Error("no audio context");
      const gain = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      const destination = context.createMediaStreamDestination();
      gain.connect(destination);
      return new Microphone(capture, options, { context, gain, analyser, destination, denoise });
    } catch {
      // No audio graph: the raw track is sent, the gate switches instead of
      // fading, and the meter reads nothing. All of that is better than
      // refusing to open the microphone at all.
      if (denoise) disposeDenoiser(denoise);
      void context?.close().catch(() => {});
      return new Microphone(capture, options, null);
    }
  }

  /** Reopens the microphone on a different device, or with different processing. */
  async reconfigure(options: CaptureOptions): Promise<void> {
    if (this.closed) return;

    // As in open(), the denoiser is settled before the microphone is asked
    // for. Switching suppression is the one change that alters both halves at
    // once, and they have to agree.
    let denoise = this.denoise;
    if (options.noiseSuppression !== this.options.noiseSuppression) {
      denoise =
        options.noiseSuppression === "rnnoise" && this.context
          ? await prepareDenoiser(this.context)
          : null;
    }
    const replacing = denoise !== this.denoise;
    const discard = () => {
      if (replacing && denoise) disposeDenoiser(denoise);
    };

    let capture: MediaStream;
    try {
      capture = await navigator.mediaDevices.getUserMedia(
        constraintsFor(options, denoise !== null),
      );
    } catch (error) {
      discard();
      throw describeCaptureFailure(error);
    }
    if (this.closed) {
      stopAll(capture);
      discard();
      return;
    }

    if (this.raw) {
      // Without the graph the outbound track is the captured one, so it cannot
      // be swapped underneath a live call from here. The engine is told by the
      // track ending, and replaces it on the sender.
      stopAll(capture);
      discard();
      throw new MicrophoneError(
        "unsupported",
        "This browser cannot change input device during a call.",
      );
    }

    if (replacing) {
      if (this.denoise) disposeDenoiser(this.denoise);
      this.denoise = denoise;
    }
    const previous = this.capture;
    this.capture = capture;
    this.options = options;
    this.connectSource();
    stopAll(previous);
  }

  /** Whether RNNoise is really in the graph, rather than merely asked for. */
  get denoising(): boolean {
    return this.denoise !== null;
  }

  /** The processing this microphone was opened with. */
  get settings(): CaptureOptions {
    return this.options;
  }

  /** Sets the input gain, as a percentage where 100 is unity. */
  setInputVolume(percent: number): void {
    this.inputVolume = Math.max(0, percent) / 100;
    this.applyGain(this.open);
  }

  /** Opens or closes the gate. Everything upstream keeps running either way. */
  setOpen(open: boolean): void {
    this.open = open;
    if (this.raw) {
      this.track.enabled = open;
      return;
    }
    this.applyGain(open);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Subscribes to the level, 0 to 100 on the scale the meter draws. */
  onLevel(listener: (level: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Nudges a suspended audio context back into running.
   *
   * A browser will not start one without a gesture, and a machine coming back
   * from sleep can suspend one that was already running. Both are recoverable
   * and neither is worth an error.
   */
  async resume(): Promise<void> {
    if (this.context && this.context.state !== "running") {
      try {
        await this.context.resume();
      } catch {
        // Nothing to do: the next gesture will try again.
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.listeners.clear();
    this.source?.disconnect();
    if (this.denoise) disposeDenoiser(this.denoise);
    this.denoise = null;
    this.gain?.disconnect();
    this.analyser?.disconnect();
    stopAll(this.capture);
    if (!this.raw) {
      for (const track of this.stream.getTracks()) track.stop();
    }
    void this.context?.close().catch(() => {});
    this.context = null;
  }

  private connectSource(): void {
    if (this.raw || !this.context || !this.gain || !this.analyser) return;
    this.source?.disconnect();
    this.source = this.context.createMediaStreamSource(this.capture);
    // The analyser sits on the source rather than after the gain, so the meter
    // keeps reading while the gate is shut. A meter that goes silent the
    // moment you stop talking is no help at all in setting a threshold.
    //
    // It sits ahead of the denoiser for the same kind of reason: the threshold
    // is set against what the microphone hears, so what the slider means stays
    // put when the suppression setting changes underneath it.
    this.source.connect(this.analyser);
    if (this.denoise) {
      this.denoise.disconnect();
      this.source.connect(this.denoise);
      this.denoise.connect(this.gain);
    } else {
      this.source.connect(this.gain);
    }
  }

  private applyGain(open: boolean): void {
    if (!this.gain || !this.context) return;
    const target = open ? this.inputVolume : 0;
    const now = this.context.currentTime;
    try {
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setValueAtTime(this.gain.gain.value, now);
      this.gain.gain.linearRampToValueAtTime(target, now + GATE_RAMP_S);
    } catch {
      this.gain.gain.value = target;
    }
  }

  private startMeter(): void {
    if (!this.analyser || !this.samples) return;
    this.timer = setInterval(() => {
      const level = this.read();
      for (const listener of this.listeners) listener(level);
    }, METER_INTERVAL_MS);
  }

  /** Reads the current level as 0 to 100. */
  private read(): number {
    const analyser = this.analyser;
    const samples = this.samples;
    if (!analyser || !samples) return 0;

    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / samples.length);
    if (rms <= 0) return 0;

    // Decibels, mapped onto the meter's scale. A linear meter spends almost
    // all of its width on the loudest tenth of a signal, which is why speech
    // barely moves one; a decibel scale spreads speech across the middle.
    const db = 20 * Math.log10(rms);
    return Math.round(Math.min(100, Math.max(0, ((db - FLOOR_DB) / -FLOOR_DB) * 100)));
  }
}

function stopAll(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/**
 * Turns a level and a threshold into a speaking decision, with the hangover
 * that stops a pause between words from closing the microphone.
 */
export class ActivityGate {
  private threshold: number;
  private openUntil = 0;
  private speaking = false;

  constructor(threshold: number) {
    this.threshold = threshold;
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  /** Feeds one level reading and returns whether the gate should be open. */
  push(level: number, now = Date.now()): boolean {
    if (level >= this.threshold) {
      this.openUntil = now + ACTIVITY_HANGOVER_MS;
      this.speaking = true;
    } else if (this.speaking && now >= this.openUntil) {
      this.speaking = false;
    }
    return this.speaking;
  }

  reset(): void {
    this.speaking = false;
    this.openUntil = 0;
  }
}

/**
 * Everybody else's audio.
 *
 * One `<audio>` element per participant, rather than one audio graph mixing
 * them: an element gives per-person volume, output device selection and the
 * browser's own jitter handling for nothing, and a graph would give the same
 * result with more that can go wrong.
 */
export class Playback {
  private elements = new Map<number, HTMLAudioElement>();
  private volumes = new Map<number, number>();
  private container: HTMLElement | null = null;
  private master = 1;
  private deafened = false;
  private sinkId = "";

  /** Starts playing one participant's stream. */
  attach(userId: number, stream: MediaStream): void {
    let element = this.elements.get(userId);
    if (!element) {
      element = document.createElement("audio");
      element.autoplay = true;
      // Nothing about these is meant to be seen or controlled directly; the
      // interface in front of them is the member list.
      element.setAttribute("data-aural-voice", String(userId));
      this.mount().appendChild(element);
      this.elements.set(userId, element);
      void this.applySink(element);
    }
    if (element.srcObject !== stream) {
      element.srcObject = stream;
    }
    this.apply(userId, element);
    // A play() rejection is normal until there has been a gesture. Joining a
    // channel is one, so by the time audio arrives this almost always
    // succeeds; when it does not, the next attach tries again.
    void element.play().catch(() => {});
  }

  detach(userId: number): void {
    const element = this.elements.get(userId);
    if (!element) return;
    this.elements.delete(userId);
    element.pause();
    element.srcObject = null;
    element.remove();
  }

  /** True when this participant's audio is playing here. */
  has(userId: number): boolean {
    return this.elements.has(userId);
  }

  setMasterVolume(percent: number): void {
    this.master = Math.max(0, percent) / 100;
    this.applyAll();
  }

  setUserVolume(userId: number, percent: number): void {
    this.volumes.set(userId, Math.max(0, percent) / 100);
    const element = this.elements.get(userId);
    if (element) this.apply(userId, element);
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    this.applyAll();
  }

  /** Points playback at an output device, where the browser allows it. */
  async setOutputDevice(deviceId: string): Promise<void> {
    this.sinkId = deviceId;
    await Promise.all([...this.elements.values()].map((element) => this.applySink(element)));
  }

  close(): void {
    for (const userId of [...this.elements.keys()]) this.detach(userId);
    this.container?.remove();
    this.container = null;
  }

  private apply(userId: number, element: HTMLAudioElement): void {
    const own = this.volumes.get(userId) ?? 1;
    // An element's volume cannot exceed 1, so amplification above 100% is not
    // something this can offer. Turning somebody down is the case that
    // matters, and it works exactly.
    element.volume = Math.min(1, this.master * own);
    element.muted = this.deafened;
  }

  private applyAll(): void {
    for (const [userId, element] of this.elements) this.apply(userId, element);
  }

  private async applySink(element: HTMLAudioElement): Promise<void> {
    const withSink = element as HTMLAudioElement & { setSinkId?(id: string): Promise<void> };
    if (typeof withSink.setSinkId !== "function") return;
    try {
      await withSink.setSinkId(this.sinkId);
    } catch {
      // Firefox and older WebKit do not implement this, and a device can be
      // unplugged between being chosen and being used. Either way the default
      // output is the right thing to fall back to.
    }
  }

  private mount(): HTMLElement {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.style.display = "none";
      this.container.setAttribute("data-aural-voice-output", "");
      document.body.appendChild(this.container);
    }
    return this.container;
  }
}

/** The input and output devices this machine has, as far as the browser says. */
export interface AudioDevices {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

/**
 * Lists audio devices. Labels are blank until a microphone has been granted
 * once, which is a rule of the platform rather than something to work around:
 * a page that has never been given a microphone has no business knowing what
 * hardware is attached.
 */
export async function listDevices(): Promise<AudioDevices> {
  if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [] };
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: devices.filter((device) => device.kind === "audioinput"),
      outputs: devices.filter((device) => device.kind === "audiooutput"),
    };
  } catch {
    return { inputs: [], outputs: [] };
  }
}
