/**
 * The switches on the "Windows & System" settings page.
 *
 * Unlike everything else in the settings dialog, none of this is kept in
 * `localStorage`. Two of them are read by the shell before the webview
 * exists — whether to put the window on screen, and whether to hand the
 * renderer a GPU — and another is held by the operating system itself, in a
 * registry key or a plist. So the page asks the shell rather than storage, and
 * the shell answers with what is now actually true rather than with what it
 * was told: a registry write the system refuses has to move the switch back.
 *
 * In a browser there is no shell to ask and nothing any of these would mean,
 * so the page says so instead of drawing switches that do nothing.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";

/** The switches, as the page draws them. */
export interface SystemSettings {
  launchOnStartup: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
  hardwareAcceleration: boolean;
  /**
   * Whether the client looks for a new release when it starts.
   *
   * Here rather than in `localStorage` with the rest of the page's
   * preferences because of what clearing storage would mean for it. Every
   * other setting would come back as a default somebody notices; this one
   * would come back as a client that had quietly stopped updating itself.
   */
  autoUpdate: boolean;
}

/** The switches plus what the shell can say about whether they apply here. */
export interface SystemSettingsReport extends SystemSettings {
  /**
   * False on macOS, where neither WKWebView nor the system exposes a switch
   * for the GPU. The setting is shown, disabled, with the reason.
   */
  hardwareAccelerationSupported: boolean;
  /**
   * False when the tray icon could not be created. Both settings that hide the
   * window depend on there being something to bring it back, so without a tray
   * the shell ignores them — and the page has to say that rather than leave
   * two switches looking effective.
   */
  trayAvailable: boolean;
}

/** Whether there is a shell to ask at all. False in every browser build. */
export function systemSettingsSupported(): boolean {
  return isTauri();
}

export async function readSystemSettings(): Promise<SystemSettingsReport | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<SystemSettingsReport>("get_system_settings");
  } catch {
    // A shell older than these commands. The page falls back to the same
    // notice a browser gets, which is true of it: there is nothing to change.
    return null;
  }
}

/**
 * Applies one or more switches and returns what is true afterwards.
 *
 * Rejects when the change did not happen — the registry refused, the
 * configuration directory is not writable — so the caller can put the switch
 * back and say so. The report is deliberately not merged from the patch: it is
 * re-read from the system on the other side.
 */
export async function writeSystemSettings(
  patch: Partial<SystemSettings>,
): Promise<SystemSettingsReport> {
  return await invoke<SystemSettingsReport>("set_system_settings", { patch });
}

/**
 * Restarts the client. The only way a change to the GPU setting takes effect,
 * because the browser engine reads that when it starts and never again.
 */
export async function restartApp(): Promise<void> {
  if (!isTauri()) return;
  await invoke("restart_app");
}

/**
 * Writes the tray menu in the language the client is being read in.
 *
 * The tray is built during startup, before anything that knows the language
 * has loaded, so it starts in English and is corrected from here. Failing is
 * not worth reporting: the menu is already there and already says something.
 */
export async function setTrayLabels(open: string, quit: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("set_tray_labels", { open, quit });
  } catch {
    // An older shell, or a desktop with no tray to relabel.
  }
}
