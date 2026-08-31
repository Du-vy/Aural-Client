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
