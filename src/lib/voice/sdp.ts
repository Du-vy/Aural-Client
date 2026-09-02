/**
 * The one place this client edits SDP.
 *
 * Editing SDP by hand is a thing to do sparingly and never creatively. What is
 * done here is the exception that every WebRTC application makes: rewriting
 * Opus's `fmtp` parameters, which is the only way to ask for forward error
 * correction, discontinuous transmission, a playback rate or a bitrate ceiling.
 * There is no API for it.
 *
 * Everything here fails closed. A line that does not look the way it is
 * expected to is left exactly as it was, so an unfamiliar SDP comes out
 * unchanged rather than corrupted.
 */

import type { VoiceConfig } from "@/lib/protocol";

/** The Opus parameters both ends are asked to agree on. */
export interface OpusPreferences {
  sampleRate: number;
  maxBitrate: number;
  fec: boolean;
  dtx: boolean;
  stereo: boolean;
}

export function opusPreferences(config: VoiceConfig, bitrate: number): OpusPreferences {
  return {
    sampleRate: config.sampleRate,
    maxBitrate: bitrate,
    fec: config.fec,
    dtx: config.dtx,
    stereo: config.stereo,
  };
}

/**
 * Rewrites the Opus parameters of every audio section of an SDP.
 *
 * `maxaveragebitrate` in a description is a receiver telling a sender what it
 * will accept, so this bounds what the far end sends us. What this client
 * sends is bounded separately, through the sender's own parameters, because
 * that is where the browser actually enforces it.
 */
export function applyOpusPreferences(sdp: string, preferences: OpusPreferences): string {
  const payloadTypes = opusPayloadTypes(sdp);
  if (payloadTypes.size === 0) return sdp;

  const wanted = {
    minptime: "10",
    useinbandfec: preferences.fec ? "1" : "0",
    usedtx: preferences.dtx ? "1" : "0",
    stereo: preferences.stereo ? "1" : "0",
    "sprop-stereo": preferences.stereo ? "1" : "0",
    maxplaybackrate: String(preferences.sampleRate),
    maxaveragebitrate: String(preferences.maxBitrate),
  };

  const lines = sdp.split(/\r\n|\r|\n/);
  const out: string[] = [];
  const patched = new Set<string>();

  for (const line of lines) {
    const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(line);
    const payloadType = fmtp?.[1];
    if (payloadType && payloadTypes.has(payloadType)) {
      out.push(`a=fmtp:${payloadType} ${mergeParameters(fmtp?.[2] ?? "", wanted)}`);
      patched.add(payloadType);
      continue;
    }
    out.push(line);
  }

  // A description can name Opus without an fmtp line at all, in which case the
  // parameters have to be added rather than edited. The new line goes directly
  // after the rtpmap it belongs to, which is where a browser writes it.
  const missing = [...payloadTypes].filter((pt) => !patched.has(pt));
  if (missing.length > 0) {
    for (let i = out.length - 1; i >= 0; i -= 1) {
      const payloadType = /^a=rtpmap:(\d+) opus\//i.exec(out[i] ?? "")?.[1];
      if (payloadType && missing.includes(payloadType)) {
        out.splice(i + 1, 0, `a=fmtp:${payloadType} ${mergeParameters("", wanted)}`);
      }
    }
  }

  // The original line ending is kept: some stacks are particular about it.
  return out.join(sdp.includes("\r\n") ? "\r\n" : "\n");
}

/** The payload types this description maps Opus onto. */
function opusPayloadTypes(sdp: string): Set<string> {
  const found = new Set<string>();
  for (const line of sdp.split(/\r\n|\r|\n/)) {
    const payloadType = /^a=rtpmap:(\d+) opus\//i.exec(line)?.[1];
    if (payloadType) found.add(payloadType);
  }
  return found;
}

/**
 * Merges wanted parameters into an existing `fmtp` value, keeping anything the
 * browser put there that is none of this client's business.
 */
function mergeParameters(existing: string, wanted: Record<string, string>): string {
  const parameters = new Map<string, string>();
  for (const part of existing.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) {
      parameters.set(trimmed, "");
      continue;
    }
    parameters.set(trimmed.slice(0, equals), trimmed.slice(equals + 1));
  }
  for (const [key, value] of Object.entries(wanted)) parameters.set(key, value);

  return [...parameters]
    .map(([key, value]) => (value === "" ? key : `${key}=${value}`))
    .join(";");
}
