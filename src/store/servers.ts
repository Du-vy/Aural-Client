/**
 * The connections this client is holding, and which of them is on screen.
 *
 * Aural reaches a server by address, so there is nothing above a server to
 * organise: this registry is the whole of it. It owns three decisions that no
 * single connection can make for itself — which one is being rendered, which
 * one has the microphone, and what happens to the others meanwhile — and
 * `docs/MULTI-SERVER.md` is where the reasoning behind them is written down.
 *
 * The asymmetry that makes holding several connections affordable lives in
 * `connection.ts`: the one in the foreground keeps its messages, the rest keep
 * presence and a badge.
 */

import { useEffect, useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

import { parseAddress } from "@/lib/address";
import { describeError, type DirectMessage, type User } from "@/lib/protocol";
import { forgetServerMuting } from "@/lib/muting";
import { listServers, removeServer, type SavedServer } from "@/lib/storage";
import {
  createConnection,
  type ConnectOptions,
  type ConnectionHost,
  type ConnectionState,
  type ConnectionStore,
} from "./connection";
import { useVoice } from "./voice";

/** Where the one call is, for an interface that has to warn somebody about it. */
export interface CallLocation {
  serverId: string;
  serverName: string;
  channelId: number;
  channelName: string;
}

export interface ServersState {
  /** Live connections, keyed by `host:port`. */
  connections: Map<string, ConnectionStore>;
  /** The same ids in the order they were opened, which is the rail's order. */
  order: string[];
  /** The connection being rendered, or null when the connect screen is. */
  foregroundId: string | null;
  /** The connection holding the one media session, or null. */
  voiceId: string | null;
  /** Connections with a first dial in flight, for the rail and the button. */
  dialing: string[];
  /** Why the last dial failed, for the connect screen. */
  error: string | null;
  /** What happened to a connection that is no longer here. */
  notice: string | null;
  /** Saved server bookmarks, mirrored from localStorage. */
  saved: SavedServer[];
  /** Whether the user is viewing a server or the dedicated Direct Messages section. */
  activeSection: "server" | "dms";

  setActiveSection(section: "server" | "dms"): void;
  /**
   * Opens a server, or brings it to the front when it is already open.
   *
   * Credentials are the exception: signing in as somebody else is a new
   * session, so it re-dials a connection that is already up.
   */
  connect(options: ConnectOptions & { address: string }): Promise<void>;
  /** Brings an open connection to the front. */
  focus(id: string): void;
  /** Leaves one server without forgetting it. */
  close(id: string): void;
  /** Forgets a bookmark, and leaves the server if it is open. */
  forget(id: string): void;
  dismissNotice(): void;
  /** Moves the one media session to a server, leaving the call it was in. */
  moveCallTo(id: string): void;
  /** Reports a connection that has ended and holds nothing. Called by a host. */
  dropped(id: string, message: string): void;
}

/**
 * The store read when no connection is in the foreground.
 *
 * `useSession` is bound to whichever connection is on screen, and there is not
 * always one — the connect screen is what "not always" looks like. Rather than
 * make every reader in the client handle a null store, there is one that is
 * always there and never connected.
 */
const inertHost: ConnectionHost = {
  foreground: () => false,
  ownsVoice: () => false,
  callElsewhere: () => false,
  takeVoice: () => {},
  dropVoice: () => {},
  savedChanged: () => {},
  ended: () => {},
  reveal: () => {},
};

export const blankConnection: ConnectionStore = createConnection({
  id: "",
  address: "",
  host: inertHost,
});

/**
 * What a connection is handed so it can ask about the others.
 *
 * It is built per connection rather than passed as the registry itself,
 * because the answers are all about this one: whether it is in front, whether
 * it has the microphone, what to do when it ends.
 */
function hostFor(id: string): ConnectionHost {
  return {
    foreground: () => useServers.getState().foregroundId === id,
    ownsVoice: () => useServers.getState().voiceId === id,
    callElsewhere: () => {
      const { voiceId } = useServers.getState();
      return voiceId !== null && voiceId !== id;
    },
    takeVoice: () => useServers.getState().moveCallTo(id),
    dropVoice: () => {
      if (useServers.getState().voiceId === id) useServers.setState({ voiceId: null });
    },
    savedChanged: (saved) => useServers.setState({ saved }),
    ended: (message) => useServers.getState().dropped(id, message),
    reveal: (section) => {
      const registry = useServers.getState();
      registry.setActiveSection(section);
      registry.focus(id);
    },
  };
}

export const useServers = createStore<ServersState>((set, get) => ({
  connections: new Map(),
  order: [],
  foregroundId: null,
  voiceId: null,
  dialing: [],
  error: null,
  notice: null,
  saved: listServers(),
  activeSection: "server",
  setActiveSection: (section) => set({ activeSection: section }),

  async connect(options) {
    let id: string;
    try {
      id = parseAddress(options.address).label;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      throw new Error(message);
    }

    const existing = get().connections.get(id);
    // Clicking a server already open is asking to look at it, not to dial it
    // again. Credentials mean the opposite: a different identity is a different
    // session, and the one that is up has to go.
    if (existing && !options.credentials && !options.asNewGuest) {
      if (existing.getState().status !== "idle") {
        get().focus(id);
        return;
      }
    }

    const store = existing ?? createConnection({ id, address: options.address, host: hostFor(id) });
    if (!existing) {
      const connections = new Map(get().connections);
      connections.set(id, store);
      set({ connections, order: [...get().order, id] });
    }

    set({
      dialing: get().dialing.includes(id) ? get().dialing : [...get().dialing, id],
      error: null,
      notice: null,
    });
    try {
      await store.getState().connect(options);
      // A connection that failed on its way up has already taken itself out of
      // the registry; there is nothing to bring to the front.
      if (get().connections.has(id)) get().focus(id);
    } catch (error) {
      set({ error: describeError(error) });
      throw error;
    } finally {
      set({ dialing: get().dialing.filter((pending) => pending !== id) });
    }
  },

  focus(id) {
    const { foregroundId, connections } = get();
    if (foregroundId === id || !connections.has(id)) return;

    // The one going behind drops its messages here rather than when it is next
    // asked for them, so the memory goes at the moment the reason for holding
    // it does.
    if (foregroundId !== null) connections.get(foregroundId)?.getState().enterBackground();
    set({ foregroundId: id, notice: null });
    connections.get(id)?.getState().enterForeground();
  },

  close(id) {
    // The connection reports itself ended, and `dropped` does the rest.
    get().connections.get(id)?.getState().disconnect();
  },

  forget(id) {
    if (get().connections.has(id)) get().close(id);
    // The notification overrides go with it. They are keyed by server, and a
    // server that is added again later is a fresh decision rather than one
    // that inherits a mute from months ago.
    forgetServerMuting(id);
    set({ saved: removeServer(id) });
  },

  dismissNotice() {
    set({ notice: null });
  },

  moveCallTo(id) {
    const { voiceId, connections } = get();
    if (voiceId === id) return;
    if (voiceId !== null) {
      // One microphone, one call. The server that had it is left as well as
      // detached, so nobody is left sitting in a channel this client stopped
      // listening to.
      const previous = connections.get(voiceId);
      void previous?.getState().leaveChannel().catch(() => {
        // The socket may already be gone, which is one of the ways the call
        // ends up moving in the first place.
      });
      useVoice.getState().detach();
    }
    set({ voiceId: id });
  },

  dropped(id, message) {
    const previous = get().foregroundId;
    const connections = new Map(get().connections);
    connections.delete(id);
    const order = get().order.filter((open) => open !== id);

    let foregroundId = previous;
    if (foregroundId === id) {
      // Whatever was opened most recently takes the screen. With nothing left
      // to take it, the connect screen does, which is where the message goes.
      foregroundId = order.at(-1) ?? null;
    }

    // The message names the server it is about, because it is read from
    // wherever the reader happens to be — which by now is somewhere else.
    const name = get().saved.find((entry) => entry.id === id)?.name;
    set({
      connections,
      order,
      foregroundId,
      voiceId: get().voiceId === id ? null : get().voiceId,
      notice: message ? (name ? `${name}: ${message}` : message) : null,
      dialing: get().dialing.filter((pending) => pending !== id),
    });

    if (foregroundId !== null && foregroundId !== previous) {
      connections.get(foregroundId)?.getState().enterForeground();
    }
  },
}));

/** The connection being rendered, or the blank one when there is none. */
export function foregroundStore(): ConnectionStore {
  const { foregroundId, connections } = useServers.getState();
  return (foregroundId === null ? undefined : connections.get(foregroundId)) ?? blankConnection;
}

/** Reads the registry itself, in a component. */
export function useServerRegistry<T>(selector: (state: ServersState) => T): T {
  return useStore(useServers, selector);
}

/** The store of one connection, or the blank one when it is not open. */
export function useConnectionStore(id: string | null): ConnectionStore {
  return useStore(
    useServers,
    (state) => (id === null ? undefined : state.connections.get(id)) ?? blankConnection,
  );
}

/** Reads one connection by id, whether or not it is the one on screen. */
export function useConnection<T>(id: string | null, selector: (state: ConnectionState) => T): T {
  return useStore(useConnectionStore(id), selector);
}

/**
 * Reads the connection carrying the call, falling back to the one on screen.
 *
 * The call strip is the one part of the interface that is not about the server
 * being looked at: a call carries on while somebody reads somewhere else, and
 * the controls for it have to keep working from there.
 */
export function useCall<T>(selector: (state: ConnectionState) => T): T {
  const store = useStore(
    useServers,
    (state) =>
      state.connections.get(state.voiceId ?? state.foregroundId ?? "") ?? blankConnection,
  );
  return useStore(store, selector);
}

/** Where the one call is right now, or null. Read outside of rendering. */
export function callLocation(): CallLocation | null {
  const { voiceId, connections } = useServers.getState();
  if (voiceId === null) return null;
  const state = connections.get(voiceId)?.getState();
  const channelId = state?.self?.channelId ?? null;
  if (!state || channelId === null) return null;
  return {
    serverId: voiceId,
    serverName: state.server?.name ?? voiceId,
    channelId,
    channelName: state.channels.get(channelId)?.name ?? "",
  };
}

/** One private conversation aggregated across any connected server. */
export interface ServerConversationItem {
  key: string;
  serverId: string;
  serverName: string;
  serverAddress: string;
  userId: number;
  peer?: User;
  lastMessage?: DirectMessage;
  lastMessageAt: number;
  unread: number;
}

function extractConversations(connections: Map<string, ConnectionStore>): ServerConversationItem[] {
  const result: ServerConversationItem[] = [];
  for (const [connectionId, store] of connections.entries()) {
    const state = store.getState();
    if (!(state.server?.directMessages ?? false)) continue;
    const serverName = state.server?.name || state.address?.label || connectionId;
    const serverAddress = state.address?.label || state.address?.raw || connectionId;
    const serverId = state.serverId || connectionId;

    for (const conv of state.conversations.values()) {
      const peer = state.users.get(conv.userId);
      result.push({
        key: `${serverId}:${conv.userId}`,
        serverId,
        serverName,
        serverAddress,
        userId: conv.userId,
        peer,
        lastMessage: conv.lastMessage,
        lastMessageAt: conv.lastMessageAt,
        unread: conv.unread,
      });
    }
  }
  return result.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

/**
 * Collects every private conversation across all currently open server connections,
 * keeping memory strictly bounded without fetching full message history.
 */
export function useAllConversations(): ServerConversationItem[] {
  const connections = useServerRegistry((state) => state.connections);
  const [items, setItems] = useState<ServerConversationItem[]>(() =>
    extractConversations(connections)
  );

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    const refresh = () => {
      setItems(extractConversations(useServers.getState().connections));
    };

    refresh();

    for (const store of connections.values()) {
      unsubs.push(
        store.subscribe((state, prev) => {
          if (
            state.conversations !== prev.conversations ||
            state.users !== prev.users ||
            state.server !== prev.server
          ) {
            refresh();
          }
        })
      );
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [connections]);

  return items;
}

function calculateTotalDmUnread(connections: Map<string, ConnectionStore>): number {
  let sum = 0;
  for (const store of connections.values()) {
    const state = store.getState();
    if (state.conversations) {
      for (const conv of state.conversations.values()) {
        sum += conv.unread;
      }
    }
  }
  return sum;
}

/**
 * Returns the total count of unread direct messages across all connected servers.
 */
export function useTotalDmUnread(): number {
  const connections = useServerRegistry((state) => state.connections);
  const [total, setTotal] = useState(() => calculateTotalDmUnread(connections));

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    const refresh = () => {
      setTotal(calculateTotalDmUnread(useServers.getState().connections));
    };

    refresh();

    for (const store of connections.values()) {
      unsubs.push(
        store.subscribe((state, prev) => {
          if (state.conversations !== prev.conversations) {
            refresh();
          }
        })
      );
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [connections]);

  return total;
}

