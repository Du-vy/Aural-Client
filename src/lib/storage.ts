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

import { parseAddress } from "./address";

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



