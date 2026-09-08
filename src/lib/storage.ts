/**
 * Saved servers, kept in localStorage.
 *
 * A saved server holds the session token the server minted for this device.
 * That token is a credential: anyone who can read this storage can resume the
 * identity. It is the same exposure a desktop client has in its configuration
 * file, and it is what lets a guest come back as the same person. Claiming an
 * account with a username and password is what makes an identity recoverable
 * once the token is gone.
 */

import { useState, useEffect } from "react";
import { parseAddress } from "./address";
import {
  DEFAULT_NOTIFICATION_SOUND,
  isNotificationSoundId,
  type NotificationSoundId,
} from "./notificationSounds";

const STORAGE_KEY = "aural.servers.v1";

export interface SavedServer {
  /** `host:port`, the stable identity of a saved entry. */
  id: string;
  /** Exactly what the user typed, so it can be shown back to them. */
  address: string;
  /** Last known server name, for the list before connecting. */
  name: string;
  /** Preferred nickname on this server. */
  nickname: string;
  /** Session token, when one has been issued to this device. */
  token?: string;
  /** Username, remembered to prefill the sign-in form. */
  username?: string;
  /** Server's icon absolute URL when saved. */
  icon?: string;
  lastConnectedAt?: number;
}

function read(): SavedServer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedServer);
  } catch {
    // A private window, cleared site data, or storage that throws outright.
    return [];
  }
}

function write(servers: SavedServer[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  } catch {
    // Storage is unavailable; the session still works, it just will not be
    // remembered.
  }
}

function isSavedServer(value: unknown): value is SavedServer {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.address === "string";
}

export function listServers(): SavedServer[] {
  return read().sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0));
}

export function getServer(id: string): SavedServer | undefined {
  return read().find((server) => server.id === id);
}

/** Inserts or merges a saved server, keyed by `host:port`. */
export function upsertServer(patch: Partial<SavedServer> & { id: string }): SavedServer[] {
  const servers = read();
  const index = servers.findIndex((server) => server.id === patch.id);

  if (index === -1) {
    servers.push({
      ...patch,
      id: patch.id,
      address: patch.address ?? patch.id,
      name: patch.name ?? patch.id,
      nickname: patch.nickname ?? "",
    });
  } else {
    servers[index] = { ...servers[index]!, ...patch };
  }

  write(servers);
  return listServers();
}

export function removeServer(id: string): SavedServer[] {
  write(read().filter((server) => server.id !== id));
  return listServers();
}

/** Forgets the session token of one server without forgetting the server. */
export function clearToken(id: string): SavedServer[] {
  const servers = read();
  const index = servers.findIndex((server) => server.id === id);
  if (index !== -1) {
    const { token: _token, ...rest } = servers[index]!;
    servers[index] = rest;
    write(servers);
  }
  return listServers();
}

/** The id a saved entry would take, or null when the address is unusable. */
export function serverIdFor(address: string): string | null {
  try {
    return parseAddress(address).label;
  } catch {
    return null;
  }
}

export const DEFAULT_SIDEBAR_WIDTH = 248;
export const MIN_SIDEBAR_WIDTH = 190;
export const MAX_SIDEBAR_WIDTH = 480;

const SIDEBAR_WIDTH_KEY = "aural.sidebar_width.v1";

export function readSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!raw) return DEFAULT_SIDEBAR_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
      return parsed;
    }
    return DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

export function writeSidebarWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // Storage is unavailable; nothing critical fails.
  }
}

/**
 * The random identifier this installation presents as part of its device
 * fingerprint. See `lib/device.ts` for what it is for and why it is hashed
 * with a per-server salt before it ever leaves.
 */
const INSTALL_ID_KEY = "aural.install_id.v1";

export function readInstallId(): string | null {
  try {
    return localStorage.getItem(INSTALL_ID_KEY);
  } catch {
    return null;
  }
}

export function writeInstallId(id: string): void {
  try {
    localStorage.setItem(INSTALL_ID_KEY, id);
  } catch {
    // A browser with storage switched off. The identifier is then whatever the
    // rest of the ingredients say, which is weaker and still not nothing.
  }
}

const LANGUAGE_KEY = "aural.language.v1";

export function readLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLanguage(lang: string): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    // Storage is unavailable; fallback in-memory works.
  }
}

const TRUSTED_DOMAINS_KEY = "aural.trusted_domains.v1";

export function readTrustedDomains(): string[] {
  try {
    const raw = localStorage.getItem(TRUSTED_DOMAINS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function addTrustedDomain(domain: string): void {
  try {
    const normalized = domain.trim().toLowerCase();
    if (!normalized) return;
    const current = readTrustedDomains();
    if (!current.includes(normalized)) {
      current.push(normalized);
      localStorage.setItem(TRUSTED_DOMAINS_KEY, JSON.stringify(current));
    }
  } catch {
    // Storage is unavailable
  }
}

export function isDomainTrusted(domain: string): boolean {
  const normalized = domain.trim().toLowerCase();
  if (!normalized) return false;
  const list = readTrustedDomains();
  return list.some((trusted) => normalized === trusted || normalized.endsWith(`.${trusted}`));
}

export type MessageDensity = "cozy" | "compact";
const DENSITY_KEY = "aural.density.v1";

export function readDensity(): MessageDensity {
  try {
    const raw = localStorage.getItem(DENSITY_KEY);
    return raw === "compact" ? "compact" : "cozy";
  } catch {
    return "cozy";
  }
}

export function writeDensity(density: MessageDensity): void {
  try {
    localStorage.setItem(DENSITY_KEY, density);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-density", density);
    }
  } catch {
    // Storage is unavailable
  }
}

export function initDensity(): MessageDensity {
  const density = readDensity();
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-density", density);
  }
  return density;
}

const ANIMATIONS_KEY = "aural.animations.v1";

export function readAnimations(): boolean {
  try {
    const raw = localStorage.getItem(ANIMATIONS_KEY);
    return raw !== "disabled";
  } catch {
    return true;
  }
}

export function writeAnimations(enabled: boolean): void {
  try {
    localStorage.setItem(ANIMATIONS_KEY, enabled ? "enabled" : "disabled");
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-animations", enabled ? "enabled" : "disabled");
    }
  } catch {
    // Storage is unavailable
  }
}

export function initAnimations(): boolean {
  const enabled = readAnimations();
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-animations", enabled ? "enabled" : "disabled");
  }
  return enabled;
}

/* --- Border Radius & UI Scale settings (client-side) ------------------------ */

export type BorderRadiusStyle = "sharp" | "compact" | "modern" | "round";
const BORDER_RADIUS_KEY = "aural.border_radius.v1";

export function readBorderRadius(): BorderRadiusStyle {
  try {
    const raw = localStorage.getItem(BORDER_RADIUS_KEY);
    if (raw === "sharp" || raw === "compact" || raw === "modern" || raw === "round") {
      return raw;
    }
    return "modern";
  } catch {
    return "modern";
  }
}

export function writeBorderRadius(style: BorderRadiusStyle): void {
  try {
    localStorage.setItem(BORDER_RADIUS_KEY, style);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-border-radius", style);
    }
  } catch {
    // Storage is unavailable
  }
}

export function initBorderRadius(): BorderRadiusStyle {
  const style = readBorderRadius();
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-border-radius", style);
  }
  return style;
}

export type UIScale = 80 | 90 | 100 | 110 | 125;
const UI_SCALE_KEY = "aural.ui_scale.v1";

export function readUIScale(): UIScale {
  try {
    const raw = localStorage.getItem(UI_SCALE_KEY);
    if (!raw) return 100;
    const parsed = Number(raw);
    if ([80, 90, 100, 110, 125].includes(parsed)) {
      return parsed as UIScale;
    }
    return 100;
  } catch {
    return 100;
  }
}

export function writeUIScale(scale: UIScale): void {
  try {
    localStorage.setItem(UI_SCALE_KEY, String(scale));
    if (typeof document !== "undefined") {
      document.documentElement.style.zoom = `${scale}%`;
    }
  } catch {
    // Storage is unavailable
  }
}

export function initUIScale(): UIScale {
  const scale = readUIScale();
  if (typeof document !== "undefined") {
    document.documentElement.style.zoom = `${scale}%`;
  }
  return scale;
}

/* --- Chat & Message settings (client-side) ---------------------------------- */

export type TimeFormat = "auto" | "12h" | "24h";
const TIME_FORMAT_KEY = "aural.time_format.v1";

export function readTimeFormat(): TimeFormat {
  try {
    const raw = localStorage.getItem(TIME_FORMAT_KEY);
    if (raw === "12h" || raw === "24h" || raw === "auto") return raw;
    return "auto";
  } catch {
    return "auto";
  }
}

const timeFormatListeners = new Set<(format: TimeFormat) => void>();

export function onTimeFormatChanged(listener: (format: TimeFormat) => void): () => void {
  timeFormatListeners.add(listener);
  return () => {
    timeFormatListeners.delete(listener);
  };
}

export function writeTimeFormat(format: TimeFormat): void {
  try {
    localStorage.setItem(TIME_FORMAT_KEY, format);
  } catch {
    // Storage is unavailable
  }
  for (const listener of timeFormatListeners) listener(format);
}

const JUMBO_EMOJI_KEY = "aural.jumbo_emoji.v1";

export function readJumboEmoji(): boolean {
  try {
    const raw = localStorage.getItem(JUMBO_EMOJI_KEY);
    return raw !== "disabled";
  } catch {
    return true;
  }
}

const jumboEmojiListeners = new Set<(enabled: boolean) => void>();

export function onJumboEmojiChanged(listener: (enabled: boolean) => void): () => void {
  jumboEmojiListeners.add(listener);
  return () => {
    jumboEmojiListeners.delete(listener);
  };
}

export function writeJumboEmoji(enabled: boolean): void {
  try {
    localStorage.setItem(JUMBO_EMOJI_KEY, enabled ? "enabled" : "disabled");
  } catch {
    // Storage is unavailable
  }
  for (const listener of jumboEmojiListeners) listener(enabled);
}

/* --- Profile cosmetics settings (client-side) ------------------------------- */

export type AvatarFrameId =
  | "none"
  | "accent-ring"
  | "gradient-glow"
  | "neon-pulse"
  | "cyber-bracket"
  | "double-ring"
  | "golden-star";

import type {
  FrameStyleId,
  FrameAnimationId,
  FrameColorMode,
  CustomAvatarFrame,
} from "./protocol";

export type {
  FrameStyleId,
  FrameAnimationId,
  FrameColorMode,
  CustomAvatarFrame,
};

export interface ProfileCosmetics {
  themeColor?: string;
  avatarFrame?: AvatarFrameId;
  customFrame?: CustomAvatarFrame;
}

const PROFILE_COSMETICS_KEY = "aural.profile_cosmetics.v1";

export function resolveAvatarFrameConfig(cosmetics: ProfileCosmetics): {
  style: FrameStyleId;
  color?: string;
  color2?: string;
  animation: FrameAnimationId;
} {
  if (cosmetics.customFrame && cosmetics.customFrame.style) {
    const cf = cosmetics.customFrame;
    let color = cosmetics.themeColor;
    let color2: string | undefined = undefined;

    if (cf.colorMode === "custom") {
      color = cf.customColor || "#12b8a0";
    } else if (cf.colorMode === "gradient") {
      color = cf.customColor || "#00f2fe";
      color2 = cf.customColor2 || "#8b5cf6";
    } else {
      color = cosmetics.themeColor;
    }

    return {
      style: cf.style,
      color,
      color2,
      animation: cf.animation || "none",
    };
  }

  // Fallback / legacy preset mapping
  switch (cosmetics.avatarFrame) {
    case "accent-ring":
      return { style: "ring", color: cosmetics.themeColor, animation: "none" };
    case "gradient-glow":
      return { style: "glow", color: "#00f2fe", color2: "#8b5cf6", animation: "spin" };
    case "neon-pulse":
      return { style: "neon", color: cosmetics.themeColor, animation: "pulse" };
    case "cyber-bracket":
      return { style: "cyber", color: cosmetics.themeColor, animation: "shimmer" };
    case "double-ring":
      return { style: "double", color: cosmetics.themeColor, animation: "none" };
    case "golden-star":
      return { style: "crown", color: cosmetics.themeColor, animation: "shimmer" };
    default:
      return { style: "none", color: cosmetics.themeColor, animation: "none" };
  }
}

export function readProfileCosmetics(): ProfileCosmetics {
  try {
    const raw = localStorage.getItem(PROFILE_COSMETICS_KEY);
    if (!raw) return { avatarFrame: "none", customFrame: { style: "none", colorMode: "profile", animation: "none" } };
    const parsed = JSON.parse(raw) as Partial<ProfileCosmetics>;
    return {
      themeColor: parsed.themeColor,
      avatarFrame: parsed.avatarFrame || "none",
      customFrame: parsed.customFrame || {
        style: parsed.avatarFrame && parsed.avatarFrame !== "none"
          ? (parsed.avatarFrame === "accent-ring" ? "ring"
            : parsed.avatarFrame === "gradient-glow" ? "glow"
            : parsed.avatarFrame === "neon-pulse" ? "neon"
            : parsed.avatarFrame === "cyber-bracket" ? "cyber"
            : parsed.avatarFrame === "double-ring" ? "double"
            : "crown")
          : "none",
        colorMode: "profile",
        animation: parsed.avatarFrame === "gradient-glow" ? "spin"
          : parsed.avatarFrame === "neon-pulse" ? "pulse"
          : parsed.avatarFrame === "cyber-bracket" || parsed.avatarFrame === "golden-star" ? "shimmer"
          : "none",
      },
    };
  } catch {
    return { avatarFrame: "none", customFrame: { style: "none", colorMode: "profile", animation: "none" } };
  }
}

const profileCosmeticsListeners = new Set<(cosmetics: ProfileCosmetics) => void>();

export function onProfileCosmeticsChanged(
  listener: (cosmetics: ProfileCosmetics) => void,
): () => void {
  profileCosmeticsListeners.add(listener);
  return () => {
    profileCosmeticsListeners.delete(listener);
  };
}

export function writeProfileCosmetics(patch: Partial<ProfileCosmetics>): ProfileCosmetics {
  const current = readProfileCosmetics();
  const updated: ProfileCosmetics = { ...current, ...patch };
  try {
    localStorage.setItem(PROFILE_COSMETICS_KEY, JSON.stringify(updated));
  } catch {
    // Storage is unavailable
  }
  for (const listener of profileCosmeticsListeners) listener(updated);
  return updated;
}

/* --- Sound pack settings (client-side) -------------------------------------- */

export type SoundPackId = "default" | "retro" | "scifi" | "soft";
const SOUND_PACK_KEY = "aural.sound_pack.v1";

export function readSoundPack(): SoundPackId {
  try {
    const raw = localStorage.getItem(SOUND_PACK_KEY);
    if (raw === "retro" || raw === "scifi" || raw === "soft" || raw === "default") {
      return raw;
    }
    return "default";
  } catch {
    return "default";
  }
}

const soundPackListeners = new Set<(pack: SoundPackId) => void>();

export function onSoundPackChanged(listener: (pack: SoundPackId) => void): () => void {
  soundPackListeners.add(listener);
  return () => {
    soundPackListeners.delete(listener);
  };
}

export function writeSoundPack(pack: SoundPackId): void {
  try {
    localStorage.setItem(SOUND_PACK_KEY, pack);
  } catch {
    // Storage is unavailable
  }
  for (const listener of soundPackListeners) listener(pack);
}

/* --- Accessibility settings (client-side) ----------------------------------- */

const ACCESSIBILITY_KEY = "aural.accessibility.v1";

export interface AccessibilitySettings {
  doubleClickToJoinVoice: boolean;
  confirmVoiceDisconnect: boolean;
  sendWithCtrlEnter: boolean;
  alwaysUnderlineLinks: boolean;
  reduceTransparency: boolean;
  /** Pauses GIFs and animated images when the app is in the background to save GPU/CPU. */
  pauseAnimatedImagesOnBlur: boolean;
  micAudioCues: boolean;
  voiceAudioCues: boolean;
  voiceParticipantCues: boolean;
}

export const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  doubleClickToJoinVoice: false,
  confirmVoiceDisconnect: false,
  sendWithCtrlEnter: false,
  alwaysUnderlineLinks: false,
  reduceTransparency: false,
  pauseAnimatedImagesOnBlur: true,
  micAudioCues: false,
  voiceAudioCues: true,
  voiceParticipantCues: true,
};

export function readAccessibility(): AccessibilitySettings {
  try {
    const raw = localStorage.getItem(ACCESSIBILITY_KEY);
    if (!raw) return { ...DEFAULT_ACCESSIBILITY };
    const parsed = JSON.parse(raw) as Partial<AccessibilitySettings>;
    return {
      ...DEFAULT_ACCESSIBILITY,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_ACCESSIBILITY };
  }
}

const accessibilityListeners = new Set<(settings: AccessibilitySettings) => void>();

export function onAccessibilityChanged(listener: (settings: AccessibilitySettings) => void): () => void {
  accessibilityListeners.add(listener);
  return () => {
    accessibilityListeners.delete(listener);
  };
}

export function writeAccessibility(settings: Partial<AccessibilitySettings>): AccessibilitySettings {
  try {
    const current = readAccessibility();
    const updated: AccessibilitySettings = { ...current, ...settings };
    localStorage.setItem(ACCESSIBILITY_KEY, JSON.stringify(updated));
    applyAccessibilityAttributes(updated);
    for (const listener of accessibilityListeners) {
      listener(updated);
    }
    return updated;
  } catch {
    return { ...DEFAULT_ACCESSIBILITY, ...settings };
  }
}

function applyAccessibilityAttributes(settings: AccessibilitySettings): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(
    "data-underline-links",
    settings.alwaysUnderlineLinks ? "true" : "false"
  );
  document.documentElement.setAttribute(
    "data-reduce-transparency",
    settings.reduceTransparency ? "true" : "false"
  );
  document.documentElement.setAttribute(
    "data-pause-animated-blur",
    settings.pauseAnimatedImagesOnBlur ? "true" : "false"
  );
}

export function initAccessibility(): AccessibilitySettings {
  const settings = readAccessibility();
  applyAccessibilityAttributes(settings);
  return settings;
}

/** Hook returning whether animated images should pause when out of focus. */
export function usePauseAnimatedOnBlur(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => readAccessibility().pauseAnimatedImagesOnBlur);

  useEffect(() => {
    return onAccessibilityChanged((next) => {
      setEnabled(next.pauseAnimatedImagesOnBlur);
    });
  }, []);

  return enabled;
}





/* --- Presence settings (client-side) ---------------------------------------- */

const PRESENCE_KEY = "aural.presence.v1";

export interface PresenceSettings {
  /** Whether stopping for a while shows this person as away by itself. */
  autoAway: boolean;
  /** How long "a while" is, in minutes. */
  autoAwayMinutes: number;
}

export const DEFAULT_PRESENCE: PresenceSettings = {
  autoAway: true,
  autoAwayMinutes: 10,
};

/** The values the settings page offers, and the only ones accepted from disk. */
export const AUTO_AWAY_MINUTES = [1, 5, 10, 15, 30, 60] as const;

export function readPresence(): PresenceSettings {
  try {
    const raw = localStorage.getItem(PRESENCE_KEY);
    if (!raw) return { ...DEFAULT_PRESENCE };
    const parsed = JSON.parse(raw) as Partial<PresenceSettings>;
    return {
      autoAway:
        typeof parsed.autoAway === "boolean" ? parsed.autoAway : DEFAULT_PRESENCE.autoAway,
      autoAwayMinutes: (AUTO_AWAY_MINUTES as readonly number[]).includes(
        parsed.autoAwayMinutes as number,
      )
        ? (parsed.autoAwayMinutes as number)
        : DEFAULT_PRESENCE.autoAwayMinutes,
    };
  } catch {
    return { ...DEFAULT_PRESENCE };
  }
}

const presenceListeners = new Set<(settings: PresenceSettings) => void>();

/** Watches the presence settings, which the idle watcher has to be told about. */
export function onPresenceChanged(listener: (settings: PresenceSettings) => void): () => void {
  presenceListeners.add(listener);
  return () => {
    presenceListeners.delete(listener);
  };
}

export function writePresence(patch: Partial<PresenceSettings>): PresenceSettings {
  const updated: PresenceSettings = { ...readPresence(), ...patch };
  try {
    localStorage.setItem(PRESENCE_KEY, JSON.stringify(updated));
  } catch {
    // Storage is unavailable. The change still applies to this session.
  }
  for (const listener of presenceListeners) listener(updated);
  return updated;
}

/* --- Activity settings (client-side) ----------------------------------------- */

const ACTIVITY_KEY = "aural.activity.v1";

/**
 * What this machine is allowed to say about what its owner is doing.
 *
 * Kept here rather than on a server because it is a decision about this
 * computer, and it has to hold for every server the client is connected to at
 * once: a switch that were per-server would mean turning the same thing off in
 * four places, and forgetting one of them.
 */
export interface ActivitySettings {
  /** Whether anything at all is reported. Nothing below matters while it is off. */
  share: boolean;
  /** Report what the system's media session is playing. */
  media: boolean;
  /** Report what a game says over the rich-presence socket. */
  games: boolean;
  /**
   * Send the artwork with the text.
   *
   * Separate because it is the part that costs something: a cover is a picture
   * broadcast to every connected member each time a track changes, where the
   * text is a line. Somebody on a metered connection can keep the feature and
   * drop the pictures.
   */
  artwork: boolean;
}

/**
 * Off until asked for.
 *
 * Every other default in this file is the helpful one, and this is the
 * exception on purpose: reading the media session and listening for games
 * means telling a server what somebody is doing on their own computer, which
 * is not a thing to start doing because they installed a chat client. The
 * three switches under it are on, so that turning the one at the top on is the
 * whole of enabling the feature.
 */
export const DEFAULT_ACTIVITY: ActivitySettings = {
  share: false,
  media: true,
  games: true,
  artwork: true,
};

export function readActivity(): ActivitySettings {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (!raw) return { ...DEFAULT_ACTIVITY };
    const parsed = JSON.parse(raw) as Partial<ActivitySettings>;
    const flag = (value: unknown, fallback: boolean) =>
      typeof value === "boolean" ? value : fallback;
    return {
      share: flag(parsed.share, DEFAULT_ACTIVITY.share),
      media: flag(parsed.media, DEFAULT_ACTIVITY.media),
      games: flag(parsed.games, DEFAULT_ACTIVITY.games),
      artwork: flag(parsed.artwork, DEFAULT_ACTIVITY.artwork),
    };
  } catch {
    return { ...DEFAULT_ACTIVITY };
  }
}

const activityListeners = new Set<(settings: ActivitySettings) => void>();

/** Watches the activity settings, which the watcher has to be told about. */
export function onActivityChanged(listener: (settings: ActivitySettings) => void): () => void {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}

export function writeActivity(patch: Partial<ActivitySettings>): ActivitySettings {
  const updated: ActivitySettings = { ...readActivity(), ...patch };
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(updated));
  } catch {
    // Storage is unavailable. The change still applies to this session.
  }
  for (const listener of activityListeners) listener(updated);
  return updated;
}

/**
 * The servers whose `idle` this client guessed rather than their owner chose.
 *
 * A status is stored by the server, not by the connection, so it outlives the
 * session that set it. Without a note of which ones were a guess, quitting
 * while away — or dropping off the network, which is the same thing seen from
 * here — would sign back in showing away, with nothing left in memory to say
 * the marker was ever ours to take back. This is that note, and it is why the
 * guess survives exactly as long as it needs to and no longer.
 */
const AUTO_AWAY_KEY = "aural.auto_away.v1";

export function readAutoAway(): string[] {
  try {
    const raw = localStorage.getItem(AUTO_AWAY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function writeAutoAway(serverIds: readonly string[]): void {
  try {
    if (serverIds.length === 0) localStorage.removeItem(AUTO_AWAY_KEY);
    else localStorage.setItem(AUTO_AWAY_KEY, JSON.stringify([...serverIds]));
  } catch {
    // Storage is unavailable. The markers still hold for this session, which
    // is every case but the one this file exists for.
  }
}

/* --- Notification settings (client-side) ------------------------------------ */

const NOTIFICATIONS_KEY = "aural.notifications.v1";

/**
 * How much has to happen before a message is worth interrupting somebody.
 *
 * The badge is unaffected by this: an unread channel is unread whatever the
 * setting says. This decides only what leaves the window — a system toast, a
 * sound, a taskbar that flashes.
 */
export type NotificationScope = "all" | "mentions" | "none";

export interface NotificationSettings {
  /** Whether the operating system is asked to show anything at all. */
  desktop: boolean;
  /** Which messages in a server channel are worth a notification. */
  scope: NotificationScope;
  /**
   * Whether a direct message notifies even when `scope` is "mentions".
   *
   * On by default and separate from `scope`, because a message addressed to
   * one person is a mention in every way that matters.
   */
  directMessages: boolean;
  /** Whether the message text is shown in the toast, or only who sent it. */
  preview: boolean;
  sound: NotificationSoundId;
  /** 0 to 1. */
  soundVolume: number;
  /** Whether the unread count is drawn on the taskbar or dock icon. */
  taskbarBadge: boolean;
  /** Whether a mention makes the taskbar entry ask for attention. */
  flashOnMention: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  desktop: true,
  scope: "all",
  directMessages: true,
  preview: true,
  sound: DEFAULT_NOTIFICATION_SOUND,
  soundVolume: 0.6,
  taskbarBadge: true,
  flashOnMention: true,
};

function isScope(value: unknown): value is NotificationScope {
  return value === "all" || value === "mentions" || value === "none";
}

/**
 * Held in memory because every arriving message asks for it, twice, and the
 * answer only changes when this file changes it. Everything else here is read
 * when a dialog opens, which is not often enough to be worth caching.
 */
let notificationCache: NotificationSettings | null = null;

export function readNotifications(): NotificationSettings {
  if (notificationCache) return notificationCache;
  notificationCache = parseNotifications();
  return notificationCache;
}

function parseNotifications(): NotificationSettings {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_KEY);
    if (!raw) return { ...DEFAULT_NOTIFICATIONS };
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    // Read back field by field rather than spread: a stored file written by an
    // older build, or edited by hand, must not be able to hand the rest of the
    // client a sound id that does not exist or a volume outside the fader.
    return {
      ...DEFAULT_NOTIFICATIONS,
      ...parsed,
      scope: isScope(parsed.scope) ? parsed.scope : DEFAULT_NOTIFICATIONS.scope,
      sound: isNotificationSoundId(parsed.sound) ? parsed.sound : DEFAULT_NOTIFICATIONS.sound,
      soundVolume:
        typeof parsed.soundVolume === "number" && Number.isFinite(parsed.soundVolume)
          ? Math.min(1, Math.max(0, parsed.soundVolume))
          : DEFAULT_NOTIFICATIONS.soundVolume,
    };
  } catch {
    return { ...DEFAULT_NOTIFICATIONS };
  }
}

const notificationListeners = new Set<(settings: NotificationSettings) => void>();

/**
 * Watches the notification settings.
 *
 * The settings dialog is not the only reader: the badge sync has to be told
 * when the taskbar count is switched off so it can clear what it drew, and it
 * is not mounted next to the dialog.
 */
export function onNotificationsChanged(
  listener: (settings: NotificationSettings) => void,
): () => void {
  notificationListeners.add(listener);
  return () => {
    notificationListeners.delete(listener);
  };
}

export function writeNotifications(
  settings: Partial<NotificationSettings>,
): NotificationSettings {
  const updated: NotificationSettings = { ...readNotifications(), ...settings };
  notificationCache = updated;
  try {
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated));
  } catch {
    // Storage is unavailable. The change still applies to this session.
  }
  for (const listener of notificationListeners) listener(updated);
  return updated;
}
