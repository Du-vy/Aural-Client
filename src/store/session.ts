/**
 * The session: whichever connection is on screen.
 *
 * This used to be the store itself, one server at a time. It is now a view of
 * the one connection in the foreground, because a client that holds several
 * still renders one, and every component that reads `useSession(...)` means
 * "the server I am looking at" rather than "the only server there is".
 *
 * The connection itself is in `connection.ts` and the set of them is in
 * `servers.ts`. Anything that has to reach past the foreground — the rail, the
 * call strip, an unread badge on a server nobody is looking at — reads those
 * directly.
 */

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";

import type { ConnectionState } from "./connection";
import { blankConnection, foregroundStore, useServers } from "./servers";

/** Kept under its old name: this is the state one server connection holds. */
export type SessionState = ConnectionState;

interface SessionHook {
  (): ConnectionState;
  <T>(selector: (state: ConnectionState) => T): T;
  getState: StoreApi<ConnectionState>["getState"];
  getInitialState: StoreApi<ConnectionState>["getInitialState"];
  setState: StoreApi<ConnectionState>["setState"];
  subscribe: StoreApi<ConnectionState>["subscribe"];
}

const identity = (state: ConnectionState): ConnectionState => state;

/**
 * Reads the connection in the foreground.
 *
 * The store this is bound to changes when another server is brought to the
 * front, so the subscription is made through the registry: React re-subscribes
 * to the new one the moment it becomes the answer.
 */
function useSessionImpl<T>(selector: (state: ConnectionState) => T = identity as never): T {
  const store = useStore(
    useServers,
    (state) =>
      (state.foregroundId === null ? undefined : state.connections.get(state.foregroundId)) ??
      blankConnection,
  );
  return useStore(store, selector);
}

export const useSession = useSessionImpl as SessionHook;

useSession.getState = () => foregroundStore().getState();
useSession.getInitialState = () => foregroundStore().getInitialState();
useSession.setState = ((partial: never, replace: never) =>
  foregroundStore().setState(partial, replace)) as StoreApi<ConnectionState>["setState"];
useSession.subscribe = (listener) => foregroundStore().subscribe(listener);

export {
  CHANNEL_WINDOW,
  EMPTY_HISTORY,
  EMPTY_SEARCH,
  IDLE_CHANNEL_WINDOW,
  OPEN_CHANNEL_LIMIT,
  SEARCH_PAGE_SIZE,
  clampWindow,
  mentionsSelf,
} from "./connection";
export type {
  ChannelHistory,
  ConnectOptions,
  ConnectionState,
  ConnectionStatus,
  JumpTarget,
  SearchState,
  Unread,
} from "./connection";
export type {
  Attachment,
  Channel,
  Message,
  MessageSearchHit,
  Role,
  ServerInfo,
  User,
} from "./connection";
