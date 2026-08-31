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
