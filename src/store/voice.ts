/**
 * The voice store: one media session and everything the interface draws about
 * it.
 *
 * It is deliberately downstream of a connection rather than beside it.
 * `connection.ts` owns the socket, hands this store a way to talk over it, and
 * forwards the signalling it receives; nothing here reaches back. That is what
 * keeps the two from importing each other, and it means a client with no
 * microphone, or a server with no audio plane, simply never wakes this up.
 *
 * There is one of these however many servers are open, because there is one
 * microphone. What is *not* here is who is in which voice channel: user ids
 * are per server, so that lives in each connection, and only the call itself
 * is singular. Which connection holds it is decided in `servers.ts`.
 */

import { create } from "zustand";

import {
  Ev,
  Op,
  describeError,
  type ICEServer,
  type VideoQuality,
  type VoiceConfig,
  type VoiceHostEvent,
  type VoicePeerEvent,
  type VoiceResetEvent,
  type VoiceSignalEvent,
  type VoiceState,
  type VoiceStreamEvent,
  type VoiceWatchEvent,
} from "@/lib/protocol";
import { listDevices, type AudioDevices, type MicrophoneFailure } from "@/lib/voice/audio";
import { VoiceEngine, type EngineSettings, type VoiceStatus } from "@/lib/voice/engine";
import {
  ScreenError,
  clampQuality,
  readScreenPreferences,
  requestedQuality,
  writeScreenPreferences,
  type ScreenFailure,
  type ScreenPreferences,
} from "@/lib/voice/screen";
import {
  DEFAULT_PREFERENCES,
  readPreferences,
  readUserVolumes,
  resolveBitrate,
  setUserVolume as storeUserVolume,
  userVolume,
  writePreferences,
  type UserVolumes,
  type VoicePreferences,
} from "@/lib/voice/settings";

/** What a connection hands over so this store can talk to its server. */
export interface VoiceLink {
  selfId: number;
  /** The saved-server id, which is what per-person volumes are keyed by. */
  serverId: string | null;
  request<T>(op: string, payload?: unknown): Promise<T>;
  /**
   * The engine's own account of whether this client is transmitting.
   *
   * It goes back to the connection because that is where everybody's speaking
   * state is kept, and this one is the only entry that does not arrive as an
   * event: the microphone knows sooner and more accurately than a round trip.
   */
  onSelfSpeaking(speaking: boolean): void;
}

interface VoiceStoreState {
  /** The channel audio is open in, which is not always the channel you sit in. */
  channelId: number | null;
  status: VoiceStatus;
  /** Something worth telling somebody about the session, or null. */
  notice: string | null;
  /** Why this client has no microphone, or null. It outlives the status. */
  micError: MicrophoneFailure | null;
  /**
   * Whether RNNoise is in the graph, or null before a microphone has opened.
   *
   * `false` while RNNoise is the chosen suppressor means it was asked for and
   * could not be had, which is the one case worth showing.
   */
  denoising: boolean | null;
  mode: VoiceConfig["mode"] | null;
  hostUserId: number | null;
  /**
   * The round trip on the slowest link of the call, in milliseconds, or null
   * before there is anything to measure.
   *
   * It is kept apart from the connection's own latency because the two are
   * genuinely different distances: audio in `client_host` mode never touches
   * the server, so a call can be quick on a server that is far away, or slow
   * on one that is next door.
   */
  latencyMs: number | null;

  /**
   * This client's own voice state on the server carrying the call.
   *
   * It is the one entry of that server's map this store needs: the engine
   * enforces a mute it did not choose, and the buttons read what the server
   * says rather than what was asked for.
   */
  own: VoiceState | null;
  /** Whose audio is actually arriving here. */
  audible: Set<number>;

  /**
   * Every screen share running in the channel, by whose it is.
   *
   * It is the whole of what the interface needs to draw a live badge and a
   * label saying what somebody is sharing, and it is deliberately separate
   * from `screens`: knowing a stream exists and having been sent it are two
   * different things, and only the second costs anybody bandwidth.
   */
  streams: Map<number, VoiceStreamEvent>;
  /** The pictures actually arriving here, by whose they are. */
  screens: Map<number, MediaStream>;
  /** Whose screens this client has asked for. */
  watching: Set<number>;
  /** A user whose screen should be watched as soon as the stream/session is ready. */
  pendingWatch: number | null;
  /** Who is watching whose, so a stream can say how many people are looking. */
  viewers: Map<number, Set<number>>;
  /** This client's own capture, for the preview, or null when not sharing. */
  ownScreen: MediaStream | null;
  /** The quality the server allowed for this client's share. */
  ownQuality: VideoQuality | null;
  /** Why a capture did not happen, or null. `cancelled` is not worth showing. */
  screenError: ScreenFailure | null;
  screenPrefs: ScreenPreferences;

  /** The local microphone level, only while something is watching it. */
  level: number;
  meterActive: boolean;

  prefs: VoicePreferences;
  volumes: UserVolumes;
  devices: AudioDevices;
  /** What the server will carry, once it has said. */
  config: VoiceConfig | null;

  /** Wiring, called by the connection that carries the call. */
  attach(
    link: VoiceLink,
    config: VoiceConfig | undefined,
    iceServers: ICEServer[],
    own: VoiceState | null,
  ): void;
  detach(): void;
  /**
   * The connection carrying the call has fresh audio configuration.
   *
   * An operator editing what the server carries reaches every client this way,
   * and switching who relays has to reach a call that is already up: the two
   * modes are different topologies, not different settings.
   */
  serverConfigChanged(config: VoiceConfig | undefined): void;
  /** Signalling only: presence is the connection's, not this store's. */
  handleEvent(op: string, payload: unknown): void;
  /** This client's own voice state changed on the server carrying the call. */
  setOwnState(state: VoiceState | null): void;
  /** This client entered or left a voice channel, however it got there. */
  enter(channelId: number): void;
  exit(): void;
  /** Somebody else is no longer in this client's voice channel. */
  participantGone(userId: number): void;

  /** Actions the interface calls. */
  setPreferences(patch: Partial<VoicePreferences>): void;
  setScreenPreferences(patch: Partial<ScreenPreferences>): void;
  /**
   * Starts sharing a screen. The platform's own picker decides which one, so
   * this resolves only once somebody has chosen — or immediately, having done
   * nothing at all, when they close it.
   */
  startScreen(): Promise<void>;
  stopScreen(): Promise<void>;
  /** Changes the quality of a share that is already running. */
  applyScreenQuality(): Promise<void>;
  /** Asks for, or gives up, one participant's screen. */
  watchScreen(userId: number, watching: boolean): Promise<void>;
  /** Sets a pending stream to watch as soon as the session/stream becomes available. */
  setPendingWatch(userId: number | null): void;
  /** How many people are watching one participant's screen. */
  viewerCount(userId: number): number;
  setUserVolume(userId: number, percent: number, serverId?: string | null): void;
  volumeFor(userId: number, serverId?: string | null): number;
  toggleMute(): Promise<void>;
  toggleDeafen(): Promise<void>;
  moderate(userId: number, patch: { mute?: boolean; deaf?: boolean }): Promise<void>;
  refreshDevices(): Promise<void>;
  /**
   * Opens the microphone again after it failed.
   *
   * Whatever was in the way — a permission just granted, another application
   * just closed, a cable just plugged in — was fixed outside this window, so
   * nothing that happens inside it can notice on its own.
   */
  retryMicrophone(): Promise<void>;
  setMeterActive(active: boolean): void;
  /** The voice state of this client, if it has one. Reads `own`. */
  self(): VoiceState | null;
}

/** Whether two server configurations would have anything here behave differently. */
function sameVoiceConfig(a: VoiceConfig, b: VoiceConfig): boolean {
  return (
    a.enabled === b.enabled &&
    a.mode === b.mode &&
    a.sampleRate === b.sampleRate &&
    a.bitrate === b.bitrate &&
    a.minBitrate === b.minBitrate &&
    a.maxBitrate === b.maxBitrate &&
    a.fec === b.fec &&
    a.dtx === b.dtx &&
    a.stereo === b.stereo &&
    a.maxParticipants === b.maxParticipants &&
    a.screen.enabled === b.screen.enabled &&
    a.screen.audio === b.screen.audio &&
    a.screen.enforced === b.screen.enforced &&
    a.screen.maxHeight === b.screen.maxHeight &&
    a.screen.maxFramerate === b.screen.maxFramerate &&
    a.screen.maxBitrate === b.screen.maxBitrate &&
    a.screen.maxStreams === b.screen.maxStreams &&
    a.screen.maxViewers === b.screen.maxViewers
  );
}

/**
 * The engine and the link live outside the store: they are machinery, not
 * state the interface renders, and putting them in it would have every render
 * compare a peer connection.
 */
let engine: VoiceEngine | null = null;
let link: VoiceLink | null = null;
let iceServers: ICEServer[] = [];
let keyboardOff: (() => void) | null = null;
let deviceWatchOff: (() => void) | null = null;

export const useVoice = create<VoiceStoreState>((set, get) => {
  function settings(prefs: VoicePreferences, config: VoiceConfig | null): EngineSettings {
    return {
      capture: {
        deviceId: prefs.inputDeviceId,
        echoCancellation: prefs.echoCancellation,
        noiseSuppression: prefs.noiseSuppression,
        autoGainControl: prefs.autoGainControl,
      },
      inputVolume: prefs.inputVolume,
      outputVolume: prefs.outputVolume,
      outputDeviceId: prefs.outputDeviceId,
      mode: prefs.mode,
      threshold: prefs.threshold,
      bitrate: resolveBitrate(prefs, config ?? undefined),
    };
  }

  /** Holds one arriving picture, or lets go of it. */
  function setScreen(userId: number, stream: MediaStream | null): void {
    const screens = new Map(get().screens);
    if (stream) screens.set(userId, stream);
    else if (!screens.delete(userId)) return;
    set({ screens });
  }

  function markAudible(userId: number, present: boolean): void {
    const current = get().audible;
    if (current.has(userId) === present) return;
    const next = new Set(current);
    if (present) next.add(userId);
    else next.delete(userId);
    set({ audible: next });
  }

  /** Applies the caller's own voice state to the engine, which enforces it. */
  function syncOwnState(): void {
    const own = get().self();
    engine?.applyOwnState(own ?? undefined);
  }

  function buildEngine(): VoiceEngine | null {
    if (!link) return null;
    const { prefs, config } = get();
    const built = new VoiceEngine(
      {
        selfId: link.selfId,
        transport: {
          connect: (request) => link!.request(Op.VoiceConnect, request),
          signal: (request) => link!.request(Op.VoiceSignal, request),
          leave: () => link!.request(Op.VoiceLeave, {}),
          speaking: (speaking) => link!.request(Op.VoiceSpeaking, { speaking }),
          stream: (request) => link!.request(Op.VoiceStream, request),
          watch: (request) => link!.request(Op.VoiceWatch, request),
        },
      handlers: {
          onStatus: (status, error) => set({ status, notice: error }),
          onLevel: (level) => {
            if (get().meterActive) set({ level });
          },
          onSpeaking: (speaking) => link?.onSelfSpeaking(speaking),
          onHost: (hostUserId) => set({ hostUserId }),
          onAudio: (userId, present) => markAudible(userId, present),
          onScreen: (userId, stream) => setScreen(userId, stream),
          onOwnScreen: (ownScreen) => set({ ownScreen }),
          onScreenEnded: () => set({ ownScreen: null, ownQuality: null }),
          onStreams: (streams) => {
            const map = new Map<number, VoiceStreamEvent>();
            for (const entry of streams) map.set(entry.userId, entry);
            set({ streams: map });
            const pending = get().pendingWatch;
            if (pending !== null && map.has(pending)) {
              set({ pendingWatch: null });
              void get().watchScreen(pending, true);
            }
          },
          onMicrophone: (micError) => set({ micError }),
          onDenoising: (denoising) => set({ denoising }),
          onLatency: (latencyMs) => {
            if (get().latencyMs !== latencyMs) set({ latencyMs });
          },
        },
      },
      settings(prefs, config),
      get().screenPrefs,
    );
    // Volumes set on a previous session apply to this one: they are a
    // preference about a person, not about a call.
    for (const [key, percent] of Object.entries(get().volumes)) {
      const [serverId, userId] = key.split(":");
      if (link && serverId === link.serverId) built.setUserVolume(Number(userId), percent);
    }
    return built;
  }

  /** Watches the keyboard while push-to-talk is the input mode. */
  function watchKeyboard(): void {
    keyboardOff?.();
    keyboardOff = null;
    if (get().prefs.mode !== "ptt") return;

    const key = get().prefs.pttKey;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;

    const isTyping = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable;
    };

    const down = (event: KeyboardEvent) => {
      if (event.code !== key || event.repeat) return;
      // A push-to-talk key that is also a letter must not swallow that letter
      // while somebody is writing a message.
      if (isTyping(event.target)) return;
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      engine?.setPushing(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== key) return;
      const delay = get().prefs.pttReleaseMs;
      if (releaseTimer !== null) clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        engine?.setPushing(false);
      }, delay);
    };
    // Losing focus with the key held would otherwise leave the microphone open
    // for as long as the window is away.
    const blur = () => {
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      engine?.setPushing(false);
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    keyboardOff = () => {
      if (releaseTimer !== null) clearTimeout(releaseTimer);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }

  return {
    channelId: null,
    status: "idle",
    notice: null,
    micError: null,
    denoising: null,
    mode: null,
    hostUserId: null,
    latencyMs: null,
    own: null,
    audible: new Set(),
    streams: new Map(),
    screens: new Map(),
    watching: new Set(),
    pendingWatch: null,
    viewers: new Map(),
    ownScreen: null,
    ownQuality: null,
    screenError: null,
    screenPrefs: readScreenPreferences(),
    level: 0,
    meterActive: false,
    prefs: readPreferences(),
    volumes: readUserVolumes(),
    devices: { inputs: [], outputs: [] },
    config: null,

    attach(nextLink, config, servers, own) {
      // A full snapshot arrives on every resync as well as on connecting, and
      // a resync is something an unrelated permission edit causes. Rebuilding
      // the engine there would cut off everybody's call because somebody
      // renamed a role, so the same identity on the same server keeps the
      // session it has and only its state is refreshed.
      const sameSession =
        engine !== null && link !== null && link.selfId === nextLink.selfId && link.serverId === nextLink.serverId;

      if (!sameSession) get().detach();
      link = nextLink;
      iceServers = servers;
      set({
        config: config ?? null,
        mode: config?.mode ?? null,
        own,
      });
      if (sameSession) {
        syncOwnState();
        return;
      }

      set({ audible: new Set(), streams: new Map(), screens: new Map(), watching: new Set(), viewers: new Map() });
      engine = buildEngine();
      watchKeyboard();

      if (navigator.mediaDevices) {
        const onChange = () => void get().refreshDevices();
        navigator.mediaDevices.addEventListener("devicechange", onChange);
        deviceWatchOff = () =>
          navigator.mediaDevices.removeEventListener("devicechange", onChange);
      }
    },

    serverConfigChanged(config) {
      if (!config || !engine) return;
      const previous = get().config;
      if (previous && sameVoiceConfig(previous, config)) return;
      set({ config, mode: config.mode });
      // The bitrate is derived from the preferences *and* the server's bounds,
      // so a narrower ceiling has to reach the encoder before the session that
      // will carry it is rebuilt.
      engine.reconfigure(config);
      void engine.apply(settings(get().prefs, config));
    },

    detach() {
      keyboardOff?.();
      keyboardOff = null;
      deviceWatchOff?.();
      deviceWatchOff = null;
      engine?.dispose();
      engine = null;
      link = null;
      iceServers = [];
      set({
        channelId: null,
        status: "idle",
        notice: null,
        micError: null,
        denoising: null,
        mode: null,
        hostUserId: null,
        latencyMs: null,
        own: null,
        audible: new Set(),
        streams: new Map(),
        screens: new Map(),
        watching: new Set(),
        pendingWatch: null,
        viewers: new Map(),
        ownScreen: null,
        ownQuality: null,
        screenError: null,
        level: 0,
        config: null,
      });
    },

    enter(channelId) {
      const { config } = get();
      // Presence arrives from more than one direction — the reply to a move,
      // the event that follows it, and the snapshot — so entering the channel
      // that is already open has to mean nothing rather than open it twice.
      if (get().channelId === channelId && get().status !== "idle" && get().status !== "failed") {
        return;
      }
      if (!engine || !config?.enabled) {
        // A server that carries no audio still lets people sit in a voice
        // channel. There is simply nothing to open.
        set({ channelId: null });
        return;
      }
      set({ channelId, notice: null, micError: null });

      // Joining muted is a preference about arriving, so it is applied on the
      // way in rather than left to somebody being quick with the button. It is
      // sent to the server like any other mute, and comes back as the state
      // everything else reads.
      if (get().prefs.joinMuted && !get().self()?.selfMute) {
        void link?.request(Op.VoiceState, { selfMute: true }).catch(() => {
          // The session is opening anyway; an unmuted arrival is the worst
          // this costs, and the button is right there.
        });
      }

      void engine
        .join(channelId, config, iceServers)
        .then(() => {
          const pending = get().pendingWatch;
          if (pending !== null && get().streams.has(pending)) {
            set({ pendingWatch: null });
            void get().watchScreen(pending, true);
          }
        })
        .catch((error: unknown) => {
          set({ status: "failed", notice: describeError(error), pendingWatch: null });
        });
      syncOwnState();
    },

    exit() {
      set({
        channelId: null,
        hostUserId: null,
        latencyMs: null,
        level: 0,
        streams: new Map(),
        screens: new Map(),
        watching: new Set(),
        viewers: new Map(),
        ownScreen: null,
        ownQuality: null,
        screenError: null,
        pendingWatch: null,
      });
      void engine?.leave();
    },

    participantGone(userId) {
      engine?.handleParticipantGone(userId);
      markAudible(userId, false);
    },

    setOwnState(state) {
      set({ own: state });
      syncOwnState();
    },

    handleEvent(op, payload) {
      switch (op) {
        case Ev.VoiceSignal:
          void engine?.handleSignal(payload as VoiceSignalEvent);
          return;

        case Ev.VoicePeer:
          void engine?.handlePeer(payload as VoicePeerEvent);
          return;

        case Ev.VoiceHost: {
          const event = payload as VoiceHostEvent;
          engine?.handleHost(event);
          if (get().channelId === event.channelId) set({ hostUserId: event.hostUserId });
          return;
        }

        case Ev.VoiceReset: {
          const event = payload as VoiceResetEvent;
          if (get().channelId !== event.channelId) return;
          engine?.handleReset();
          // Everything about who was sharing and who was watching went with
          // the room. The session that replaces it is handed the truth again,
          // in the reply to voice.connect, a moment from now.
          set({ streams: new Map(), screens: new Map(), watching: new Set(), viewers: new Map() });
          return;
        }

        case Ev.VoiceStream: {
          const event = payload as VoiceStreamEvent;
          if (get().channelId !== event.channelId) return;
          engine?.handleStream(event);

          const streams = new Map(get().streams);
          const screens = new Map(get().screens);
          const watching = new Set(get().watching);
          const viewers = new Map(get().viewers);
          if (event.active) {
            streams.set(event.userId, event);
          } else {
            streams.delete(event.userId);
            screens.delete(event.userId);
            watching.delete(event.userId);
            viewers.delete(event.userId);
          }
          set({ streams, screens, watching, viewers });
          // A share of this client's own that the server has ended — because
          // the session was rebuilt, or an administrator turned sharing off —
          // has to be let go of here too, or the button would still say stop.
          if (event.userId === link?.selfId && !event.active) {
            set({ ownScreen: null, ownQuality: null });
          }
          return;
        }

        case Ev.VoiceWatch: {
          const event = payload as VoiceWatchEvent;
          if (get().channelId !== event.channelId) return;
          engine?.handleWatch(event);

          const viewers = new Map(get().viewers);
          const audience = new Set(viewers.get(event.publisherId) ?? []);
          if (event.watching) audience.add(event.viewerId);
          else audience.delete(event.viewerId);
          viewers.set(event.publisherId, audience);

          const patch: Partial<VoiceStoreState> = { viewers };
          if (event.viewerId === link?.selfId) {
            const watching = new Set(get().watching);
            if (event.watching) watching.add(event.publisherId);
            else watching.delete(event.publisherId);
            patch.watching = watching;
            if (!event.watching) {
              const screens = new Map(get().screens);
              if (screens.delete(event.publisherId)) patch.screens = screens;
            }
          }
          set(patch);
          return;
        }

        default:
          return;
      }
    },

    setPreferences(patch) {
      const prefs = { ...get().prefs, ...patch };
      set({ prefs });
      writePreferences(prefs);
      void engine?.apply(settings(prefs, get().config));
      if (patch.mode !== undefined || patch.pttKey !== undefined) watchKeyboard();
    },

    setScreenPreferences(patch) {
      const screenPrefs = { ...get().screenPrefs, ...patch };
      set({ screenPrefs });
      writeScreenPreferences(screenPrefs);
      engine?.applyScreenPreferences(screenPrefs);
    },

    async startScreen() {
      if (!engine) return;
      set({ screenError: null });
      const quality = clampQuality(requestedQuality(get().screenPrefs), get().config?.screen);
      try {
        const result = await engine.startScreen(quality, get().screenPrefs.audio);
        if (result) set({ ownQuality: result.quality });
      } catch (error) {
        // Closing the picker without choosing is not a failure and is not
        // reported: the person who closed it knows they did, and a message
        // saying so would be the only sign anything had happened at all.
        const reason = error instanceof ScreenError ? error.reason : "unknown";
        if (reason !== "cancelled") set({ screenError: reason });
        set({ ownScreen: null, ownQuality: null });
      }
    },

    async stopScreen() {
      set({ ownScreen: null, ownQuality: null, screenError: null });
      await engine?.stopScreen();
    },

    async applyScreenQuality() {
      if (!engine?.sharing) return;
      const quality = clampQuality(requestedQuality(get().screenPrefs), get().config?.screen);
      try {
        const result = await engine.changeScreenQuality(quality);
        if (result) set({ ownQuality: result.quality });
      } catch {
        // The share carries on at whatever it was; the only thing lost is the
        // change, and the picker is still open to try again.
      }
    },

    async watchScreen(userId, watching) {
      if (!engine) return;
      await engine.watchScreen(userId, watching);
      const next = new Set(get().watching);
      if (watching) next.add(userId);
      else next.delete(userId);
      const screens = new Map(get().screens);
      if (!watching) screens.delete(userId);
      set({ watching: next, screens });
    },

    setPendingWatch(pendingWatch) {
      set({ pendingWatch });
      if (pendingWatch !== null && get().streams.has(pendingWatch)) {
        set({ pendingWatch: null });
        void get().watchScreen(pendingWatch, true);
      }
    },

    viewerCount(userId) {
      return get().viewers.get(userId)?.size ?? 0;
    },

    setUserVolume(userId, percent, serverId) {
      // A volume belongs to a person on a server, and the person being turned
      // down is not always on the server carrying the call: the member list of
      // whatever is on screen offers the same slider.
      const on = serverId ?? link?.serverId ?? null;
      if (!on) return;
      const volumes = storeUserVolume(get().volumes, on, userId, percent);
      set({ volumes });
      if (on === link?.serverId) engine?.setUserVolume(userId, percent);
    },

    volumeFor(userId, serverId) {
      return userVolume(get().volumes, serverId ?? link?.serverId ?? null, userId);
    },

    async toggleMute() {
      const own = get().self();
      // Muting works before audio is up, so somebody can join a channel already
      // muted rather than having to be quick about it.
      const selfMute = !(own?.selfMute ?? false);
      await link?.request(Op.VoiceState, { selfMute });
    },

    async toggleDeafen() {
      const own = get().self();
      const selfDeaf = !(own?.selfDeaf ?? false);
      // Un-deafening deliberately does not un-mute: the server treats them as
      // two choices, and undoing one must not quietly undo the other.
      await link?.request(Op.VoiceState, { selfDeaf, ...(selfDeaf ? { selfMute: true } : {}) });
    },

    async moderate(userId, patch) {
      await link?.request(Op.VoiceModerate, { userId, ...patch });
    },

    async retryMicrophone() {
      if (!engine) return;
      await engine.retryMicrophone();
      // A microphone that has just been allowed is also the moment the device
      // names stop being blank, so this is the cheapest place to pick them up.
      await get().refreshDevices();
    },

    async refreshDevices() {
      set({ devices: await listDevices() });
    },

    setMeterActive(active) {
      set({ meterActive: active, ...(active ? {} : { level: 0 }) });
    },

    self() {
      return get().own;
    },
  };
});

/** The preferences a fresh install starts from, for anything that resets them. */
export { DEFAULT_PREFERENCES };
