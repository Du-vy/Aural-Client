import { useState, useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";

/**
 * Global window focus tracker.
 *
 * Tracks whether the Aural client is in the foreground (active window)
 * across web browsers and desktop environments (Tauri).
 * Used to pause animations and save GPU/CPU cycles when the application
 * is not in active use.
 */

let windowFocused =
  typeof document !== "undefined" ? document.hasFocus() && !document.hidden : true;

const listeners = new Set<(focused: boolean) => void>();

function setFocused(next: boolean) {
  if (windowFocused === next) return;
  windowFocused = next;
  for (const listener of listeners) {
    listener(next);
  }
}

let initialized = false;

function initWindowFocusTracker() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const handleFocus = () => setFocused(true);
  const handleBlur = () => setFocused(false);
  const handleVisibilityChange = () => {
    if (document.hidden) {
      setFocused(false);
    } else {
      setFocused(document.hasFocus());
    }
  };

  window.addEventListener("focus", handleFocus);
  window.addEventListener("blur", handleBlur);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  // In desktop (Tauri), listen to OS window focus changes directly
  if (isTauri()) {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const currentWin = getCurrentWindow();
        currentWin.onFocusChanged(({ payload: focused }) => {
          setFocused(focused);
        });
      })
      .catch(() => {
        // Fall back gracefully to standard browser window events
      });
  }
}

/** Returns the current window focus state synchronously. */
export function isWindowFocused(): boolean {
  initWindowFocusTracker();
  return windowFocused;
}

/** Subscribe to window focus changes. Returns an unsubscribe function. */
export function onWindowFocusChange(listener: (focused: boolean) => void): () => void {
  initWindowFocusTracker();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook returning whether the window is currently in the foreground. */
export function useWindowFocused(): boolean {
  initWindowFocusTracker();
  const [focused, setFocusedState] = useState<boolean>(windowFocused);

  useEffect(() => {
    // Sync current state on mount
    setFocusedState(windowFocused);
    return onWindowFocusChange(setFocusedState);
  }, []);

  return focused;
}
