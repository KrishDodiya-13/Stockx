/**
 * Live market-data provider — Upstox, via this app's own server routes.
 *
 * This class runs in the browser, so it never talks to Upstox directly and
 * never reads `serverEnv` (which throws there by design). It reaches Upstox
 * through this app's own route handlers under `/api/market-data/*`, which
 * hold the credentials, cache upstream calls, and can enforce rate limits.
 *
 * ── How real-time prices arrive ────────────────────────────────────────────
 *
 * Upstox's real-time feed is protobuf-over-websocket behind a bearer token, so
 * the browser cannot open it without being handed that token. The websocket
 * therefore terminates on the server (`providers/upstox/feed.ts`) and this
 * provider consumes `/api/market-data/stream`, a server-sent-events
 * re-broadcast of the decoded prices. `subscribe()` opens one `EventSource`
 * for every instrument currently subscribed and turns each pushed `Quote` into
 * a `Tick`.
 *
 * A poll of `/api/market-data/quotes` remains as the fallback path, used when
 * `EventSource` is unavailable or the stream cannot be established. It is the
 * same data through the same server-side cache, just less prompt.
 *
 * ── Map vendor payloads here ────────────────────────────────────────────────
 *
 * All the Upstox-specific mapping (REST payload -> domain `Quote`/`Candle`)
 * lives server-side in `providers/upstox/client.ts`, which is the only module
 * that may see an Upstox-shaped object. This class only ever sees this app's
 * own domain types, already mapped by the API routes.
 */

import type { ConnectionStatus } from "@/domain/connection";
import type {
  Candle,
  Instrument,
  MarketStatus,
  Quote,
  SectorPerformance,
  Tick,
} from "@/domain/market";
import type { CandleRequest, MarketDataProvider, Unsubscribe } from "@/services/market-data/types";

export interface LiveProviderOptions {
  /**
   * Base path of this app's server-side market-data routes. The browser talks
   * only to these; they hold the vendor credentials.
   */
  readonly apiBasePath?: string;
  /** How often `subscribe()` polls for fresh quotes, in milliseconds. */
  readonly pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 3_000;

/** How often the same failing path may be logged. */
const LOG_INTERVAL_MS = 60_000;

const IDLE: ConnectionStatus = {
  state: "idle",
  detail: "Not subscribed to anything yet.",
  lastMessageAt: null,
  retryCount: 0,
};

interface QuotesErrorPayload {
  readonly error?: string;
  readonly message?: string;
}

/**
 * The stream's opening frame, describing the server-side feed's health.
 *
 * Deliberately free of anything sensitive — no token, no vendor URL, no
 * upstream error body. Only what the UI needs to describe its own state
 * honestly.
 */
interface StreamStatus {
  readonly state: string;
  readonly detail: string;
  /**
   * Whether the server has actually decoded a tick.
   *
   * Separate from `state` on purpose: a socket can be open and subscribed and
   * still deliver nothing — a wrong instrument key or a schema mismatch both
   * look exactly like a healthy connection from the outside.
   */
  readonly receiving?: boolean;
  readonly marketOpen: boolean;
  readonly phase: string;
  readonly live: number;
  readonly unsupported: readonly string[];
  readonly configured: boolean;
}

export class LiveMarketDataProvider implements MarketDataProvider {
  readonly name = "live";
  /** Only ever "live" — this provider must not emit simulated values. */
  readonly source = "live" as const;

  private readonly apiBasePath: string;
  private readonly pollIntervalMs: number;
  private readonly connectionListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly tickListeners = new Map<string, Set<(tick: Tick) => void>>();
  private connection: ConnectionStatus = IDLE;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** The open SSE connection, when one is up. */
  private stream: EventSource | null = null;
  /** The instrument set `stream` was opened for, so repeats do not reconnect. */
  private streamKey: string | null = null;
  /** Last time each path's failure was logged, for the throttle. */
  private readonly lastLoggedAt = new Map<string, number>();
  /** Set while a stream (re)connect is already queued for this tick. */
  private streamScheduled = false;
  private polling = false;
  private disposed = false;

  constructor(options: LiveProviderOptions = {}) {
    this.apiBasePath = options.apiBasePath ?? "/api/market-data";
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  // --- REST, proxied through this app's server so the key stays server-side --

  async listInstruments(): Promise<readonly Instrument[]> {
    return this.getJson<readonly Instrument[]>("/instruments", []);
  }

  async searchInstruments(query: string, limit = 12): Promise<readonly Instrument[]> {
    const search = new URLSearchParams({ q: query, limit: String(limit) });
    return this.getJson<readonly Instrument[]>(`/instruments?${search}`, []);
  }

  async getQuote(instrumentId: string): Promise<Quote | null> {
    const quotes = await this.getQuotes([instrumentId]);
    return quotes[0] ?? null;
  }

  async getQuotes(instrumentIds: readonly string[]): Promise<readonly Quote[]> {
    if (instrumentIds.length === 0) return [];
    const search = new URLSearchParams({ ids: instrumentIds.join(",") });
    return this.getJson<readonly Quote[]>(`/quotes?${search}`, []);
  }

  async getCandles(request: CandleRequest): Promise<readonly Candle[]> {
    const search = new URLSearchParams({
      id: request.instrumentId,
      interval: request.interval,
      from: String(request.from),
      to: String(request.to),
    });
    const candles = await this.getJson<readonly Candle[]>(`/candles?${search}`, []);

    // Defence in depth: the Time Machine's guarantee that no future price can
    // leak must not depend on a vendor honouring the requested window.
    return candles.filter((candle) => candle.time <= request.to);
  }

  async getSectorPerformance(): Promise<readonly SectorPerformance[]> {
    return this.getJson<readonly SectorPerformance[]>("/sectors", []);
  }

  async getMarketStatus(): Promise<MarketStatus> {
    return this.getJson<MarketStatus>("/status", {
      phase: "closed",
      timestamp: Date.now(),
      source: this.source,
    });
  }

  // --- streaming ------------------------------------------------------------

  subscribe(instrumentIds: readonly string[], onTick: (tick: Tick) => void): Unsubscribe {
    if (this.disposed) return () => {};

    for (const id of instrumentIds) {
      let set = this.tickListeners.get(id);
      if (!set) {
        set = new Set();
        this.tickListeners.set(id, set);
      }
      set.add(onTick);
    }

    this.scheduleStream();

    return () => {
      for (const id of instrumentIds) {
        const set = this.tickListeners.get(id);
        if (!set) continue;
        set.delete(onTick);
        if (set.size === 0) this.tickListeners.delete(id);
      }

      if (this.tickListeners.size === 0) {
        this.closeStream();
        this.stopPolling();
      } else {
        // The subscription set shrank; re-open so the server stops sending
        // instruments nothing is listening to any more. Coalesced, so a table
        // unmounting row by row does not reconnect once per row.
        this.scheduleStream();
      }
    };
  }

  /**
   * Ask for the stream to match the current subscription set, once this tick.
   *
   * `ensureStream` compares against the set it last connected for, which is
   * correct but not sufficient: ninety components subscribing in one
   * synchronous pass each changed that set, so each one tore down the
   * `EventSource` and opened another. One page load opened ninety connections,
   * and every one of them re-entered the feed on the server.
   *
   * Deferring to a microtask means the set is read once, after all ninety have
   * registered — one connection, for the union of what is actually watched.
   */
  private scheduleStream(): void {
    if (this.streamScheduled || this.disposed) return;
    this.streamScheduled = true;

    queueMicrotask(() => {
      this.streamScheduled = false;
      this.ensureStream();
    });
  }

  /**
   * Open (or re-open) the SSE stream for the current subscription set.
   *
   * Guarded by `streamKey`, so a set that has not actually changed reuses the
   * open connection. Call `scheduleStream()` rather than this directly.
   */
  private ensureStream(): void {
    if (this.disposed || this.tickListeners.size === 0) return;

    const ids = [...this.tickListeners.keys()].sort();
    const key = ids.join(",");
    if (key === this.streamKey && this.stream !== null) return;

    if (typeof EventSource === "undefined") {
      // No SSE in this environment (SSR, or a test runner). Poll instead.
      this.ensurePolling();
      return;
    }

    this.closeStream();
    this.streamKey = key;

    this.setConnection({
      state: "connecting",
      detail: "Opening the live price stream…",
      lastMessageAt: this.connection.lastMessageAt,
      retryCount: 0,
    });

    const source = new EventSource(
      `${this.apiBasePath}/stream?${new URLSearchParams({ ids: key })}`,
    );
    this.stream = source;

    source.addEventListener("quotes", (event) => {
      const quotes = this.parse<readonly Quote[]>(event);
      if (!quotes) return;

      for (const quote of quotes) this.emit(quote);

      // Prices arrived, so the feed is demonstrably working whatever the last
      // status frame claimed.
      this.setConnection({
        state: "connected",
        detail: "Streaming live prices.",
        lastMessageAt: Date.now(),
        retryCount: 0,
      });
    });

    source.addEventListener("status", (event) => {
      const status = this.parse<StreamStatus>(event);
      if (!status) return;

      /*
        The server tells us whether it actually has a feed. Surfacing that
        verbatim matters: "no token configured" must not be shown as a healthy
        connection that simply has nothing to say, nor as a quiet market.

        A feed that is merely idle because the market is closed is a different
        thing from one that is broken, and only the second should read as
        disconnected.
      */
      const state: ConnectionStatus["state"] =
        // "connected" requires a decoded tick, not merely an open socket.
        status.state === "live" && status.receiving !== false
          ? "connected"
          : status.state === "connecting" || status.state === "live"
            ? "connecting"
            : !status.configured || status.state === "error" || status.state === "no-token"
              ? "offline"
              : status.marketOpen
                ? "reconnecting"
                : "idle";

      this.setConnection({
        state,
        detail: status.detail,
        lastMessageAt: this.connection.lastMessageAt,
        retryCount: 0,
      });
    });

    source.addEventListener("error", () => {
      /*
        `EventSource` reconnects on its own, so this is a status update rather
        than a place to build another retry loop. Only a permanently closed
        stream falls back to polling.
      */
      if (source.readyState === EventSource.CLOSED) {
        this.stream = null;
        this.streamKey = null;
        this.setConnection({
          state: "reconnecting",
          detail: "Live stream closed; falling back to polling.",
          lastMessageAt: this.connection.lastMessageAt,
          retryCount: this.connection.retryCount + 1,
        });
        this.ensurePolling();
        return;
      }

      this.setConnection({
        state: "reconnecting",
        detail: "Live stream interrupted; reconnecting…",
        lastMessageAt: this.connection.lastMessageAt,
        retryCount: this.connection.retryCount + 1,
      });
    });
  }

  private parse<T>(event: Event): T | null {
    const data = (event as MessageEvent<string>).data;
    if (typeof data !== "string") return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  /** Fan one quote out to whoever subscribed to that instrument. */
  private emit(quote: Quote): void {
    const listeners = this.tickListeners.get(quote.instrumentId);
    if (!listeners) return;

    const tick: Tick = {
      instrumentId: quote.instrumentId,
      price: quote.price,
      volume: quote.volume,
      timestamp: quote.timestamp,
      source: quote.source,
      // Carried through rather than dropped: this is the server's freshest
      // statement of the close the day's change is measured against.
      previousClose: quote.previousClose,
    };

    for (const listener of listeners) {
      try {
        listener(tick);
      } catch (error) {
        this.logOnce(`subscriber:${quote.instrumentId}`, error);
      }
    }
  }

  private closeStream(): void {
    this.stream?.close();
    this.stream = null;
    this.streamKey = null;
  }

  private ensurePolling(): void {
    if (this.pollTimer !== null || this.tickListeners.size === 0) return;

    this.setConnection({
      state: "connecting",
      detail: "Requesting the first quote poll…",
      lastMessageAt: null,
      retryCount: 0,
    });

    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.setConnection({
      state: "idle",
      detail: "Not subscribed to anything.",
      lastMessageAt: this.connection.lastMessageAt,
      retryCount: 0,
    });
  }

  /** One polling cycle: fetch quotes for everything currently subscribed. */
  private async poll(): Promise<void> {
    if (this.polling || this.tickListeners.size === 0) return;
    this.polling = true;

    const instrumentIds = [...this.tickListeners.keys()];

    try {
      const search = new URLSearchParams({ ids: instrumentIds.join(",") });
      const response = await fetch(`${this.apiBasePath}/quotes?${search}`, { cache: "no-store" });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as QuotesErrorPayload;
        throw new Error(payload.message ?? `Quote poll failed (${response.status})`);
      }

      const quotes = (await response.json()) as readonly Quote[];
      const now = Date.now();

      for (const quote of quotes) this.emit(quote);

      this.setConnection({
        state: "connected",
        detail: `Polling Upstox every ${Math.round(this.pollIntervalMs / 1000)}s.`,
        lastMessageAt: now,
        retryCount: 0,
      });
    } catch (error) {
      const retryCount = this.connection.retryCount + 1;
      this.logOnce("/quotes-poll", error);
      this.setConnection({
        state: retryCount > 3 ? "offline" : "reconnecting",
        detail: error instanceof Error ? error.message : "Quote poll failed.",
        lastMessageAt: this.connection.lastMessageAt,
        retryCount,
      });
    } finally {
      this.polling = false;
    }
  }

  // --- plumbing -------------------------------------------------------------

  private async getJson<T>(path: string, fallback: T): Promise<T> {
    try {
      const response = await fetch(`${this.apiBasePath}${path}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as QuotesErrorPayload;
        throw new Error(payload.message ?? `Request failed (${response.status})`);
      }
      return (await response.json()) as T;
    } catch (error) {
      /*
        Return the empty fallback rather than throwing: a data outage should
        render an empty state, never a fabricated price, and never an unhandled
        rejection that takes the page down with it.

        Logged at most once per path per minute. A dashboard watching a dozen
        instruments used to emit a dozen identical stack traces per poll, which
        buried anything else in the console and read as a crash when it was
        really one vendor outage repeated.
      */
      this.logOnce(path, error);

      /*
        A price request that failed is the clearest evidence there is that the
        feed is down, and it arrives even when the market is closed and the
        websocket is deliberately idle. Without this the pill would read
        "Idle" — indistinguishable from a quiet market — while nothing on the
        page could be priced at all.

        Only price paths count. Reference data failing says nothing about the
        feed, and a healthy stream is not demoted by one lost poll.
      */
      const pricePath = path.startsWith("/quotes") || path.startsWith("/candles");
      if (pricePath && this.connection.state !== "connected") {
        this.setConnection({
          state: "offline",
          detail: "Live prices are unavailable — Upstox could not be reached.",
          lastMessageAt: this.connection.lastMessageAt,
          retryCount: this.connection.retryCount + 1,
        });
      }

      return fallback;
    }
  }

  /** Log a failure for this path at most once per `LOG_INTERVAL_MS`. */
  private logOnce(path: string, error: unknown): void {
    const key = path.split("?")[0] ?? path;
    const now = Date.now();
    const last = this.lastLoggedAt.get(key) ?? 0;
    if (now - last < LOG_INTERVAL_MS) return;

    this.lastLoggedAt.set(key, now);
    // The message only — never the error object, which can carry request
    // details, and never anything that could hold a credential.
    console.warn(
      `[market-data] ${key} unavailable: ${error instanceof Error ? error.message : "request failed"}`,
    );
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connection;
  }

  onConnectionChange(listener: (status: ConnectionStatus) => void): Unsubscribe {
    this.connectionListeners.add(listener);
    listener(this.connection);
    return () => this.connectionListeners.delete(listener);
  }

  private setConnection(status: ConnectionStatus): void {
    this.connection = status;
    for (const listener of this.connectionListeners) listener(status);
  }

  dispose(): void {
    this.disposed = true;
    this.closeStream();
    this.stopPolling();
    this.tickListeners.clear();
    this.connectionListeners.clear();
  }
}
