/**
 * Server addresses. Aural servers are reached by address rather than by name,
 * so this accepts what a person would actually type: `192.168.1.5:9871`,
 * `aural.example.com`, or a full `wss://` URL.
 */

/** The port an Aural server listens on unless told otherwise. */
export const DEFAULT_PORT = 9871;

export interface ServerAddress {
  /** Exactly what the user typed, kept so it can be shown back to them. */
  raw: string;
  host: string;
  port: number;
  secure: boolean;
  /** WebSocket endpoint. */
  wsUrl: string;
  /** Unauthenticated preview endpoint. */
  infoUrl: string;
  /** `host:port`, the stable key a saved server is stored under. */
  label: string;
}

/**
 * Parses an address, throwing a message meant to be shown to the user.
 *
 * A bare address defaults to plaintext on the Aural port. An explicit `wss://`
 * or `https://` defaults to 443 instead, since that is what a server sitting
 * behind a reverse proxy will be using.
 */
export function parseAddress(input: string): ServerAddress {
  const raw = input.trim();
  if (!raw) {
    throw new Error("Enter a server address.");
  }

  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  let secure = false;
  let normalized: string;

  if (scheme) {
    const name = (scheme[1] ?? "").toLowerCase();
    const rest = raw.slice(scheme[0].length);
    if (name === "wss" || name === "https") {
      secure = true;
      normalized = `https://${rest}`;
    } else if (name === "ws" || name === "http") {
      normalized = `http://${rest}`;
    } else {
      throw new Error(`"${name}://" is not a scheme Aural understands.`);
    }
  } else {
    normalized = `http://${raw}`;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("That does not look like a valid address.");
  }

  const host = url.hostname;
  if (!host) {
    throw new Error("That address is missing a host.");
  }

  const port = url.port ? Number(url.port) : secure ? 443 : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("That port is out of range.");
  }

  // URL already hands back an IPv6 literal bracketed; anything else containing
  // a colon is one that arrived without them.
  const bracketed = host.startsWith("[") || !host.includes(":") ? host : `[${host}]`;
  const authority = `${bracketed}:${port}`;

  return {
    raw,
    host,
    port,
    secure,
    wsUrl: `${secure ? "wss" : "ws"}://${authority}/ws`,
    infoUrl: `${secure ? "https" : "http"}://${authority}/info`,
    label: authority,
  };
}

/** Fetches the public preview of a server, for showing it before connecting. */
export async function fetchServerInfo(address: ServerAddress, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(address.infoUrl, { signal, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`The server answered ${response.status}.`);
  }
  return response.json();
}
