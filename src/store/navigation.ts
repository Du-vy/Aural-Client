/**
 * Where the reader has been, and how to put them back there.
 *
 * The client has no address bar, so Back and Forward cannot be handed to the
 * browser: this keeps the trail itself. A location is what the two stores
 * underneath already hold between them — the section, the connection in front,
 * and either a channel on it or a conversation — so going somewhere is writing
 * those, and the views follow their own stores rather than being called.
 */

import { useEffect, useRef } from "react";
import { createStore } from "zustand/vanilla";
import { isPostChannel } from "@/lib/protocol";
import { useServers } from "./servers";

export interface NavigationLocation {
  section: "server" | "dms";
  serverId: string;
  channelId: number | null;
  userId: number | null;
}

export interface NavigationState {
  stack: NavigationLocation[];
  index: number;
  /**
   * Set while a location is being applied, so that the views reporting where
   * they have landed are not mistaken for the reader going somewhere new.
   */
  isNavigating: boolean;
  /** The location `isNavigating` is waiting to be told about. */
  pending: NavigationLocation | null;

  recordLocation(location: NavigationLocation): void;
  goBack(): Promise<boolean>;
  goForward(): Promise<boolean>;
  canGoBack(): boolean;
  canGoForward(): boolean;
  clear(): void;
}

const MAX_HISTORY = 50;

/** `MouseEvent.button` for the two side buttons every mouse calls Back and Forward. */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

/**
 * How long a move waits to be told it arrived before giving up on the answer.
 *
 * The view reports its new location through `recordLocation`, which is what
 * normally ends a move. A destination it cannot reach exactly — a channel that
 * has since been deleted, say — would never report, and the trail has to be
 * usable again either way.
 */
const SETTLE_TIMEOUT = 2000;

function locationsEqual(a: NavigationLocation, b: NavigationLocation): boolean {
  return (
    a.section === b.section &&
    a.serverId === b.serverId &&
    a.channelId === b.channelId &&
    a.userId === b.userId
  );
}

/** A location on a server this client is no longer connected to is not reachable. */
function isLocationValid(loc: NavigationLocation | undefined): boolean {
  if (!loc) return false;
  return useServers.getState().connections.has(loc.serverId);
}

/** The nearest reachable entry from `from`, walking by `step`, or -1 if there is none. */
function findReachable(stack: NavigationLocation[], from: number, step: -1 | 1): number {
  for (let i = from; i >= 0 && i < stack.length; i += step) {
    if (isLocationValid(stack[i])) return i;
  }
  return -1;
}

/**
 * Puts the client where a location says, and reports whether it got there.
 *
 * A false answer means the trail should not move: the connection went away, or
 * its channel list has not arrived, and stepping onto an entry that changed
 * nothing would leave Back pointing somewhere the reader was never shown.
 */
export async function applyNavigationLocation(loc: NavigationLocation): Promise<boolean> {
  const servers = useServers.getState();
  const store = servers.connections.get(loc.serverId);
  if (!store) return false;

  servers.setActiveSection(loc.section);
  servers.focus(loc.serverId);

  // A conversation is the same conversation in either section: what the section
  // decides is which sidebar is beside it.
  if (loc.userId !== null) {
    store.getState().setActiveChannel(null);
    await store.getState().openConversation(loc.userId);
    store.getState().setActiveConversation(loc.userId);
    return true;
  }

  store.getState().setActiveConversation(null);
  if (loc.section === "dms") return true;

  const state = store.getState();
  if (loc.channelId !== null && state.channels.has(loc.channelId)) {
    state.setActiveChannel(loc.channelId);
    return true;
  }

  // The channel is gone, or the list it is in has not been sent yet. Falling
  // back to the first one readable is right in the first case and wrong in the
  // second, so it only counts as arriving when there is a list to fall back to.
  if (state.channels.size === 0) return false;
  const firstReadable = [...state.channels.values()]
    .filter((channel) => channel.type === "text" || isPostChannel(channel.type))
    .sort((a, b) => a.position - b.position)[0];
  if (!firstReadable) return false;
  state.setActiveChannel(firstReadable.id);
  return true;
}

export const useNavigation = createStore<NavigationState>((set, get) => {
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  function settle(): void {
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    set({ isNavigating: false, pending: null });
  }

  /** Walks to `targetIndex` and holds the trail still until the views report it. */
  async function moveTo(targetIndex: number, target: NavigationLocation): Promise<boolean> {
    if (settleTimer !== null) clearTimeout(settleTimer);
    set({ isNavigating: true, pending: target });
    settleTimer = setTimeout(settle, SETTLE_TIMEOUT);

    let arrived = false;
    try {
      arrived = await applyNavigationLocation(target);
    } finally {
      if (arrived) {
        set({ index: targetIndex });
      } else {
        settle();
      }
    }
    return arrived;
  }

  return {
    stack: [],
    index: -1,
    isNavigating: false,
    pending: null,

    recordLocation(location) {
      const { isNavigating, pending } = get();
      if (isNavigating) {
        // The view has caught up with where it was sent, so the next thing it
        // reports is the reader moving rather than the tail of this move.
        if (pending && locationsEqual(pending, location)) settle();
        return;
      }

      // A server with neither a channel nor a conversation is not a place: it
      // is the moment before the channel list arrived, and going back to it
      // would land on nothing.
      if (location.section === "server" && location.channelId === null && location.userId === null) {
        return;
      }

      const { stack, index } = get();
      const current = index >= 0 ? stack[index] : null;
      if (current && locationsEqual(current, location)) return;

      // Somewhere new is the end of the trail: whatever Forward pointed at is
      // a branch nobody took.
      const newStack = [...(index >= 0 ? stack.slice(0, index + 1) : []), location];
      if (newStack.length > MAX_HISTORY) {
        newStack.splice(0, newStack.length - MAX_HISTORY);
      }

      set({ stack: newStack, index: newStack.length - 1 });
    },

    async goBack() {
      const { stack, index, isNavigating } = get();
      if (isNavigating || index <= 0) return false;

      const targetIndex = findReachable(stack, index - 1, -1);
      const target = targetIndex >= 0 ? stack[targetIndex] : undefined;
      if (!target) return false;

      return moveTo(targetIndex, target);
    },

    async goForward() {
      const { stack, index, isNavigating } = get();
      if (isNavigating || index < 0 || index >= stack.length - 1) return false;

      const targetIndex = findReachable(stack, index + 1, 1);
      const target = targetIndex >= 0 ? stack[targetIndex] : undefined;
      if (!target) return false;

      return moveTo(targetIndex, target);
    },

    canGoBack() {
      const { stack, index } = get();
      return index > 0 && findReachable(stack, index - 1, -1) >= 0;
    },

    canGoForward() {
      const { stack, index } = get();
      return index >= 0 && index < stack.length - 1 && findReachable(stack, index + 1, 1) >= 0;
    },

    clear() {
      settle();
      set({ stack: [], index: -1 });
    },
  };
});

/**
 * The handlers of everything currently open over the view, oldest first.
 *
 * Back means the thing on top, not all of them at once, so only the last one
 * registered answers. Modals, menus and popovers open after the view they cover
 * has mounted, which is what makes the order of registration the order on
 * screen.
 */
const backHandlers: Array<() => void> = [];

function onWindowMouseUpCapture(event: MouseEvent): void {
  if (event.button !== MOUSE_BACK) return;
  const top = backHandlers[backHandlers.length - 1];
  if (!top) return;
  // Captured rather than bubbled, which is the earlier of the two phases and
  // the only one the history listener below can be stopped from.
  event.preventDefault();
  event.stopPropagation();
  top();
}

/**
 * Answers the mouse's Back button while something is on top of the view.
 *
 * A modal, a menu or the drawer is what Back means for as long as it is open,
 * so it takes the press instead of the history moving underneath it.
 */
export function useMouseBack(enabled: boolean, onBack: () => void): void {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });

  useEffect(() => {
    if (!enabled) return;
    const handler = () => latest.current();
    backHandlers.push(handler);
    if (backHandlers.length === 1) {
      window.addEventListener("mouseup", onWindowMouseUpCapture, true);
    }
    return () => {
      const at = backHandlers.lastIndexOf(handler);
      if (at >= 0) backHandlers.splice(at, 1);
      if (backHandlers.length === 0) {
        window.removeEventListener("mouseup", onWindowMouseUpCapture, true);
      }
    };
  }, [enabled]);
}

/**
 * Attaches global listeners for the Back and Forward side buttons and for the
 * keyboard shortcuts that mean the same thing: Alt+Left/Right on Windows and
 * Linux, Cmd+[ and Cmd+] on a Mac.
 */
export function startNavigationListener(): () => void {
  // Read once rather than on every keystroke: this listens on the window, so
  // its keydown handler runs for every key typed anywhere in the client.
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

  function onMouseUp(e: MouseEvent) {
    if (e.button === MOUSE_BACK) {
      e.preventDefault();
      void useNavigation.getState().goBack();
    } else if (e.button === MOUSE_FORWARD) {
      e.preventDefault();
      void useNavigation.getState().goForward();
    }
  }

  function onAuxClick(e: MouseEvent) {
    if (e.button === MOUSE_BACK || e.button === MOUSE_FORWARD) {
      e.preventDefault();
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const isBack = isMac ? e.metaKey && e.key === "[" : e.altKey && e.key === "ArrowLeft";
    const isForward = isMac ? e.metaKey && e.key === "]" : e.altKey && e.key === "ArrowRight";

    if (isBack) {
      e.preventDefault();
      void useNavigation.getState().goBack();
    } else if (isForward) {
      e.preventDefault();
      void useNavigation.getState().goForward();
    }
  }

  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("auxclick", onAuxClick);
  window.addEventListener("keydown", onKeyDown);

  return () => {
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("auxclick", onAuxClick);
    window.removeEventListener("keydown", onKeyDown);
  };
}
