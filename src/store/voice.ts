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
  type VoiceConfig,
  type VoiceHostEvent,
  type VoicePeerEvent,
  type VoiceResetEvent,
  type VoiceSignalEvent,
  type VoiceState,
} from "@/lib/protocol";
import { listDevices, type AudioDevices, type MicrophoneFailure } from "@/lib/voice/audio";
import { VoiceEngine, type EngineSettings, type VoiceStatus } from "@/lib/voice/engine";
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
   * This client's own voice state on the server carrying the call.
   *
   * It is the one entry of that server's map this store needs: the engine
   * enforces a mute it did not choose, and the buttons read what the server
   * says rather than what was asked for.
   */
  own: VoiceState | null;
  /** Whose audio is actually arriving here. */
  audible: Set<number>;

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
        },
      handlers: {
          onStatus: (status, error) => set({ status, notice: error }),
          onLevel: (level) => {
            if (get().meterActive) set({ level });
          },
          onSpeaking: (speaking) => link?.onSelfSpeaking(speaking),
          onHost: (hostUserId) => set({ hostUserId }),
          onAudio: (userId, present) => markAudible(userId, present),
          onMicrophone: (micError) => set({ micError }),
          onDenoising: (denoising) => set({ denoising }),
        },
      },
      settings(prefs, config),
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
    own: null,
    audible: new Set(),
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

      set({ audible: new Set() });
      engine = buildEngine();
      watchKeyboard();

      if (navigator.mediaDevices) {
        const onChange = () => void get().refreshDevices();
        navigator.mediaDevices.addEventListener("devicechange", onChange);
        deviceWatchOff = () =>
          navigator.mediaDevices.removeEventListener("devicechange", onChange);
      }
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
        own: null,
        audible: new Set(),
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

      void engine.join(channelId, config, iceServers).catch((error: unknown) => {
        set({ status: "failed", notice: describeError(error) });
      });
      syncOwnState();
    },

    exit() {
      set({ channelId: null, hostUserId: null, level: 0 });
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
