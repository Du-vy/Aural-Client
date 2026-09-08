/**
 * The voice engine: microphone in, peer connections out, and the two hosting
 * modes on top of one set of machinery.
 *
 * What differs between the modes is only who the peers are.
 *
 *   server_host   one peer connection, to the server's relay. It carries this
 *                 client's audio up and everybody else's back down, each on
 *                 its own track named after whoever is speaking.
 *
 *   client_host   one peer connection per pair. The first arrival is elected
 *                 host and dials everybody; everybody else holds exactly one
 *                 connection, to the host. The host plays what it receives and
 *                 forwards each person's track on to the others, which is the
 *                 whole of the relaying.
 *
 * Everything else — the microphone, the gate, the level meter, playback,
 * bitrate, mute, recovery — is the same code either way.
 *
 * A shared screen rides on those same connections and changes none of that.
 * It is a second and a third thing sent down a link that was already open, and
 * it obeys the one rule the whole design rests on: exactly one side of any
 * link offers. So this client never offers a screen. Whoever relays the
 * channel — the server's relay, or the elected host — opens a section and
 * offers to receive one, and this client answers by sending. That is why
 * starting a share in the middle of a call cannot disturb the call.
 *
 * The other half of the cost is who gets sent it. Everybody in a channel
 * hears everybody, but a picture is two orders of magnitude larger than a
 * voice, so a screen is only ever sent to somebody who asked for it.
 *
 * Recovery is deliberately blunt. There is one way back from every failure:
 * tear the media down and call `voice.connect` again. A host that went away, a
 * transport that gave up, a server whose audio plane was reconfigured and a
 * laptop that came back from sleep all end in the same place, so the path is
 * the one taken on every ordinary call rather than one only exercised when
 * something has already gone wrong.
 */

import {
  SERVER_PEER,
  isDeafened,
  isMuted,
  type ICECandidateInitLike,
  type ICEServer,
  type TrackPurpose,
  type VideoQuality,
  type VoiceConfig,
  type VoiceConnectRequest,
  type VoiceConnectResult,
  type VoiceHostEvent,
  type VoiceMode,
  type VoicePeerEvent,
  type VoiceSignalEvent,
  type VoiceSignalRequest,
  type VoiceState,
  type VoiceStreamEvent,
  type VoiceStreamRequest,
  type VoiceStreamResult,
  type VoiceWatchEvent,
  type VoiceWatchRequest,
} from "@/lib/protocol";
import {
  ActivityGate,
  Microphone,
  MicrophoneError,
  Playback,
  type CaptureOptions,
  type MicrophoneFailure,
} from "./audio";
import {
  captureScreen,
  constrain,
  degradationFor,
  hintContent,
  preferCodec,
  resolveCodec,
  type ScreenCapture,
  type ScreenPreferences,
} from "./screen";
import { applyOpusPreferences, opusPreferences } from "./sdp";
import type { InputMode } from "./settings";

/** Where a media session is in its life. */
export type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting" | "failed";

/** Whose media one sender carries, and which of their media it is. */
interface TrackOwner {
  userId: number;
  purpose: TrackPurpose;
}

/** The key incoming media and forwarded senders are held under. */
function slot(userId: number, purpose: TrackPurpose): string {
  return `${userId}:${purpose}`;
}

/** How long a reconnection waits, per attempt, before giving up. */
const RECONNECT_DELAYS_MS = [400, 1200, 3000, 6000, 10_000];

/**
 * How long a stream that stopped arriving is kept before the participant is
 * considered gone. Peer connections drop and come back; playback that flapped
 * with them would be worse than a moment of silence.
 */
const NEGOTIATION_TIMEOUT_MS = 20_000;

/** The requests the engine makes of the server. The store supplies them. */
export interface VoiceTransport {
  connect(request: VoiceConnectRequest): Promise<VoiceConnectResult>;
  signal(request: VoiceSignalRequest): Promise<void>;
  leave(): Promise<void>;
  speaking(speaking: boolean): Promise<void>;
  /** Announces a screen share, or the end of one. The reply is what the server allows. */
  stream(request: VoiceStreamRequest): Promise<VoiceStreamResult>;
  /** Asks for, or gives up, one participant's screen. */
  watch(request: VoiceWatchRequest): Promise<void>;
}

/** What the engine tells the interface about. */
export interface VoiceHandlers {
  onStatus(status: VoiceStatus, error: string | null): void;
  /** The local microphone level, 0 to 100, for the meter. */
  onLevel(level: number): void;
  /** Whether this client is transmitting right now. */
  onSpeaking(speaking: boolean): void;
  onHost(hostUserId: number | null): void;
  /** Someone's audio started or stopped arriving. */
  onAudio(userId: number, present: boolean): void;
  /**
   * Someone's screen started or stopped arriving.
   *
   * The stream is handed over rather than a flag, because the only thing that
   * can be done with a picture is put it in a video element, and the element
   * belongs to whatever is drawing the interface.
   */
  onScreen(userId: number, stream: MediaStream | null): void;
  /**
   * This client's own capture, for the preview shown to whoever is sharing.
   *
   * It is local and never travels: what is displayed here is the same track
   * being encoded, not a copy that came back.
   */
  onOwnScreen(stream: MediaStream | null): void;
  /**
   * The share ended for a reason this client did not choose — almost always
   * the platform's own "stop sharing" button, which is outside the window and
   * cannot be noticed any other way.
   */
  onScreenEnded(): void;
  /**
   * Every screen share already running when this client opened its session.
   *
   * It arrives with the reply to `voice.connect` rather than as an event,
   * because the events that announced these streams were sent before this
   * client was listening.
   */
  onStreams(streams: VoiceStreamEvent[]): void;
  /**
   * Why the microphone could not be opened, or null once it is.
   *
   * It is reported apart from the status because it outlives it: a session
   * with no microphone still connects, and a connected session that overwrote
   * this would leave somebody wondering why nobody can hear them.
   */
  onMicrophone(failure: MicrophoneFailure | null): void;
  /**
   * Whether RNNoise is really in the graph, rather than merely chosen.
   *
   * It can be chosen and not had — the model would not load, or the platform
   * would not give the graph 48 kHz — and the microphone then falls back to
   * the browser's own suppressor. Somebody who picked one thing and silently
   * got another deserves to be told, so this is reported rather than assumed.
   */
  onDenoising(active: boolean): void;
  /**
   * The round trip on the slowest link of the call, in milliseconds, or null
   * when there is nothing to measure yet.
   *
   * The slowest rather than an average because a call is only as good as its
   * worst leg. In the two topologies where this client has one link — the
   * relay carrying it, or the host carrying it — the slowest link is that one
   * link and the number is simply "my ping". On the client that is itself the
   * host, it is the furthest person in the call, which is the number that
   * client can actually do something about.
   */
  onLatency(latencyMs: number | null): void;
}

export interface EngineOptions {
  selfId: number;
  transport: VoiceTransport;
  handlers: VoiceHandlers;
}

/** The knobs the interface turns, gathered so they can be applied at once. */
export interface EngineSettings {
  capture: CaptureOptions;
  inputVolume: number;
  outputVolume: number;
  outputDeviceId: string;
  mode: InputMode;
  threshold: number;
  bitrate: number;
}

/**
 * One peer connection and the bookkeeping that keeps its negotiation orderly.
 *
 * Exactly one side of any link offers, always: the relay in server_host, the
 * elected host in client_host. That removes glare entirely rather than
 * resolving it, which is worth far more than the flexibility it costs.
 */
class PeerLink {
  readonly peerId: number;
  readonly pc: RTCPeerConnection;
  /** Whether this side is the one that offers on this link. */
  readonly offering: boolean;

  /** Media ids to the user whose media they carry, as the far end named them. */
  mids = new Map<string, number>();
  /** Media ids to what that media is. */
  purposes = new Map<string, TrackPurpose>();
  /** Forwarded senders, by whose media they carry and which of it. Host only. */
  forwards = new Map<string, RTCRtpSender>();
  /** What each of this side's senders carries, for the maps sent with an offer. */
  owners = new Map<RTCRtpSender, TrackOwner>();
  /**
   * Sections this side opened for the far end to publish a screen on, by
   * purpose. Only a relaying host has any: it is the host asking a participant
   * for their picture, which is the same thing the server's relay does.
   */
  slots = new Map<TrackPurpose, RTCRtpTransceiver>();
  /**
   * Sections the far end opened for *this* client to publish its screen on,
   * by purpose. They are read out of the offer that created them.
   */
  outgoing = new Map<TrackPurpose, RTCRtpTransceiver>();
  /** True once this side has put its own microphone on the link. */
  sending = false;

  private candidates: RTCIceCandidateInit[] = [];
  private remoteReady = false;
  private negotiating = false;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  closed = false;

  constructor(peerId: number, pc: RTCPeerConnection, offering: boolean) {
    this.peerId = peerId;
    this.pc = pc;
    this.offering = offering;
  }

  /** Holds a candidate that arrived before there was a description to add it to. */
  async addCandidate(candidate: ICECandidateInitLike | undefined): Promise<void> {
    if (!candidate?.candidate) {
      // An empty candidate is a browser saying it has finished gathering.
      return;
    }
    const init: RTCIceCandidateInit = {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? undefined,
      sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
      usernameFragment: candidate.usernameFragment ?? undefined,
    };
    if (!this.remoteReady) {
      this.candidates.push(init);
      return;
    }
    try {
      await this.pc.addIceCandidate(init);
    } catch {
      // A candidate for a description that has since been replaced is not
      // worth reporting: ICE is expected to lose some.
    }
  }

  /** Marks the remote description applied and drains what was held for it. */
  async flushCandidates(): Promise<void> {
    this.remoteReady = true;
    const held = this.candidates;
    this.candidates = [];
    for (const candidate of held) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        // As above.
      }
    }
  }

  /** Starts a round of negotiation, or remembers to start one when this ends. */
  beginNegotiation(): boolean {
    if (this.closed) return false;
    if (this.negotiating) {
      this.pending = true;
      return false;
    }
    this.negotiating = true;
    return true;
  }

  /** Ends a round and reports whether another was asked for while it ran. */
  endNegotiation(): boolean {
    this.negotiating = false;
    const again = this.pending;
    this.pending = false;
    this.clearTimer();
    return again;
  }

  armTimeout(onTimeout: () => void): void {
    this.clearTimer();
    this.timer = setTimeout(onTimeout, NEGOTIATION_TIMEOUT_MS);
  }

  clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.onnegotiationneeded = null;
    try {
      this.pc.close();
    } catch {
      // Already gone.
    }
  }
}

export class VoiceEngine {
  private readonly selfId: number;
  private readonly transport: VoiceTransport;
  private readonly handlers: VoiceHandlers;
  private readonly playback = new Playback();

  private mic: Microphone | null = null;
  private micOff: (() => void) | null = null;
  private gate = new ActivityGate(22);

  private links = new Map<number, PeerLink>();
  /** Signalling that arrived before the link it belongs to existed. */
  private held = new Map<number, VoiceSignalEvent[]>();
  /**
   * Each participant's media as it arrives, keyed by whose it is and what it
   * is. It is what a host forwards, and what the interface is handed.
   */
  private incoming = new Map<string, MediaStream>();

  /** This client's own screen capture, while it is sharing. */
  private capture: ScreenCapture | null = null;
  /** The quality the server allowed, which is what the encoder is given. */
  private screenQuality: VideoQuality | null = null;
  /** Whose screens this client has asked for. */
  private watching = new Set<number>();
  /** Who is sharing a screen right now, so a host knows what to forward. */
  private streamers = new Set<number>();
  /** Who has asked for whose screen, so a host knows where to forward it. */
  private viewers = new Map<number, Set<number>>();

  private settings: EngineSettings;
  private screenPrefs: ScreenPreferences;
  private config: VoiceConfig | null = null;
  private iceServers: ICEServer[] = [];

  private channelId: number | null = null;
  private mode: VoiceMode = "server_host";
  private hostUserId: number | null = null;
  private epoch = 0;

  private status: VoiceStatus = "idle";
  private muted = false;
  private pushing = false;
  private transmitting = false;
  /** Distinguishes one session from the next, so a stale reply is ignored. */
  private generation = 0;
  private reconnects = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private latencyTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(options: EngineOptions, settings: EngineSettings, screenPrefs: ScreenPreferences) {
    this.selfId = options.selfId;
    this.transport = options.transport;
    this.handlers = options.handlers;
    this.settings = settings;
    this.screenPrefs = screenPrefs;
    this.gate.setThreshold(settings.threshold);
    this.playback.setMasterVolume(settings.outputVolume);
    void this.playback.setOutputDevice(settings.outputDeviceId);
  }

  get currentChannelId(): number | null {
    return this.channelId;
  }

  get currentStatus(): VoiceStatus {
    return this.status;
  }

  /**
   * Opens a media session in a channel this client has already joined.
   *
   * Joining the channel is `user.move` and has happened before this is called;
   * this is only the audio.
   */
  async join(channelId: number, config: VoiceConfig, iceServers: ICEServer[]): Promise<void> {
    this.cancelReconnect();
    if (this.channelId !== null && this.channelId !== channelId) {
      await this.leave();
    }

    this.channelId = channelId;
    this.config = config;
    this.mode = config.mode;
    if (iceServers.length > 0) this.iceServers = iceServers;
    this.reconnects = 0;

    await this.openSession();
  }

  /**
   * Takes a fresh audio configuration from the server.
   *
   * An operator can change what this server carries while people are sitting
   * in it, and switching who relays is the change that matters here: the whole
   * topology differs between the two modes, so a client still holding the old
   * one offers where it should wait and is refused. The session is torn down
   * and rebuilt under the new mode rather than patched, because there is no
   * part of it the two modes share.
   */
  reconfigure(config: VoiceConfig): void {
    const wasMode = this.config?.mode;
    this.config = config;
    this.mode = config.mode;
    if (this.channelId === null || config.mode === wasMode) {
      this.applyBitrate();
      return;
    }
    // The same path a host handover takes, and for the same reason: the
    // session cannot be edited into the other mode, only replaced. A server
    // that changes this sends everybody a reset of its own a moment later, and
    // arriving at the same place twice is what makes both orderings safe.
    this.handleReset();
  }

  /** Closes the media session and lets the server know. */
  async leave(): Promise<void> {
    this.cancelReconnect();
    // The capture is released here rather than in teardownMedia, because
    // teardownMedia also runs on the way through a reconnection and a share
    // that survives one is a share nobody had to start again.
    this.releaseCapture();
    this.watching.clear();
    this.streamers.clear();
    this.viewers.clear();
    const had = this.channelId !== null;
    this.generation += 1;
    this.channelId = null;
    this.hostUserId = null;
    this.teardownMedia();
    this.closeMicrophone();
    this.setStatus("idle", null);
    this.handlers.onHost(null);

    if (had) {
      try {
        await this.transport.leave();
      } catch {
        // The session is gone from this side whatever the server says, and a
        // disconnected socket is the usual reason this fails.
      }
    }
  }

  /** Releases everything. The engine cannot be used afterwards. */
  dispose(): void {
    this.disposed = true;
    this.cancelReconnect();
    this.generation += 1;
    this.channelId = null;
    this.releaseCapture();
    this.teardownMedia();
    this.closeMicrophone();
    this.playback.close();
  }

  // --- settings --------------------------------------------------------------

  /** Applies changed preferences to a session that may or may not be running. */
  async apply(settings: EngineSettings): Promise<void> {
    const previous = this.settings;
    this.settings = settings;

    this.gate.setThreshold(settings.threshold);
    this.playback.setMasterVolume(settings.outputVolume);
    if (previous.outputDeviceId !== settings.outputDeviceId) {
      await this.playback.setOutputDevice(settings.outputDeviceId);
    }
    this.mic?.setInputVolume(settings.inputVolume);

    if (previous.mode !== settings.mode) {
      this.gate.reset();
      this.pushing = false;
      this.evaluateGate(0);
    }
    if (previous.bitrate !== settings.bitrate) {
      this.applyBitrate();
    }
    if (this.mic) {
      if (!sameCapture(previous.capture, settings.capture)) {
        await this.reopenMicrophone();
      }
      return;
    }
    // A session that opened without a microphone tries again whenever the
    // settings change, because changing them is exactly what somebody does
    // after being told their microphone did not work.
    if (this.channelId !== null) await this.openMicrophoneLate();
  }

  /**
   * Tries the microphone again, in a session that is already up without one.
   *
   * Somebody who has just allowed the microphone in their system settings has
   * nothing left to change in the client, so there has to be a way to ask
   * again that is neither "change a setting" nor "leave and rejoin".
   *
   * It is also the way back from RNNoise having failed to load. The setting
   * already says `rnnoise`, so changing it is not a thing that can be done
   * twice, and the microphone has to be reopened for a second attempt to reach
   * the graph at all.
   */
  async retryMicrophone(): Promise<void> {
    if (this.disposed || this.channelId === null) return;
    if (this.mic) {
      this.handlers.onMicrophone(null);
      if (this.settings.capture.noiseSuppression === "rnnoise" && !this.mic.denoising) {
        await this.reopenMicrophone();
      }
      return;
    }
    await this.openMicrophoneLate();
  }

  /** Opens the microphone after the session, and gives it to every peer. */
  private async openMicrophoneLate(): Promise<void> {
    const generation = this.generation;
    try {
      await this.ensureMicrophone();
      if (this.disposed || generation !== this.generation) return;
      this.handlers.onMicrophone(null);
      this.reportDenoising();
      for (const link of this.links.values()) this.attachLocalTrack(link);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.handlers.onMicrophone(classifyMicrophoneFailure(error));
    }
  }

  setUserVolume(userId: number, percent: number): void {
    this.playback.setUserVolume(userId, percent);
  }

  /** Whether this client's own microphone is stopped, for any reason. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.evaluateGate(0);
  }

  /** Whether everybody else's audio is stopped. Deafening also mutes. */
  setDeafened(deafened: boolean): void {
    this.playback.setDeafened(deafened);
  }

  /** Push-to-talk, driven by whatever is watching the keyboard. */
  setPushing(pushing: boolean): void {
    if (this.pushing === pushing) return;
    this.pushing = pushing;
    this.evaluateGate(0);
  }

  /**
   * Applies this client's own voice state.
   *
   * The server is the authority on it: a moderator's mute arrives this way,
   * and so does the client's own, having gone to the server and come back.
   */
  applyOwnState(state: VoiceState | undefined): void {
    this.setMuted(state ? isMuted(state) : false);
    this.setDeafened(state ? isDeafened(state) : false);
  }

  // --- server events ---------------------------------------------------------

  /** One signalling frame from the relay or from another client. */
  async handleSignal(event: VoiceSignalEvent): Promise<void> {
    if (this.channelId === null || event.channelId !== this.channelId) return;

    const link = this.links.get(event.fromUserId);
    if (!link) {
      if (event.kind === "offer") {
        // Only a client-hosted peer offers out of nowhere, and only the host
        // may. Anything else arriving before its link exists is held: the
        // reply that would have created the link is very often still in
        // flight, because it and this event share one socket.
        await this.acceptOffer(event);
        return;
      }
      this.hold(event);
      return;
    }

    switch (event.kind) {
      case "offer":
        await this.acceptOffer(event);
        return;
      case "answer":
        await this.acceptAnswer(link, event);
        return;
      case "candidate":
        await link.addCandidate(event.candidate);
        return;
      case "end":
        return;
    }
  }

  /** The host of a client-hosted channel being told to dial somebody, or drop them. */
  async handlePeer(event: VoicePeerEvent): Promise<void> {
    if (this.channelId === null || event.channelId !== this.channelId) return;
    if (this.mode !== "client_host" || this.hostUserId !== this.selfId) return;
    if (event.userId === this.selfId) return;

    if (event.action === "remove") {
      this.dropPeer(event.userId);
      return;
    }
    this.epoch = event.epoch;
    await this.dial(event.userId);
  }

  /** The result of an election. */
  handleHost(event: VoiceHostEvent): void {
    if (this.channelId === null || event.channelId !== this.channelId) return;
    if (event.epoch < this.epoch) return;
    this.epoch = event.epoch;
    this.hostUserId = event.hostUserId;
    this.handlers.onHost(event.hostUserId);
  }

  /**
   * The server saying this media session is gone.
   *
   * It is not an error and is not reported as one: a host handover is the
   * ordinary case. The session is rebuilt, with a short random wait so that a
   * whole channel told at once does not arrive at the new host together.
   */
  handleReset(): void {
    if (this.channelId === null) return;
    // The room this client was in is gone, and with it every subscription in
    // it: the server clears who was watching whom along with the sessions. A
    // client that kept its own copy would rebuild the session and act on
    // arrangements nobody else remembers. The capture itself is not part of
    // that and survives, because a reset is not a decision to stop sharing.
    this.watching.clear();
    this.streamers.clear();
    this.viewers.clear();
    this.teardownMedia();
    this.setStatus("reconnecting", null);
    this.scheduleReconnect(true);
  }

  /** Somebody left the channel, so their audio and their link go with them. */
  handleParticipantGone(userId: number): void {
    this.dropPeer(userId);
  }

  /**
   * Somebody's screen share started, changed or stopped.
   *
   * For most clients this is bookkeeping the interface reads. For the host of
   * a client-hosted channel it is an instruction: a participant about to share
   * has nowhere to send a picture until the host offers them a section for it,
   * and this is the only notice the host gets that one is needed.
   */
  handleStream(event: VoiceStreamEvent): void {
    if (this.channelId === null || event.channelId !== this.channelId) return;
    if (event.userId === this.selfId) return;

    if (!event.active) {
      this.streamers.delete(event.userId);
      for (const purpose of SCREEN_PURPOSES) {
        // The stream itself is kept. A share that stops and starts again comes
        // back on the section it already had — the far end put a track back on
        // a sender it never gave up — so no track arrives to be noticed, and a
        // host that had thrown the stream away would have nothing to forward.
        // What goes is the picture on screen and the sound in the room.
        this.absent(event.userId, purpose);
        this.stopForwarding(event.userId, purpose);
      }
      this.watching.delete(event.userId);
      for (const audience of this.viewers.values()) audience.delete(event.userId);
      return;
    }

    this.streamers.add(event.userId);
    if (this.mode !== "client_host" || this.hostUserId !== this.selfId) return;
    this.openSlots(event.userId, event.audio);
  }

  /**
   * Somebody started or stopped watching somebody's screen.
   *
   * In `server_host` the relay has already acted on it and this only keeps the
   * viewer counts honest. In `client_host` it is the entire mechanism: the
   * host is the only machine holding the picture, so it is the host that puts
   * it onto the viewer's link, and takes it off again.
   */
  handleWatch(event: VoiceWatchEvent): void {
    if (this.channelId === null || event.channelId !== this.channelId) return;

    const audience = this.viewers.get(event.publisherId) ?? new Set<number>();
    if (event.watching) audience.add(event.viewerId);
    else audience.delete(event.viewerId);
    this.viewers.set(event.publisherId, audience);

    if (event.viewerId === this.selfId) {
      if (event.watching) this.watching.add(event.publisherId);
      else this.watching.delete(event.publisherId);
    }

    if (this.mode !== "client_host" || this.hostUserId !== this.selfId) return;
    if (event.viewerId === this.selfId) return;

    const link = this.links.get(event.viewerId);
    if (!link || link.closed) return;

    let changed = false;
    for (const purpose of SCREEN_PURPOSES) {
      if (!event.watching) {
        changed = this.unforward(link, event.publisherId, purpose) || changed;
        continue;
      }
      const stream =
        event.publisherId === this.selfId
          ? this.capture?.stream
          : this.incoming.get(slot(event.publisherId, purpose));
      if (!stream) continue;
      const before = link.forwards.size;
      this.forward(link, event.publisherId, purpose, stream);
      changed = changed || link.forwards.size !== before;
    }
    if (changed) void this.negotiate(link);
  }

  /** Whether this client is sharing a screen right now. */
  get sharing(): boolean {
    return this.capture !== null;
  }

  /**
   * Starts sharing a screen or a window.
   *
   * The platform's own picker decides which — every monitor is listed
   * separately and every window by name — and the answer only comes back once
   * somebody has chosen. Nothing is announced before then, so a picker that is
   * closed without choosing leaves no trace anywhere.
   */
  async startScreen(
    quality: VideoQuality,
    wantAudio: boolean,
  ): Promise<VoiceStreamResult | null> {
    if (this.channelId === null || this.disposed) return null;
    this.releaseCapture();

    const generation = this.generation;
    const capture = await captureScreen(quality, wantAudio, this.screenPrefs.surface);
    if (this.disposed || generation !== this.generation || this.channelId === null) {
      for (const track of capture.stream.getTracks()) track.stop();
      return null;
    }
    this.capture = capture;
    hintContent(capture.video, this.screenPrefs.priority);

    // The platform keeps a stop control of its own, outside this window: a bar
    // across the screen, a menu bar item, an indicator in the tray. It is very
    // often the one somebody reaches for, and the track ending is the only
    // notice it gives.
    capture.video.addEventListener("ended", () => {
      if (this.capture !== capture) return;
      void this.stopScreen();
      this.handlers.onScreenEnded();
    });

    let result: VoiceStreamResult;
    try {
      result = await this.transport.stream({
        active: true,
        quality,
        audio: capture.audio !== null,
        source: capture.source,
      });
    } catch (error) {
      this.releaseCapture();
      throw error;
    }
    if (this.disposed || generation !== this.generation) {
      this.releaseCapture();
      return null;
    }

    this.screenQuality = result.quality;
    await constrain(capture.video, result.quality);
    // Sections opened for an earlier share are still there and are not offered
    // again, so nothing would arrive to fill them. Filling them here is what
    // makes the second share as immediate as the first.
    this.attachCapture();
    this.applyScreenParameters();
    this.handlers.onOwnScreen(capture.stream);
    return result;
  }

  /**
   * Puts the current capture onto every section already opened for it.
   *
   * It is the half of starting a share that does not need anybody to offer
   * anything: the sections survive a share ending, so starting another is a
   * track going back onto a sender that was always there.
   */
  private attachCapture(): void {
    if (!this.capture) return;
    for (const link of this.links.values()) {
      if (link.closed) continue;
      for (const [purpose, transceiver] of link.outgoing) {
        const track = this.captureTrack(purpose);
        if (!track) continue;
        void transceiver.sender.replaceTrack(track).catch(() => {});
        link.owners.set(transceiver.sender, { userId: this.selfId, purpose });
      }
      // A host sends its own screen to watchers as an ordinary track rather
      // than through a section somebody offered it, so those are put back too.
      let changed = false;
      for (const viewerId of this.viewers.get(this.selfId) ?? []) {
        if (viewerId !== link.peerId) continue;
        for (const purpose of SCREEN_PURPOSES) {
          const before = link.forwards.size;
          this.forward(link, this.selfId, purpose, this.capture.stream);
          changed = changed || link.forwards.size !== before;
        }
      }
      if (changed) void this.negotiate(link);
    }
  }

  /** Stops sharing. Safe to call when nothing is being shared. */
  async stopScreen(): Promise<void> {
    const had = this.capture !== null;
    this.releaseCapture();
    if (!had) return;
    try {
      await this.transport.stream({ active: false, audio: false });
    } catch {
      // The share is over here whatever the server says, and a disconnected
      // socket is the usual reason this fails. The server ends it too the
      // moment this session goes.
    }
  }

  /**
   * Changes the quality of a share that is already running.
   *
   * The picker is not shown again and the capture is not restarted: somebody
   * who has been talking over a shared window for ten minutes does not have to
   * find it again because they turned the frame rate down.
   */
  async changeScreenQuality(quality: VideoQuality): Promise<VoiceStreamResult | null> {
    const capture = this.capture;
    if (!capture) return null;
    const result = await this.transport.stream({
      active: true,
      quality,
      audio: capture.audio !== null,
      source: capture.source,
    });
    this.screenQuality = result.quality;
    await constrain(capture.video, result.quality);
    this.applyScreenParameters();
    return result;
  }

  /** Takes fresh screen preferences, applying what a live share can take. */
  applyScreenPreferences(prefs: ScreenPreferences): void {
    const previous = this.screenPrefs;
    this.screenPrefs = prefs;
    if (!this.capture) return;
    if (previous.priority !== prefs.priority) {
      hintContent(this.capture.video, prefs.priority);
    }
    this.applyScreenParameters();
  }

  /** Asks for, or gives up, one participant's screen. */
  async watchScreen(userId: number, watching: boolean): Promise<void> {
    if (this.channelId === null) return;
    await this.transport.watch({ userId, watching });
    if (watching) {
      this.watching.add(userId);
      return;
    }
    this.watching.delete(userId);
    // Whoever is carrying it takes the track away, which ends it here. Doing
    // it eagerly as well means the picture goes the moment the button is
    // pressed rather than a round trip later.
    for (const purpose of SCREEN_PURPOSES) {
      if (this.incoming.delete(slot(userId, purpose))) this.absent(userId, purpose);
    }
  }

  /**
   * Opens the sections a participant needs to send this host their screen.
   *
   * Only a relaying host does this, and it is the mirror of what the server's
   * relay does in the other mode: offer to receive, and let the far end answer
   * by sending. It is also why a screen share never has two offerers.
   */
  private openSlots(userId: number, audio: boolean): void {
    const link = this.links.get(userId);
    if (!link || link.closed) return;
    if (this.ensureSlots(link, audio)) void this.negotiate(link);
  }

  /**
   * Adds the sections without offering them, and reports whether any were
   * added.
   *
   * Dialling somebody who is already sharing needs this: the sections have to
   * go on before the one offer that link ever starts with, rather than causing
   * a second offer a moment later. It is also the ordinary path, where an
   * announcement arrives on a link that has been up for an hour.
   */
  private ensureSlots(link: PeerLink, audio: boolean): boolean {
    let added = false;
    for (const purpose of SCREEN_PURPOSES) {
      if (purpose === "screen_audio" && !audio) continue;
      if (link.slots.has(purpose)) continue;
      try {
        const transceiver = link.pc.addTransceiver(purpose === "screen" ? "video" : "audio", {
          direction: "recvonly",
        });
        link.slots.set(purpose, transceiver);
        added = true;
      } catch {
        // A section that cannot be opened leaves that one person unable to
        // share on that one link, and nothing else about the call changes.
      }
    }
    return added;
  }

  /** The local track a purpose is carried by, if there is one. */
  private captureTrack(purpose: TrackPurpose): MediaStreamTrack | null {
    if (!this.capture) return null;
    return purpose === "screen" ? this.capture.video : this.capture.audio;
  }

  private screenCodec(): Exclude<ScreenPreferences["codec"], "auto"> {
    const quality = this.screenQuality ?? { height: 1080, framerate: 30, bitrate: 0 };
    const resolved = resolveCodec(this.screenPrefs, quality);
    return resolved === "auto" ? "vp9" : resolved;
  }

  /**
   * Bounds and shapes what a shared screen costs.
   *
   * The bitrate is the ceiling the server agreed to. The frame rate is a
   * second ceiling on the encoder rather than on the capture, which matters
   * when a platform would not rescale the capture itself. The degradation
   * preference is the interesting one: it is where the choice between a sharp
   * still picture and a smooth moving one is actually made, and it is the
   * single setting that decides whether shared text stays readable when the
   * connection tightens.
   */
  private applyScreenParameters(): void {
    const quality = this.screenQuality;
    if (!quality) return;
    const degradationPreference = degradationFor(this.screenPrefs.priority);

    for (const link of this.links.values()) {
      for (const [sender, owner] of link.owners) {
        if (owner.userId !== this.selfId || owner.purpose !== "screen") continue;
        const parameters = sender.getParameters();
        const encodings = parameters.encodings?.length ? parameters.encodings : [{}];
        encodings[0] = {
          ...encodings[0],
          maxBitrate: quality.bitrate,
          maxFramerate: quality.framerate,
        };
        void sender
          .setParameters({ ...parameters, encodings, degradationPreference })
          .catch(() => {
            // A browser that will not take these keeps its own defaults, which
            // are a camera's and merely worse rather than wrong.
          });
      }
    }
  }

  /** Lets go of the capture and everything sending it. */
  private releaseCapture(): void {
    const capture = this.capture;
    this.capture = null;
    this.screenQuality = null;
    if (!capture) return;

    for (const link of this.links.values()) {
      for (const transceiver of link.outgoing.values()) {
        if (link.owners.get(transceiver.sender)?.userId !== this.selfId) continue;
        void transceiver.sender.replaceTrack(null).catch(() => {});
        link.owners.delete(transceiver.sender);
      }
      // A host was also sending its own screen to whoever was watching it, and
      // those are ordinary senders rather than answered sections.
      let changed = false;
      for (const purpose of SCREEN_PURPOSES) {
        changed = this.unforward(link, this.selfId, purpose) || changed;
      }
      if (changed) void this.negotiate(link);
    }

    for (const track of capture.stream.getTracks()) track.stop();
    this.handlers.onOwnScreen(null);
  }

  // --- session ---------------------------------------------------------------

  private async openSession(): Promise<void> {
    const channelId = this.channelId;
    const config = this.config;
    if (channelId === null || !config) return;

    const generation = ++this.generation;
    this.setStatus(this.reconnects > 0 ? "reconnecting" : "connecting", null);

    try {
      await this.ensureMicrophone();
      this.handlers.onMicrophone(null);
    } catch (error) {
      // Without a microphone this client can still listen, which is worth
      // having: somebody with no working input belongs in the channel just as
      // much as anybody else. The failure is reported and the session opens
      // anyway.
      this.handlers.onMicrophone(classifyMicrophoneFailure(error));
    }
    if (generation !== this.generation || this.disposed) return;

    try {
      if (this.mode === "server_host") {
        await this.openServerHosted(generation, channelId);
      } else {
        await this.openClientHosted(generation, channelId);
      }
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.teardownMedia();
      this.setStatus("reconnecting", messageOf(error));
      this.scheduleReconnect(false);
      return;
    }

    if (generation !== this.generation || this.disposed) return;
    this.reconnects = 0;
    this.setStatus("connected", null);
    this.startLatencySampling();
    void this.restoreScreen(generation);
  }

  private async openServerHosted(generation: number, channelId: number): Promise<void> {
    const link = this.createLink(SERVER_PEER, false);
    this.attachLocalTrack(link);

    const offer = await link.pc.createOffer();
    offer.sdp = this.munge(offer.sdp);
    await link.pc.setLocalDescription(offer);
    if (generation !== this.generation) return;

    const result = await this.transport.connect({
      channelId,
      sdp: link.pc.localDescription?.sdp ?? offer.sdp,
    });
    if (generation !== this.generation) return;
    this.applyResult(result);

    if (!result.sdp) throw new Error("The server did not answer the voice session.");
    await link.pc.setRemoteDescription({ type: "answer", sdp: result.sdp });
    await link.flushCandidates();
    await this.drainHeld(SERVER_PEER);
    this.applyBitrate();
  }

  private async openClientHosted(generation: number, channelId: number): Promise<void> {
    const result = await this.transport.connect({ channelId });
    if (generation !== this.generation) return;
    this.applyResult(result);

    // Nothing else happens here. Either this client was elected, in which case
    // it waits to be told who to dial, or it was not, in which case it waits
    // for the host's offer. Both arrive as events.
    if (this.hostUserId === this.selfId) {
      for (const participant of result.participants) {
        if (participant.userId !== this.selfId && participant.connected) {
          await this.dial(participant.userId);
        }
      }
    }
    await this.drainHeld(this.hostUserId ?? SERVER_PEER);
  }

  private applyResult(result: VoiceConnectResult): void {
    this.mode = result.mode;
    this.config = result.voice;
    if (result.iceServers.length > 0) this.iceServers = result.iceServers;
    this.epoch = result.hostEpoch ?? this.epoch;
    this.hostUserId = result.hostUserId ?? null;
    this.handlers.onHost(this.hostUserId);

    const streams = (result.streams ?? []).filter((entry) => entry.active);
    this.streamers = new Set(streams.map((entry) => entry.userId));
    this.handlers.onStreams(streams);
  }

  /**
   * Announces a screen share this client is already running, on a session that
   * has just been rebuilt.
   *
   * A reset clears the share on the server, because the media session that
   * carried it is gone. The capture is not gone, so re-announcing it is what
   * makes a share survive a host handover or a reconnection rather than
   * quietly ending in one — which is the moment somebody is least likely to be
   * looking at their own window to notice.
   */
  private async restoreScreen(generation: number): Promise<void> {
    const capture = this.capture;
    const quality = this.screenQuality;
    if (!capture || !quality) return;
    try {
      const result = await this.transport.stream({
        active: true,
        quality,
        audio: capture.audio !== null,
        source: capture.source,
      });
      if (generation !== this.generation || this.disposed) return;
      this.screenQuality = result.quality;
      await constrain(capture.video, result.quality);
      this.applyScreenParameters();
    } catch {
      // The share is over as far as the server is concerned, and the capture
      // this client is still holding would be a lie. Letting go of it is what
      // makes the interface agree with what everybody else can see.
      this.releaseCapture();
    }
  }

  // --- peers -----------------------------------------------------------------

  private createLink(peerId: number, offering: boolean): PeerLink {
    this.links.get(peerId)?.close();

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers.map((server) => ({
        urls: server.urls,
        username: server.username,
        credential: server.credential,
      })),
      // One transport for everything, which is what a relay expects and what
      // keeps a call to one port rather than one per track.
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });
    const link = new PeerLink(peerId, pc, offering);
    this.links.set(peerId, link);

    pc.onicecandidate = (event) => {
      void this.transport
        .signal({
          targetId: peerId,
          kind: event.candidate ? "candidate" : "end",
          candidate: event.candidate ? toCandidate(event.candidate) : undefined,
        })
        .catch(() => {
          // A candidate that could not be sent is one path not tried. ICE has
          // others, and a socket that is down is already being handled.
        });
    };

    pc.ontrack = (event) => this.receiveTrack(link, event);

    pc.onconnectionstatechange = () => {
      if (link.closed) return;
      if (pc.connectionState === "failed") {
        this.linkFailed(link);
      }
    };

    if (offering) {
      pc.onnegotiationneeded = () => {
        void this.negotiate(link);
      };
    }
    return link;
  }

  private attachLocalTrack(link: PeerLink): void {
    if (link.sending || !this.mic) return;
    const sender = link.pc.addTrack(this.mic.track, this.mic.stream);
    link.owners.set(sender, { userId: this.selfId, purpose: "mic" });
    link.sending = true;
  }

  /** The host opening a connection to one participant. */
  private async dial(peerId: number): Promise<void> {
    if (peerId === this.selfId) return;
    // A peer can be named twice — once in the reply that elected this host and
    // once by the event that followed it — and redialling would throw away a
    // connection that is already coming up.
    const existing = this.links.get(peerId);
    if (existing && !existing.closed) return;

    const link = this.createLink(peerId, true);
    this.attachLocalTrack(link);

    // Everything this host already hears goes on the new link, minus the
    // person it belongs to: nobody is sent their own voice back. Screens are
    // not among it — an arrival is watching nobody yet, and a picture is only
    // ever sent to somebody who asked for it.
    for (const [key, stream] of this.incoming) {
      const owner = parseSlot(key);
      if (!owner || owner.purpose !== "mic" || owner.userId === peerId) continue;
      this.forward(link, owner.userId, owner.purpose, stream);
    }
    // Somebody who was already sharing when this host dialled them needs a
    // section to send it on, and it belongs in this first offer rather than in
    // a second one a moment later. It is the case a host handover always hits:
    // everybody re-announces a share the instant their session is rebuilt.
    if (this.streamers.has(peerId)) this.ensureSlots(link, true);
    await this.negotiate(link);
    await this.drainHeld(peerId);
  }

  /**
   * Puts one participant's media onto one link. Host only.
   *
   * A picture forwarded this way is decoded and encoded again by this machine,
   * which is what a browser does with any remote track it passes on. That is
   * the honest price of hosting a channel on somebody's desktop, and it is the
   * same price the audio has always paid; it is also why a host sends a screen
   * only to the people who asked for one.
   */
  private forward(
    link: PeerLink,
    userId: number,
    purpose: TrackPurpose,
    stream: MediaStream,
  ): void {
    const key = slot(userId, purpose);
    if (link.closed || link.forwards.has(key)) return;
    const track =
      purpose === "screen" ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
    if (!track) return;
    try {
      const sender = link.pc.addTrack(track, stream);
      link.forwards.set(key, sender);
      link.owners.set(sender, { userId, purpose });
    } catch {
      // A track that cannot be added leaves that one person unheard, or
      // unseen, on that one link. The rest of the channel is unaffected, and
      // the next negotiation picks it up.
    }
  }

  /** Takes one participant's media back off one link. Host only. */
  private unforward(link: PeerLink, userId: number, purpose: TrackPurpose): boolean {
    const key = slot(userId, purpose);
    const sender = link.forwards.get(key);
    if (!sender) return false;
    link.forwards.delete(key);
    link.owners.delete(sender);
    try {
      link.pc.removeTrack(sender);
    } catch {
      // The connection is already going away.
    }
    return true;
  }

  private async negotiate(link: PeerLink): Promise<void> {
    if (!link.offering || link.closed) return;
    if (!link.beginNegotiation()) return;

    try {
      const offer = await link.pc.createOffer();
      offer.sdp = this.munge(offer.sdp);
      await link.pc.setLocalDescription(offer);
      link.armTimeout(() => this.linkFailed(link));
      const sections = this.describeSections(link);
      await this.transport.signal({
        targetId: link.peerId,
        kind: "offer",
        sdp: link.pc.localDescription?.sdp ?? offer.sdp,
        tracks: sections?.tracks,
        purposes: sections?.purposes,
      });
    } catch (error) {
      link.endNegotiation();
      this.linkFailed(link, messageOf(error));
      return;
    }
  }

  private async acceptOffer(event: VoiceSignalEvent): Promise<void> {
    if (!event.sdp) return;
    // Only the elected host offers in client_host mode, and only the relay
    // does in server_host. Anything else is a client trying to build a
    // topology the server has not agreed to carry.
    if (this.mode === "client_host" && event.fromUserId !== this.hostUserId) return;
    if (this.mode === "server_host" && event.fromUserId !== SERVER_PEER) return;

    let link = this.links.get(event.fromUserId);
    if (!link || link.closed) {
      link = this.createLink(event.fromUserId, false);
    }
    if (event.tracks) {
      link.mids = new Map(Object.entries(event.tracks).map(([mid, userId]) => [mid, userId]));
    }
    if (event.purposes) {
      link.purposes = new Map(Object.entries(event.purposes));
    }

    try {
      await link.pc.setRemoteDescription({ type: "offer", sdp: event.sdp });
      await link.flushCandidates();
      // The microphone goes on after the remote description, so it lands on a
      // section the offer already described rather than adding one the
      // answer is not allowed to invent. A screen goes on the same way, onto
      // a section the far end opened precisely so that it could.
      this.attachLocalTrack(link);
      this.fillOfferedSlots(link);

      const answer = await link.pc.createAnswer();
      answer.sdp = this.munge(answer.sdp);
      await link.pc.setLocalDescription(answer);
      await this.transport.signal({
        targetId: event.fromUserId,
        kind: "answer",
        sdp: link.pc.localDescription?.sdp ?? answer.sdp,
      });
      this.applyBitrate();
    } catch (error) {
      this.linkFailed(link, messageOf(error));
    }
  }

  private async acceptAnswer(link: PeerLink, event: VoiceSignalEvent): Promise<void> {
    if (!event.sdp) return;
    try {
      await link.pc.setRemoteDescription({ type: "answer", sdp: event.sdp });
      await link.flushCandidates();
      this.applyBitrate();
    } catch (error) {
      link.endNegotiation();
      this.linkFailed(link, messageOf(error));
      return;
    }
    if (link.endNegotiation()) {
      await this.negotiate(link);
    }
  }

  private receiveTrack(link: PeerLink, event: RTCTrackEvent): void {
    const owner = this.identify(link, event);
    if (!owner || owner.userId === this.selfId) return;
    const { userId, purpose } = owner;

    const stream = event.streams[0] ?? new MediaStream([event.track]);
    const key = slot(userId, purpose);
    this.incoming.set(key, stream);
    this.present(userId, purpose, stream);

    event.track.addEventListener("ended", () => {
      if (this.incoming.get(key) !== stream) return;
      this.incoming.delete(key);
      this.absent(userId, purpose);
      this.stopForwarding(userId, purpose);
    });

    // A host has to pass what it just received on to everybody else, which is
    // the entirety of what makes it the host. A voice goes to the whole
    // channel; a screen goes only to whoever asked for it.
    if (this.mode === "client_host" && this.hostUserId === this.selfId) {
      for (const other of this.links.values()) {
        if (other === link || other.closed || other.peerId === userId) continue;
        if (purpose !== "mic" && !this.viewers.get(other.peerId)?.has(userId)) continue;
        this.forward(other, userId, purpose, stream);
        void this.negotiate(other);
      }
    }
  }

  /** Hands one arriving stream to whatever plays or draws it. */
  private present(userId: number, purpose: TrackPurpose, stream: MediaStream): void {
    switch (purpose) {
      case "mic":
        this.playback.attach(userId, stream);
        this.handlers.onAudio(userId, true);
        return;
      case "screen_audio":
        this.playback.attach(userId, stream, "screen");
        return;
      case "screen":
        this.handlers.onScreen(userId, stream);
        return;
    }
  }

  /** Undoes that. */
  private absent(userId: number, purpose: TrackPurpose): void {
    switch (purpose) {
      case "mic":
        this.playback.detach(userId);
        this.handlers.onAudio(userId, false);
        return;
      case "screen_audio":
        this.playback.detach(userId, "screen");
        return;
      case "screen":
        this.handlers.onScreen(userId, null);
        return;
    }
  }

  /** Takes one person's media off every link this host was relaying it on. */
  private stopForwarding(userId: number, purpose: TrackPurpose): void {
    for (const other of this.links.values()) {
      if (this.unforward(other, userId, purpose)) void this.negotiate(other);
    }
  }

  /**
   * Works out whose media a track carries, and which of their media it is.
   *
   * Whoever offered said so, in the two maps that travel with an offer, and
   * that is the answer wherever it is available. The stream id is the fallback
   * and agrees with it: the server's relay builds its own tracks and names
   * them, so a client older or newer than the maps still finds the audio.
   */
  private identify(link: PeerLink, event: RTCTrackEvent): TrackOwner | null {
    // A section this side opened for the far end to publish a screen on is
    // known by the transceiver it was opened on, and nothing else could tell:
    // the far end answers a section it did not name, a voice and a screen's
    // sound are both audio, and the kind of the track distinguishes neither.
    // Only a relaying host has any of these.
    for (const [purpose, transceiver] of link.slots) {
      if (event.transceiver === transceiver) return { userId: link.peerId, purpose };
    }

    const mid = event.transceiver?.mid;
    if (mid) {
      const userId = link.mids.get(mid);
      const purpose = link.purposes.get(mid);
      if (userId !== undefined) return { userId, purpose: purpose ?? defaultPurpose(event) };
    }
    for (const stream of event.streams) {
      const parsed = /^(av|sc|sa)-(\d+)$/.exec(stream.id);
      if (!parsed) continue;
      const purpose: TrackPurpose =
        parsed[1] === "sc" ? "screen" : parsed[1] === "sa" ? "screen_audio" : "mic";
      return { userId: Number(parsed[2]), purpose };
    }
    // On a link to exactly one other person, anything arriving is theirs.
    if (link.peerId !== SERVER_PEER) {
      return { userId: link.peerId, purpose: defaultPurpose(event) };
    }
    return null;
  }

  /**
   * What each media section of an offer is, built after the offer is set.
   *
   * It describes both directions at once. A section naming the far end itself
   * is a slot this side has opened for them to publish a screen on — this
   * client offers to receive, they answer by sending — and every other section
   * is media travelling the usual way. Only a relaying host produces the first
   * kind; in `server_host` the relay does that and this client only ever
   * reads these maps.
   */
  private describeSections(
    link: PeerLink,
  ): { tracks: Record<string, number>; purposes: Record<string, TrackPurpose> } | undefined {
    if (this.mode !== "client_host") return undefined;
    const tracks: Record<string, number> = {};
    const purposes: Record<string, TrackPurpose> = {};

    const slots = new Map<RTCRtpTransceiver, TrackPurpose>();
    for (const [purpose, transceiver] of link.slots) slots.set(transceiver, purpose);

    for (const transceiver of link.pc.getTransceivers()) {
      const mid = transceiver.mid;
      if (!mid) continue;
      const asSlot = slots.get(transceiver);
      if (asSlot) {
        tracks[mid] = link.peerId;
        purposes[mid] = asSlot;
        continue;
      }
      const owner = link.owners.get(transceiver.sender);
      if (owner) {
        tracks[mid] = owner.userId;
        purposes[mid] = owner.purpose;
      }
    }
    return Object.keys(tracks).length > 0 ? { tracks, purposes } : undefined;
  }

  /**
   * Puts this client's screen onto the sections the far end opened for it.
   *
   * A section naming this client is an invitation to send: the offer described
   * it as receive-only, so answering with anything else would be answering a
   * question that was not asked. Turning it around and attaching the capture
   * is the whole of how a screen share starts, in either hosting mode.
   */
  private fillOfferedSlots(link: PeerLink): void {
    for (const transceiver of link.pc.getTransceivers()) {
      const mid = transceiver.mid;
      if (!mid) continue;
      if (link.mids.get(mid) !== this.selfId) continue;
      const purpose = link.purposes.get(mid);
      if (purpose !== "screen" && purpose !== "screen_audio") continue;

      link.outgoing.set(purpose, transceiver);
      const track = this.captureTrack(purpose);
      if (!track) {
        // Nothing to send yet, which happens when a share was stopped between
        // the offer being made and it arriving. The section stays and is
        // filled the moment there is something to fill it with.
        transceiver.direction = "inactive";
        continue;
      }
      transceiver.direction = "sendonly";
      if (purpose === "screen") preferCodec(transceiver, this.screenCodec());
      void transceiver.sender.replaceTrack(track).catch(() => {
        // A sender that will not take the track leaves this one link without
        // the picture; the next negotiation tries again.
      });
      link.owners.set(transceiver.sender, { userId: this.selfId, purpose });
    }
    this.applyScreenParameters();
  }

  private dropPeer(userId: number): void {
    const link = this.links.get(userId);
    if (link) {
      link.close();
      this.links.delete(userId);
    }
    for (const purpose of MEDIA_PURPOSES) {
      if (this.incoming.delete(slot(userId, purpose))) this.absent(userId, purpose);
      // Stop sending them to everybody else, if this client was relaying them.
      this.stopForwarding(userId, purpose);
    }
    this.streamers.delete(userId);
    this.watching.delete(userId);
    this.viewers.delete(userId);
    for (const audience of this.viewers.values()) audience.delete(userId);
    this.held.delete(userId);
  }

  /**
   * A link that gave up.
   *
   * Which link it is decides what happens. The one carrying this client's own
   * audio — the relay, or the host — means the session is over and is rebuilt.
   * One of a host's outgoing links means one participant fell off, and they
   * will come back on their own; the rest of the channel keeps talking.
   */
  private linkFailed(link: PeerLink, reason?: string): void {
    if (link.closed || this.channelId === null) return;

    const essential =
      link.peerId === SERVER_PEER ||
      (this.mode === "client_host" && this.hostUserId !== this.selfId);

    if (!essential) {
      this.dropPeer(link.peerId);
      return;
    }
    this.teardownMedia();
    this.setStatus("reconnecting", reason ?? null);
    this.scheduleReconnect(false);
  }

  private hold(event: VoiceSignalEvent): void {
    const queue = this.held.get(event.fromUserId) ?? [];
    // A queue that grows without bound would be a way to spend this client's
    // memory from another one, so it is capped at more frames than any
    // handshake needs.
    if (queue.length >= 64) return;
    queue.push(event);
    this.held.set(event.fromUserId, queue);
  }

  private async drainHeld(peerId: number): Promise<void> {
    const queue = this.held.get(peerId);
    if (!queue) return;
    this.held.delete(peerId);
    for (const event of queue) {
      await this.handleSignal(event);
    }
  }

  // --- microphone ------------------------------------------------------------

  private async ensureMicrophone(): Promise<void> {
    if (this.mic) {
      await this.mic.resume();
      return;
    }
    const mic = await Microphone.open(this.settings.capture);
    if (this.disposed) {
      mic.close();
      return;
    }
    this.mic = mic;
    mic.setInputVolume(this.settings.inputVolume);
    this.micOff = mic.onLevel((level) => {
      this.handlers.onLevel(level);
      this.evaluateGate(level);
    });
    this.evaluateGate(0);
    this.reportDenoising();
  }

  /** Tells the interface which suppressor the open microphone actually has. */
  private reportDenoising(): void {
    this.handlers.onDenoising(this.mic?.denoising ?? false);
  }

  private async reopenMicrophone(): Promise<void> {
    const mic = this.mic;
    if (!mic) return;
    try {
      await mic.reconfigure(this.settings.capture);
      return;
    } catch {
      // Some browsers cannot swap the device underneath a live track. Opening
      // a new microphone and replacing it on every sender does the same job,
      // and does not need renegotiating because the codec has not changed.
    }

    let replacement: Microphone;
    try {
      replacement = await Microphone.open(this.settings.capture);
    } catch (error) {
      this.handlers.onMicrophone(classifyMicrophoneFailure(error));
      return;
    }
    this.handlers.onMicrophone(null);

    this.closeMicrophone();
    this.mic = replacement;
    replacement.setInputVolume(this.settings.inputVolume);
    this.micOff = replacement.onLevel((level) => {
      this.handlers.onLevel(level);
      this.evaluateGate(level);
    });
    this.evaluateGate(0);
    this.reportDenoising();

    for (const link of this.links.values()) {
      for (const [sender, owner] of link.owners) {
        if (owner.userId !== this.selfId || owner.purpose !== "mic") continue;
        void sender.replaceTrack(replacement.track).catch(() => {});
      }
    }
  }

  private closeMicrophone(): void {
    this.micOff?.();
    this.micOff = null;
    this.mic?.close();
    this.mic = null;
    this.gate.reset();
    if (this.transmitting) {
      this.transmitting = false;
      this.handlers.onSpeaking(false);
      void this.transport.speaking(false).catch(() => {});
    }
  }

  /** Decides whether the microphone should be open right now, and says so. */
  private evaluateGate(level: number): void {
    if (!this.mic) return;

    let open: boolean;
    if (this.muted) {
      open = false;
      this.gate.reset();
    } else if (this.settings.mode === "ptt") {
      open = this.pushing;
    } else {
      open = this.gate.push(level);
    }

    this.mic.setOpen(open);
    if (open === this.transmitting) return;
    this.transmitting = open;
    this.handlers.onSpeaking(open);
    // A failed speaking frame costs an indicator somewhere else and nothing
    // more; the audio is already flowing or not on its own.
    void this.transport.speaking(open).catch(() => {});
  }

  // --- plumbing --------------------------------------------------------------

  private munge(sdp: string | undefined): string | undefined {
    if (!sdp || !this.config) return sdp;
    return applyOpusPreferences(sdp, opusPreferences(this.config, this.settings.bitrate));
  }

  /**
   * Bounds what this client sends.
   *
   * The description bounds what arrives; this bounds what leaves, which is the
   * half the browser actually enforces. It is reapplied after every
   * negotiation because a new sender starts without it.
   */
  private applyBitrate(): void {
    const maxBitrate = this.settings.bitrate;
    for (const link of this.links.values()) {
      for (const sender of link.pc.getSenders()) {
        if (!sender.track || sender.track.kind !== "audio") continue;
        // A screen's sound is not a voice and is not bounded by the voice
        // bitrate: it is music and effects at full bandwidth, and holding it
        // to what speech needs would be the loudest possible way to be wrong.
        if (link.owners.get(sender)?.purpose === "screen_audio") continue;
        const parameters = sender.getParameters();
        const encodings = parameters.encodings?.length ? parameters.encodings : [{}];
        encodings[0] = { ...encodings[0], maxBitrate };
        void sender.setParameters({ ...parameters, encodings }).catch(() => {
          // Not every browser lets an audio sender's parameters be set. The
          // ceiling in the description still applies, which is the half that
          // matters most on a slow uplink.
        });
      }
    }
  }

  private teardownMedia(): void {
    this.stopLatencySampling();
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.held.clear();
    for (const key of this.incoming.keys()) {
      const owner = parseSlot(key);
      if (owner) this.absent(owner.userId, owner.purpose);
    }
    this.incoming.clear();
    // The capture itself survives: a session being rebuilt is not a decision
    // to stop sharing, and the tracks go back onto the new links as soon as
    // the far end offers the sections for them.
  }

  private scheduleReconnect(jitter: boolean): void {
    this.cancelReconnect();
    if (this.channelId === null || this.disposed) return;

    if (this.reconnects >= RECONNECT_DELAYS_MS.length) {
      this.setStatus("failed", "Voice could not be restored.");
      return;
    }
    let delay = RECONNECT_DELAYS_MS[this.reconnects] ?? RECONNECT_DELAYS_MS[0]!;
    this.reconnects += 1;
    if (jitter) {
      // A whole channel is told to start over at the same instant, and all of
      // it racing to be the next host would make the election a coin toss
      // between whoever the network happened to favour. Spreading the attempts
      // makes it the person who was already there.
      delay += Math.floor(Math.random() * 400);
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSession();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: VoiceStatus, error: string | null): void {
    this.status = status;
    this.handlers.onStatus(status, error);
  }

  // --- latency ---------------------------------------------------------------

  /**
   * Starts sampling the round trip on the peer connections.
   *
   * ICE measures this for free — every connection keeps the round trip of the
   * candidate pair it settled on — so nothing has to be sent to find it out.
   * All this does is read the number the transport already has, which is why
   * it can afford to do so every two seconds: the figure is about the call
   * happening now, and one that lagged half a minute behind would be worse
   * than none.
   */
  private startLatencySampling(): void {
    this.stopLatencySampling();
    void this.sampleLatency();
    this.latencyTimer = setInterval(() => void this.sampleLatency(), LATENCY_SAMPLE_MS);
  }

  private stopLatencySampling(): void {
    if (this.latencyTimer !== null) {
      clearInterval(this.latencyTimer);
      this.latencyTimer = null;
    }
    this.handlers.onLatency(null);
  }

  private async sampleLatency(): Promise<void> {
    const generation = this.generation;
    const links = [...this.links.values()];
    if (links.length === 0) {
      this.handlers.onLatency(null);
      return;
    }

    let worst: number | null = null;
    for (const link of links) {
      const rtt = await roundTripOf(link.pc);
      // The session may have been torn down and rebuilt while these were
      // being read, and reporting the old one's numbers over the new one's
      // would be worse than skipping a sample.
      if (generation !== this.generation || this.disposed) return;
      if (rtt !== null && (worst === null || rtt > worst)) worst = rtt;
    }
    this.handlers.onLatency(worst);
  }
}

/** How often the peer connections are asked what their round trip is. */
const LATENCY_SAMPLE_MS = 2_000;

/**
 * The round trip of one peer connection in milliseconds, or null.
 *
 * The candidate pair in use is the authority: it is the path the audio takes,
 * and its round trip is measured by ICE's own checks rather than inferred.
 * `remote-inbound-rtp` is the fallback, because a pair reports nothing until
 * enough checks have gone by, while RTCP reports as soon as media flows.
 */
async function roundTripOf(pc: RTCPeerConnection): Promise<number | null> {
  let report: RTCStatsReport;
  try {
    report = await pc.getStats();
  } catch {
    // A connection closed underneath the call.
    return null;
  }

  let pairSeconds: number | null = null;
  let rtcpSeconds: number | null = null;
  report.forEach((entry) => {
    const stat = entry as { type?: string; state?: string; currentRoundTripTime?: number; roundTripTime?: number };
    if (stat.type === "candidate-pair" && stat.state === "succeeded" && typeof stat.currentRoundTripTime === "number") {
      // Several pairs can read as succeeded after a route change; the live one
      // is whichever is answering fastest.
      if (pairSeconds === null || stat.currentRoundTripTime < pairSeconds) {
        pairSeconds = stat.currentRoundTripTime;
      }
    } else if (stat.type === "remote-inbound-rtp" && typeof stat.roundTripTime === "number") {
      rtcpSeconds = stat.roundTripTime;
    }
  });

  const seconds: number | null = pairSeconds ?? rtcpSeconds;
  return seconds === null ? null : Math.round(seconds * 1000);
}

/** Everything one participant can be the source of. */
const MEDIA_PURPOSES: readonly TrackPurpose[] = ["mic", "screen", "screen_audio"];

/** The two halves of a screen share. */
const SCREEN_PURPOSES: readonly TrackPurpose[] = ["screen", "screen_audio"];

function parseSlot(key: string): TrackOwner | null {
  const divider = key.indexOf(":");
  if (divider === -1) return null;
  const userId = Number(key.slice(0, divider));
  const purpose = key.slice(divider + 1) as TrackPurpose;
  if (!Number.isFinite(userId) || !MEDIA_PURPOSES.includes(purpose)) return null;
  return { userId, purpose };
}

/**
 * What an unlabelled track is, judged only by its kind.
 *
 * It is the last resort, for a track that arrived with no map and no
 * recognisable stream id. Video can only be a screen — there is no camera
 * here — and audio is far more likely to be a voice than the sound of one.
 */
function defaultPurpose(event: RTCTrackEvent): TrackPurpose {
  return event.track.kind === "video" ? "screen" : "mic";
}

function sameCapture(a: CaptureOptions, b: CaptureOptions): boolean {
  return (
    a.deviceId === b.deviceId &&
    a.echoCancellation === b.echoCancellation &&
    a.noiseSuppression === b.noiseSuppression &&
    a.autoGainControl === b.autoGainControl
  );
}

/** An ICE candidate in the shape the protocol carries it. */
function toCandidate(candidate: RTCIceCandidate): ICECandidateInitLike {
  const json = candidate.toJSON();
  return {
    candidate: json.candidate ?? candidate.candidate,
    sdpMid: json.sdpMid,
    sdpMLineIndex: json.sdpMLineIndex,
    usernameFragment: json.usernameFragment,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyMicrophoneFailure(error: unknown): MicrophoneFailure {
  return error instanceof MicrophoneError ? error.reason : "unknown";
}
