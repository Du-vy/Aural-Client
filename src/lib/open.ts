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

export interface SaveTextFileOptions {
  mimeType?: string;
  filterName?: string;
  filterExtensions?: string[];
}

/**
 * Saves text or data content to a file on disk.
 *
 * In the Tauri desktop client, this opens the native OS Save File dialog via the `save_file` command.
 * In a web browser supporting the File System Access API, it uses `window.showSaveFilePicker`.
 * In fallback web environments, it triggers a blob download anchor with delayed cleanup.
 *
 * Returns `true` if saved successfully, `false` if cancelled or failed.
 */
export async function saveTextFile(
  filename: string,
  content: string,
  options?: SaveTextFileOptions
): Promise<boolean> {
  // 1. Native Tauri desktop client
  if (typeof window !== "undefined" && isTauri()) {
    try {
      const saved = await invoke<boolean>("save_file", {
        defaultName: filename,
        content,
        filterName: options?.filterName ?? null,
        filterExtensions: options?.filterExtensions ?? null,
      });
      return saved;
    } catch (err) {
      console.warn("Failed to save file via Tauri command, falling back to browser methods", err);
    }
  }

  // 2. Modern Web File System Access API (opens native Save File dialog)
  if (typeof window !== "undefined" && typeof (window as any).showSaveFilePicker === "function") {
    try {
      const mime = options?.mimeType || "application/json";
      const exts = (options?.filterExtensions || []).map((e) => `.${e.replace(/^\./, "")}`);
      const pickerOptions: Record<string, any> = {
        suggestedName: filename,
      };
      if (options?.filterName && exts.length > 0) {
        pickerOptions.types = [
          {
            description: options.filterName,
            accept: {
              [mime]: exts,
            },
          },
        ];
      }
      const handle = await (window as any).showSaveFilePicker(pickerOptions);
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // User deliberately cancelled the file picker dialog
        return false;
      }
      console.warn("showSaveFilePicker failed, falling back to anchor download", err);
    }
  }

  // 3. Fallback: Blob URL download via hidden anchor element
  if (typeof document === "undefined") return false;
  try {
    const mime = options?.mimeType || "application/json";
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (err) {
    console.error("Failed to download file via blob anchor", err);
    return false;
  }
}
