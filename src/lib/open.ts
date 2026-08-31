import { isTauri, invoke } from "@tauri-apps/api/core";

/**
 * Opens an external URL in the user's default web browser.
 * Uses native Tauri IPC command when running as a desktop client,
 * and falls back to window.open when running in a standard web browser.
 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    if (typeof window !== "undefined" && isTauri()) {
      await invoke("open_url", { url });
      return;
    }
  } catch (err) {
    console.warn("Failed to open URL via Tauri command, falling back to window.open", err);
  }

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Saves a URL to disk.
 *
 * In the desktop client the download is handed to the system browser, which
 * already has a download manager, a destination the user has chosen, and the
 * warnings that go with saving a file. In a web browser a plain anchor is
 * enough: the server answers a download URL with an attachment disposition, so
 * the browser saves it rather than navigating to it.
 */
export async function saveUrl(url: string, filename: string): Promise<void> {
  try {
    if (typeof window !== "undefined" && isTauri()) {
      await invoke("open_url", { url });
      return;
    }
  } catch (err) {
    console.warn("Failed to open download via Tauri command, falling back to an anchor", err);
  }

  if (typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
