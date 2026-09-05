/**
 * The shell's half of rich presence, as the page sees it.
 *
 * Everything that reads the machine — the media session, the socket a game
 * writes its presence to — lives in the shell, because none of it is reachable
 * from a webview. What crosses into the page is two events and two calls, and
 * this file is the whole of that surface.
 *
 * In a browser build there is no shell and none of it means anything, so every
 * function here answers as if the feature were simply unavailable rather than
 * throwing. The settings page reads that and says so.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { Activity } from "./protocol";

/** Which reader a reading came from. */
export type ActivitySource = "media" | "games";

/**
 * What the rich-presence socket is doing.
 *
 * `conflict` is the one worth spelling out. Only one process on a machine can
 * hold the socket games look for, and Discord holds it whenever Discord is
 * running: games report there and nothing reaches Aural. Left unsaid that is
 * indistinguishable from a feature that does not work, so it is its own state
 * and the settings page explains it.
 */
export type RpcState = "off" | "listening" | "conflict" | "unsupported" | "error";

export interface RpcReport {
  state: RpcState;
  /** The socket that was tried, so a support question has something in it. */
  socket?: string;
}

/** What this machine can do, asked for rather than waited for. */
export interface NativeActivityReport {
  mediaSupported: boolean;
  /** Why not, when it cannot. */
  mediaReason?: string;
  rpc: RpcReport;
}

/** One source's latest reading. A null activity is that source going quiet. */
export interface NativeActivityEvent {
  source: ActivitySource;
  activity: Activity | null;
}

const EVENT_REPORT = "activity://report";
const EVENT_RPC = "activity://rpc";

/** Whether there is a shell to read any of this from. False in every browser. */
export function nativeActivitySupported(): boolean {
  return isTauri();
}

/**
 * Asks what this machine can do.
 *
 * Returns null in a browser, and also from a shell too old to answer — which
 * is the same situation from the page's point of view, and gets the same
 * notice.
 */
export async function readNativeActivity(): Promise<NativeActivityReport | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<NativeActivityReport>("activity_state");
  } catch {
    return null;
  }
}

/**
 * Switches the readers on and off.
 *
 * Turning games off makes the shell release the socket rather than ignore what
 * arrives on it: sitting on a socket whose reports are being discarded would
 * keep Discord from taking it for no benefit to anybody.
 */
export async function configureNativeActivity(options: {
  media: boolean;
  games: boolean;
  artwork: boolean;
}): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("activity_configure", options);
  } catch {
    // An older shell. The page's own settings still hold; there is simply
    // nothing underneath them to configure.
  }
}

/** Watches one source's readings. */
export async function onNativeActivity(
  listener: (event: NativeActivityEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return await listen<NativeActivityEvent>(EVENT_REPORT, (event) => listener(event.payload));
}

/** Watches the state of the rich-presence socket. */
export async function onNativeRpc(listener: (report: RpcReport) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return await listen<RpcReport>(EVENT_RPC, (event) => listener(event.payload));
}
