/**
 * Updating the desktop client in place.
 *
 * The mechanism is Tauri's updater, which reads a signed manifest published
 * beside the installers on GitHub. The signature is minisign and is checked
 * against a public key compiled into this build, so an update is only ever
 * installed if the release workflow signed it. That matters more here than in
 * most clients, because Aural servers are self-hosted and none of them is
 * trusted with any part of this. A server says which protocol it speaks and
 * nothing else; where a binary comes from is never its business.
 *
 * What lives here is the decision, not the mechanism: whether to look, what to
 * say about what was found, and what a failure means. The rule running through
 * all of it is that a background check is silent and a check somebody asked
 * for is not. Somebody who clicked "check for updates" is owed an answer, even
 * a disappointing one; somebody who just opened the client is not owed an
 * error about a network they were not using.
 */

import { useSyncExternalStore } from "react";

import { isTauri } from "@tauri-apps/api/core";

import { openExternalUrl } from "@/lib/open";
import { readSystemSettings } from "@/lib/systemSettings";

/**
 * Where somebody is sent when installing in place is not possible.
 *
 * The Linux case is the real one. One build produces an AppImage, a .deb and
 * an .rpm from the same binary, and only the AppImage can be replaced by the
 * process running it: the other two belong to a package manager, which is the
 * thing that is supposed to update them. So the check still runs and still
 * reports honestly, and the install falls back to the download page rather
 * than fighting dpkg over a file it owns.
 */
export const RELEASES_URL = "https://github.com/Du-vy/Aural-Client/releases/latest";

export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; version: string; notes: string }
  | { phase: "downloading"; version: string; percent: number | null }
  | { phase: "ready"; version: string }
  /**
   * `where` is what the client can offer next. A check that failed can be
   * tried again; an install that failed cannot usefully be retried by the same
   * route, and the honest answer is the download page.
   */
  | { phase: "failed"; where: "check" | "install" };

/** What the plugin hands back from a successful check. */
interface PendingUpdate {
  version: string;
  body?: string;
  downloadAndInstall(onEvent: (event: DownloadEvent) => void): Promise<void>;
}

/** The shape the plugin reports progress in. */
type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

let state: UpdateState = { phase: "idle" };
const listeners = new Set<(next: UpdateState) => void>();

/**
 * The update the last successful check produced.
 *
 * Held outside the state because it is a handle rather than something drawn:
 * `downloadAndInstall` is a method on it, and checking again to get it back
 * would mean fetching the manifest twice for one update.
 */
let pending: PendingUpdate | null = null;

function setState(next: UpdateState) {
  state = next;
  for (const listener of listeners) listener(next);
}

/** Whether there is a shell that could install anything. False in a browser. */
export function updaterSupported(): boolean {
  return typeof window !== "undefined" && isTauri();
}

export function getUpdateState(): UpdateState {
  return state;
}

export function onUpdateStateChange(listener: (next: UpdateState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * What the banner and the settings page both draw from.
 *
 * One store rather than one per component: the banner and the "check now"
 * button are two views of the same download, and two copies of this state
 * would let a check started from settings leave the banner showing yesterday's
 * answer.
 */
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(onUpdateStateChange, getUpdateState, getUpdateState);
}

/**
 * Looks for a newer release.
 *
 * `manual` is the whole difference between the two callers. A background check
 * that finds nothing, or cannot reach GitHub, leaves the state alone: there is
 * nothing to say, and saying it anyway would put an error in front of somebody
 * who asked no question. A manual one reports both outcomes, because a button
 * that does nothing visible is indistinguishable from a broken one.
 */
export async function checkForUpdate(manual: boolean): Promise<void> {
  if (!updaterSupported()) return;
  // A download already under way must not be restarted by a check landing on
  // top of it, and an update already found does not need finding again.
  if (state.phase === "downloading" || state.phase === "ready") return;

  if (manual) setState({ phase: "checking" });

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();

    if (!update) {
      pending = null;
      setState({ phase: "idle" });
      return;
    }

    pending = update;
    setState({ phase: "available", version: update.version, notes: update.body ?? "" });
  } catch (error) {
    pending = null;
    // Every ordinary reason this fails is temporary or harmless: no network,
    // GitHub having a moment, or no release carrying a manifest yet, which is
    // what every build older than this feature will find. None of them is
    // worth interrupting somebody over.
    if (!manual) {
      console.warn("aural: update check failed", error);
      setState({ phase: "idle" });
      return;
    }
    setState({ phase: "failed", where: "check" });
  }
}

/**
 * Downloads the update the last check found, and puts it in place.
 *
 * Deliberately does not relaunch. Somebody may be in a voice channel, and
 * ending that without warning to apply an update is a worse thing to do than
 * running an old build for another ten minutes. The new binary is installed
 * when this resolves; restarting into it is the separate, explicit step below.
 */
export async function installUpdate(): Promise<void> {
  if (!pending) return;
  const version = pending.version;

  setState({ phase: "downloading", version, percent: null });

  let total = 0;
  let received = 0;

  try {
    await pending.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        // A server that sent no content length leaves the bar indeterminate
        // rather than having a denominator invented for it.
        const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
        setState({ phase: "downloading", version, percent });
      }
    });
    setState({ phase: "ready", version });
  } catch (error) {
    console.warn("aural: update install failed", error);
    // The .deb and .rpm case lands here, and so does a full disk or a download
    // that was cut off. All three end the same way: the client cannot replace
    // itself, and the download page can.
    setState({ phase: "failed", where: "install" });
  }
}

/** Restarts into the version `installUpdate` put in place. */
export async function restartIntoUpdate(): Promise<void> {
  if (!updaterSupported()) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Sends somebody to the releases page, for when installing in place cannot work. */
export async function openReleasesPage(): Promise<void> {
  await openExternalUrl(RELEASES_URL);
}

/**
 * Puts the banner away.
 *
 * Only until the next launch: the check runs again then, finds the same
 * release and asks again. An update that could be dismissed for good is an
 * update that never happens, and the reason this is on by default is that a
 * client left far enough behind eventually meets a server it cannot speak to.
 */
export function dismissUpdate(): void {
  if (state.phase === "available" || state.phase === "failed") setState({ phase: "idle" });
}

/**
 * The check that runs when the client starts, if the setting allows it.
 *
 * The setting is read from the shell rather than from `localStorage`, which is
 * where `system.json` keeps it and why: storage being cleared should not
 * quietly turn updating off. A browser, or a shell too old to answer, simply
 * never checks.
 */
export function startUpdateWatch(): () => void {
  if (!updaterSupported()) return () => {};

  let live = true;
  void readSystemSettings().then((report) => {
    if (!live || !report?.autoUpdate) return;
    void checkForUpdate(false);
  });

  return () => {
    live = false;
  };
}
