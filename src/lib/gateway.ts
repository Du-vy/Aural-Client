/**
 * The WebSocket client. It turns the request/reply half of the protocol into
 * promises and hands the event half to a callback.
 */

import type { ServerAddress } from "./address";
import { AuralError, OP_ERROR, OP_RESULT, type Envelope, type Hello } from "./protocol";

/** How long a request may wait for its reply before it is given up on. */
const REQUEST_TIMEOUT_MS = 20_000;
/** How long the socket may take to open and deliver hello. */
const HANDSHAKE_TIMEOUT_MS = 15_000;

export interface CloseInfo {
  code: number;
  reason: string;
  /** False when the socket dropped rather than being closed deliberately. */
  clean: boolean;
}

export interface GatewayHandlers {
  /** Called for every server-pushed event. */
  onEvent(op: string, payload: unknown): void;
  /** Called once, when the connection ends for any reason. */
  onClose(info: CloseInfo): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class Gateway {
  private readonly socket: WebSocket;
  private readonly handlers: GatewayHandlers;
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private closed = false;

  readonly hello: Hello;

  private constructor(socket: WebSocket, hello: Hello, handlers: GatewayHandlers) {
    this.socket = socket;
    this.hello = hello;
    this.handlers = handlers;

    socket.onmessage = (event) => this.receive(event);
    socket.onclose = (event) => this.finish(event.code, event.reason, event.wasClean);
    socket.onerror = () => {
      // An error is always followed by a close, which is where the reporting
      // happens. Browsers deliberately withhold the cause from script.
    };
  }

  /**
   * Opens a connection and resolves once the server has sent its hello frame.
   * The caller decides what to do about a protocol version mismatch.
   */
  static open(address: ServerAddress, handlers: GatewayHandlers): Promise<Gateway> {
    return new Promise((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(address.wsUrl);
      } catch {
        reject(new Error("That address could not be opened."));
        return;
      }

      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("The server did not answer in time."));
      }, HANDSHAKE_TIMEOUT_MS);

      const fail = (message: string) => {
        clearTimeout(timer);
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        reject(new Error(message));
      };

      socket.onerror = () => fail("The connection failed.");
      socket.onclose = (event) => fail(closeMessage(event.code, event.reason));

      socket.onmessage = (event) => {
        let envelope: Envelope<Hello>;
        try {
          envelope = JSON.parse(String(event.data)) as Envelope<Hello>;
        } catch {
          fail("The server sent something this client could not read.");
          socket.close();
          return;
        }
        if (envelope.op !== "hello" || !envelope.d) {
          fail("The server did not introduce itself as an Aural server.");
          socket.close();
          return;
        }
        clearTimeout(timer);
        resolve(new Gateway(socket, envelope.d, handlers));
      };
    });
  }

  /** Sends a request and resolves with its result payload. */
  request<T>(op: string, payload?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error("Not connected."));
        return;
      }

      this.seq += 1;
      const id = `c${this.seq}`;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The server did not reply in time."));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      try {
        this.socket.send(JSON.stringify({ id, op, d: payload ?? {} }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("The request could not be sent."));
      }
    });
  }

  /** Closes the connection. Pending requests are rejected. */
  close(reason = "client closed"): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.close(1000, reason);
    } catch {
      // Already gone.
    }
  }

  get isOpen(): boolean {
    return !this.closed && this.socket.readyState === WebSocket.OPEN;
  }

  private receive(event: MessageEvent): void {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(String(event.data)) as Envelope;
    } catch {
      return;
    }

    if (envelope.id) {
      const pending = this.pending.get(envelope.id);
      if (!pending) return;
      this.pending.delete(envelope.id);
      clearTimeout(pending.timer);

      if (envelope.op === OP_ERROR && envelope.error) {
        pending.reject(new AuralError(envelope.error));
      } else if (envelope.op === OP_RESULT) {
        pending.resolve(envelope.d);
      } else {
        pending.reject(new Error(`Unexpected reply "${envelope.op}".`));
      }
      return;
    }

    this.handlers.onEvent(envelope.op, envelope.d);
  }

  private finish(code: number, reason: string, clean: boolean): void {
    if (this.closed && this.pending.size === 0) {
      this.handlers.onClose({ code, reason, clean });
      return;
    }
    this.closed = true;

    const error = new Error(closeMessage(code, reason));
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();

    this.handlers.onClose({ code, reason, clean });
  }
}

/** Turns a close code into something worth showing a person. */
export function closeMessage(code: number, reason: string): string {
  if (reason) return reason;
  switch (code) {
    case 1000:
      return "Disconnected.";
    case 1001:
      return "The server is shutting down.";
    case 1006:
      // The browser withholds the cause of an abnormal close, so the two
      // realistic explanations are both worth naming.
      return "Lost connection. The server may be unreachable, or refusing this origin.";
    case 1008:
      return "The server rejected this connection.";
    case 1009:
      return "A message was too large.";
    default:
      return `Connection closed (${code}).`;
  }
}
