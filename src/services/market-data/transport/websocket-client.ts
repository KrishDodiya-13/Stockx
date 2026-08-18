/**
 * Resilient WebSocket client.
 *
 * Provider-agnostic transport: it knows nothing about quotes or symbols, only
 * about keeping a socket alive and delivering frames. A market feed drops
 * constantly — laptops sleep, wifi switches, vendors restart — so the parts
 * that are easy to omit and expensive to lack are all here:
 *
 *   - exponential backoff with jitter, so a vendor outage does not turn every
 *     client into a synchronised retry storm
 *   - a heartbeat that detects a socket which is open but no longer delivering
 *     (far more common than a clean close)
 *   - subscription state held independently of the socket, and replayed on every
 *     reconnect, so a drop does not silently stop updates for a symbol
 *   - outbound queueing while disconnected
 *
 * The URL must be produced server-side (see the market-data route handlers) so
 * a vendor key is never embedded in a browser bundle.
 */

import type { ConnectionState, ConnectionStatus } from "@/domain/connection";

export interface WebSocketClientOptions {
  /**
   * Resolves the socket URL. A function rather than a string so a short-lived
   * signed URL can be re-fetched on each reconnect.
   */
  readonly resolveUrl: () => Promise<string> | string;
  /** Frames to send immediately after the socket opens (auth, etc.). */
  readonly onOpenMessages?: () => readonly unknown[];
  /** Called for every inbound frame, already JSON-parsed where possible. */
  readonly onMessage: (payload: unknown) => void;
  readonly onStatusChange?: (status: ConnectionStatus) => void;
  /** Milliseconds without a frame before the socket is presumed dead. */
  readonly heartbeatTimeoutMs?: number;
  /** Frame sent periodically to keep intermediaries from idling the socket. */
  readonly heartbeatMessage?: () => unknown;
  readonly heartbeatIntervalMs?: number;
  /** Give up after this many consecutive failures. 0 means never give up. */
  readonly maxRetries?: number;
  readonly socketFactory?: (url: string) => WebSocket;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export class WebSocketClient {
  private readonly options: WebSocketClientOptions;
  private socket: WebSocket | null = null;
  private status: ConnectionStatus;

  /** Frames queued while the socket is down, flushed on open. */
  private readonly outbox: unknown[] = [];
  /**
   * Subscription intent, independent of the socket. This is the reason a
   * dropped connection does not lose symbols: on reconnect, everything here is
   * re-sent.
   */
  private readonly desiredSubscriptions = new Set<string>();

  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** Guards against a stale socket's handlers acting after a newer one opens. */
  private generation = 0;

  constructor(options: WebSocketClientOptions) {
    this.options = options;
    this.status = {
      state: "idle",
      detail: "Not connected.",
      lastMessageAt: null,
      retryCount: 0,
    };
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Record subscription intent and send it if the socket is up. */
  addSubscriptions(keys: readonly string[], frame: (keys: readonly string[]) => unknown): void {
    const added = keys.filter((key) => !this.desiredSubscriptions.has(key));
    for (const key of added) this.desiredSubscriptions.add(key);
    if (added.length > 0) this.send(frame(added));
  }

  removeSubscriptions(keys: readonly string[], frame: (keys: readonly string[]) => unknown): void {
    const removed = keys.filter((key) => this.desiredSubscriptions.delete(key));
    if (removed.length > 0) this.send(frame(removed));
  }

  getSubscriptions(): readonly string[] {
    return [...this.desiredSubscriptions];
  }

  async connect(): Promise<void> {
    if (this.disposed || this.socket) return;

    this.setStatus("connecting", "Opening the market data connection…");

    const generation = ++this.generation;

    let url: string;
    try {
      url = await this.options.resolveUrl();
    } catch (error) {
      this.scheduleReconnect(`Could not resolve the feed URL: ${describe(error)}`);
      return;
    }

    // A newer connect() started (or we were disposed) while awaiting the URL.
    if (this.disposed || generation !== this.generation) return;

    try {
      const socket = this.options.socketFactory
        ? this.options.socketFactory(url)
        : new WebSocket(url);
      this.socket = socket;

      socket.onopen = () => {
        if (generation !== this.generation) return;
        this.setStatus("connected", "Receiving market data.", { retryCount: 0 });

        for (const message of this.options.onOpenMessages?.() ?? []) this.transmit(message);

        // Replay subscription intent — the vendor knows nothing of what this
        // client wanted before the drop.
        this.flushOutbox();
        this.startHeartbeat();
        this.armWatchdog();
      };

      socket.onmessage = (event: MessageEvent) => {
        if (generation !== this.generation) return;
        this.status = { ...this.status, lastMessageAt: Date.now() };
        this.armWatchdog();

        let payload: unknown = event.data;
        if (typeof event.data === "string") {
          try {
            payload = JSON.parse(event.data);
          } catch {
            // Not JSON — hand the raw frame through rather than dropping it.
          }
        }
        this.options.onMessage(payload);
      };

      socket.onerror = () => {
        if (generation !== this.generation) return;
        // `onerror` is always followed by `onclose`; reconnect is handled there
        // so a single failure does not schedule two retries.
      };

      socket.onclose = (event: CloseEvent) => {
        if (generation !== this.generation) return;
        this.teardownSocket();
        this.scheduleReconnect(
          event.reason ? `Connection closed: ${event.reason}` : "Connection closed.",
        );
      };
    } catch (error) {
      this.scheduleReconnect(`Could not open the connection: ${describe(error)}`);
    }
  }

  /** Send now, or queue until the socket is open. */
  send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.transmit(message);
      return;
    }
    this.outbox.push(message);
  }

  disconnect(detail = "Disconnected."): void {
    this.clearTimers();
    this.teardownSocket();
    this.setStatus("idle", detail);
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.clearTimers();
    this.teardownSocket();
    this.outbox.length = 0;
    this.desiredSubscriptions.clear();
  }

  // --- internals -----------------------------------------------------------

  private transmit(message: unknown): void {
    try {
      this.socket?.send(typeof message === "string" ? message : JSON.stringify(message));
    } catch (error) {
      console.error("[market-data/ws] failed to send frame", error);
    }
  }

  private flushOutbox(): void {
    while (this.outbox.length > 0) {
      const message = this.outbox.shift();
      if (message !== undefined) this.transmit(message);
    }
  }

  private startHeartbeat(): void {
    const { heartbeatMessage, heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS } = this.options;
    if (!heartbeatMessage) return;

    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.send(heartbeatMessage()), heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === null) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /**
   * A socket can stay `OPEN` while delivering nothing at all. The watchdog
   * treats prolonged silence as a failure and forces a reconnect.
   */
  private armWatchdog(): void {
    const timeout = this.options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    if (this.watchdogTimer !== null) clearTimeout(this.watchdogTimer);

    this.watchdogTimer = setTimeout(() => {
      this.teardownSocket();
      this.scheduleReconnect("No data received — the connection went quiet.");
    }, timeout);
  }

  private scheduleReconnect(detail: string): void {
    if (this.disposed) return;

    const retryCount = this.status.retryCount + 1;
    const maxRetries = this.options.maxRetries ?? 0;

    if (maxRetries > 0 && retryCount > maxRetries) {
      this.setStatus("offline", `${detail} Giving up after ${maxRetries} attempts.`, {
        retryCount,
      });
      return;
    }

    // Exponential backoff, capped, with jitter so many clients returning from
    // the same outage do not retry in lockstep.
    const capped = Math.min(BASE_BACKOFF_MS * 2 ** (retryCount - 1), MAX_BACKOFF_MS);
    const delay = Math.round(capped * (0.5 + Math.random() * 0.5));

    this.setStatus("reconnecting", `${detail} Retrying in ${Math.round(delay / 1000)}s.`, {
      retryCount,
    });

    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private teardownSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.stopHeartbeat();

    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Already closing — nothing to do.
    }
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.stopHeartbeat();
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private setStatus(
    state: ConnectionState,
    detail: string,
    extra: Partial<ConnectionStatus> = {},
  ): void {
    this.status = {
      state,
      detail,
      lastMessageAt: this.status.lastMessageAt,
      retryCount: this.status.retryCount,
      ...extra,
    };
    this.options.onStatusChange?.(this.status);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
