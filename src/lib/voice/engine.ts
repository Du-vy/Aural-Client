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
  type VoiceConfig,
  type VoiceConnectRequest,
  type VoiceConnectResult,
  type VoiceHostEvent,
  type VoiceMode,
  type VoicePeerEvent,
  type VoiceSignalEvent,
  type VoiceSignalRequest,
  type VoiceState,
} from "@/lib/protocol";
import {
  ActivityGate,
  Microphone,
  MicrophoneError,
  Playback,
  type CaptureOptions,
  type MicrophoneFailure,
} from "./audio";
import { applyOpusPreferences, opusPreferences } from "./sdp";
import type { InputMode } from "./settings";

/** Where a media session is in its life. */
export type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting" | "failed";

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

  /** Media ids to the user whose audio they carry, as the far end named them. */
  mids = new Map<string, number>();
  /** Forwarded senders, by the user whose audio they carry. Host only. */
  forwards = new Map<number, RTCRtpSender>();
  /** The user each of this side's senders carries, for the map sent with an offer. */
  owners = new Map<RTCRtpSender, number>();
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
  /** Each participant's audio as it arrives, which is what a host forwards. */
  private incoming = new Map<number, MediaStream>();

  private settings: EngineSettings;
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
  private disposed = false;

  constructor(options: EngineOptions, settings: EngineSettings) {
    this.selfId = options.selfId;
    this.transport = options.transport;
    this.handlers = options.handlers;
    this.settings = settings;
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
    this.teardownMedia();
    this.setStatus("reconnecting", null);
    this.scheduleReconnect(true);
  }

  /** Somebody left the channel, so their audio and their link go with them. */
  handleParticipantGone(userId: number): void {
    this.dropPeer(userId);
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
    link.owners.set(sender, this.selfId);
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
    // person it belongs to: nobody is sent their own voice back.
    for (const [userId, stream] of this.incoming) {
      if (userId === peerId) continue;
      this.forward(link, userId, stream);
    }
    await this.negotiate(link);
    await this.drainHeld(peerId);
  }

  /** Puts one participant's audio onto one link. Host only. */
  private forward(link: PeerLink, userId: number, stream: MediaStream): void {
    if (link.closed || link.forwards.has(userId)) return;
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    try {
      const sender = link.pc.addTrack(track, stream);
      link.forwards.set(userId, sender);
      link.owners.set(sender, userId);
    } catch {
      // A track that cannot be added leaves that one person unheard on that
      // one link. The rest of the channel is unaffected, and the next
      // negotiation picks it up.
    }
  }

  private async negotiate(link: PeerLink): Promise<void> {
    if (!link.offering || link.closed) return;
    if (!link.beginNegotiation()) return;

    try {
      const offer = await link.pc.createOffer();
      offer.sdp = this.munge(offer.sdp);
      await link.pc.setLocalDescription(offer);
      link.armTimeout(() => this.linkFailed(link));
      await this.transport.signal({
        targetId: link.peerId,
        kind: "offer",
        sdp: link.pc.localDescription?.sdp ?? offer.sdp,
        tracks: this.trackMap(link),
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

    try {
      await link.pc.setRemoteDescription({ type: "offer", sdp: event.sdp });
      await link.flushCandidates();
      // The microphone goes on after the remote description, so it lands on a
      // section the offer already described rather than adding one the
      // answer is not allowed to invent.
      this.attachLocalTrack(link);

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
    const userId = this.identify(link, event);
    if (userId === null || userId === this.selfId) return;

    const stream = event.streams[0] ?? new MediaStream([event.track]);
    this.incoming.set(userId, stream);
    this.playback.attach(userId, stream);
    this.handlers.onAudio(userId, true);

    event.track.addEventListener("ended", () => {
      if (this.incoming.get(userId) === stream) {
        this.incoming.delete(userId);
        this.playback.detach(userId);
        this.handlers.onAudio(userId, false);
      }
    });

    // A host has to pass what it just received on to everybody else, which is
    // the entirety of what makes it the host.
    if (this.mode === "client_host" && this.hostUserId === this.selfId) {
      for (const other of this.links.values()) {
        if (other === link || other.closed || other.peerId === userId) continue;
        this.forward(other, userId, stream);
        void this.negotiate(other);
      }
    }
  }

  /**
   * Works out whose audio a track carries.
   *
   * The relay says so in the stream id, because it builds the tracks itself. A
   * relaying browser cannot: forwarding somebody else's track gives no way to
   * rename it, so the host sends a map from media id to user alongside its
   * offer, and that is what is read here.
   */
  private identify(link: PeerLink, event: RTCTrackEvent): number | null {
    const mid = event.transceiver?.mid;
    if (mid) {
      const mapped = link.mids.get(mid);
      if (mapped !== undefined) return mapped;
    }
    for (const stream of event.streams) {
      const parsed = /^av-(\d+)$/.exec(stream.id);
      if (parsed) return Number(parsed[1]);
    }
    // On a link to exactly one other person, anything arriving is theirs.
    if (link.peerId !== SERVER_PEER) return link.peerId;
    return null;
  }

  /** The media-id map that travels with an offer, built after it is set. */
  private trackMap(link: PeerLink): Record<string, number> | undefined {
    if (this.mode !== "client_host") return undefined;
    const map: Record<string, number> = {};
    for (const transceiver of link.pc.getTransceivers()) {
      const owner = link.owners.get(transceiver.sender);
      if (owner !== undefined && transceiver.mid) map[transceiver.mid] = owner;
    }
    return Object.keys(map).length > 0 ? map : undefined;
  }

  private dropPeer(userId: number): void {
    const link = this.links.get(userId);
    if (link) {
      link.close();
      this.links.delete(userId);
    }
    if (this.incoming.delete(userId)) {
      this.playback.detach(userId);
      this.handlers.onAudio(userId, false);
    }
    // Stop sending them to everybody else, if this client was relaying them.
    for (const other of this.links.values()) {
      const sender = other.forwards.get(userId);
      if (!sender) continue;
      other.forwards.delete(userId);
      other.owners.delete(sender);
      try {
        other.pc.removeTrack(sender);
      } catch {
        // The connection is already going away.
      }
      void this.negotiate(other);
    }
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
        if (owner !== this.selfId) continue;
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
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.held.clear();
    for (const userId of this.incoming.keys()) {
      this.playback.detach(userId);
      this.handlers.onAudio(userId, false);
    }
    this.incoming.clear();
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
