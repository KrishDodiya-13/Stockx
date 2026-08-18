import "server-only";

import type { Quote } from "@/domain/market";
import { dayChange } from "@/domain/day-change";
import { rupeesToPrice, type PriceE4 } from "@/lib/money";
import { serverEnv } from "@/config/env";
import { isMarketOpen } from "@/services/market-data/market-hours";
import { MARKET_DATA_FEED_V3_PROTO } from "@/services/market-data/providers/upstox/market-data-feed-v3.proto";
import {
  fromUpstoxKey,
  toUpstoxKey,
} from "@/services/market-data/providers/upstox/instrument-keys";

/**
 * The Upstox Market Data Feed V3, as one process-wide connection.
 *
 * ── Why the socket is opened directly ──────────────────────────────────────
 *
 * This used to go through `upstox-js-sdk`'s `MarketDataStreamerV3`. That class
 * decodes each protobuf frame and then does `push(JSON.stringify(decoded))`
 * into a non-object-mode Node stream, so what finally reaches a `message`
 * listener is a raw `Buffer` — not the decoded object its shape suggests.
 *
 * Reading `.feeds` off a Buffer yields `undefined`, so every frame was
 * discarded and the price cache never filled. Forty frames arrived in fifteen
 * seconds and none of them landed.
 *
 * Rather than parse a Buffer back out of a stream that re-encoded it, this
 * opens the websocket and decodes the frames itself. The schema is still the
 * vendor's own `.proto` — none of the field numbers are guessed — but the
 * lossy layer in between is gone, and the subscription payload, the reconnect
 * policy and the diagnostics are all things this file now controls.
 *
 * ── The token never leaves the server ──────────────────────────────────────
 *
 * `server-only` makes importing this from a client component a build error, and
 * the token is read from `serverEnv`, which throws if touched in a browser
 * bundle. Prices reach React over SSE; the credential does not travel with
 * them, and nothing here logs it.
 *
 * ── What this will not do ──────────────────────────────────────────────────
 *
 * It never invents a price. If the socket is down, the token is missing or an
 * instrument has no vendor key, the quote is simply absent — the simulator is
 * not used as a silent fallback.
 */

/** A tick as this app models it, decoded from Upstox's LTPC message. */
export interface LiveTick {
  readonly instrumentId: string;
  /** Last traded price. */
  readonly ltp: number;
  /**
   * Previous close, as Upstox reports it in `ltpc.cp`.
   *
   * Null when the frame carried none. It used to be coerced to 0 here and then
   * back to the last traded price downstream, which turned "Upstox did not
   * send a close" into "this instrument is exactly unchanged".
   */
  readonly cp: number | null;
  /** Last traded time, epoch ms. */
  readonly ltt: number;
  readonly receivedAt: number;
}

export type FeedState = "idle" | "connecting" | "live" | "reconnecting" | "error" | "no-token";

export interface FeedStatus {
  readonly state: FeedState;
  readonly detail: string;
  readonly subscribed: number;
  readonly lastTickAt: number | null;
  /**
   * True only once a socket is open, a subscription has been sent, and at
   * least one real tick has been decoded.
   *
   * A connected socket is not a working feed: a wrong instrument key, a
   * rejected subscription or a schema mismatch all leave the connection up and
   * perfectly silent. The UI must not claim LIVE on the strength of a TCP
   * handshake, so this is the flag it reads.
   */
  readonly receiving: boolean;
}

/** Upstox drops a connection that has been idle; reconnect on a backoff. */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** A feed that has gone quiet this long during market hours is treated as stale. */
const STALE_AFTER_MS = 90_000;

/** Upstox mints a short-lived, pre-authorised socket URL. */
const AUTHORIZE_URL = "https://api.upstox.com/v3/feed/market-data-feed/authorize";

/** Bounded so a hung vendor cannot leave a connect attempt outstanding forever. */
const AUTHORIZE_TIMEOUT_MS = 10_000;

/**
 * Server-side diagnostics.
 *
 * Deliberately a fixed set of short, structured lines. Every one is safe to
 * ship to a log aggregator: no token, no socket URL (it carries a one-time
 * auth code), and no vendor error object, which can quote request headers.
 */
function log(message: string): void {
  console.log(`[UPSTOX] ${message}`);
}

interface LtpcMessage {
  ltp?: number | string;
  ltt?: number | string;
  cp?: number | string;
}

interface FeedEntry {
  ltpc?: LtpcMessage;
  fullFeed?: { marketFF?: { ltpc?: LtpcMessage }; indexFF?: { ltpc?: LtpcMessage } };
}

interface DecodedFrame {
  type?: string;
  feeds?: Record<string, FeedEntry>;
}

/** Minimal shape of the protobuf type this decodes with. */
interface ProtoType {
  decode(buffer: Uint8Array): unknown;
  toObject(message: unknown, options: Record<string, unknown>): DecodedFrame;
}

class UpstoxFeed {
  private socket: WebSocket | null = null;
  private proto: ProtoType | null = null;
  private connecting: Promise<void> | null = null;
  private disposed = false;

  /** Latest tick per *app* instrument id. Survives disconnects on purpose. */
  private readonly ticks = new Map<string, LiveTick>();

  /** Vendor keys currently subscribed, so a repeat never re-subscribes. */
  private readonly subscribed = new Set<string>();

  /**
   * App instrument ids anyone has asked for, whether or not the socket was up
   * at the time. Replayed on connect, so a request that arrived while the feed
   * was still handshaking is not silently dropped.
   */
  private readonly wanted = new Set<string>();

  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private receiving = false;
  private announcedSnapshot = false;
  private announcedTick = false;

  private status: FeedStatus = {
    state: "idle",
    detail: "Feed not started.",
    subscribed: 0,
    lastTickAt: null,
    receiving: false,
  };

  private readonly listeners = new Set<(tick: LiveTick) => void>();

  getStatus(): FeedStatus {
    return this.status;
  }

  private setStatus(state: FeedState, detail: string): void {
    this.status = {
      state,
      detail,
      subscribed: this.subscribed.size,
      lastTickAt: this.status.lastTickAt,
      receiving: this.receiving,
    };
  }

  /** Every quote the feed currently knows about. */
  snapshot(): readonly LiveTick[] {
    return [...this.ticks.values()];
  }

  latest(instrumentId: string): LiveTick | null {
    return this.ticks.get(instrumentId) ?? null;
  }

  /** How many instruments have produced at least one tick. */
  tickingCount(): number {
    return this.ticks.size;
  }

  onTick(listener: (tick: LiveTick) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Ask the feed to cover these instruments, and return immediately.
   *
   * Synchronous by design: nothing about serving a price needs the socket to be
   * up. The cache answers from whatever has arrived, REST fills the gaps, and
   * the socket connects on its own time — so connecting is started here and
   * deliberately not awaited. Putting a TLS handshake on the critical path of a
   * page render is what made live mode feel broken.
   *
   * Safe to call per request: connect is guarded by an in-flight promise and
   * subscriptions are diffed, so repeats open no second socket.
   */
  ensure(instrumentIds: readonly string[]): FeedStatus {
    if (this.disposed) return this.status;

    if (!serverEnv.upstoxAccessToken) {
      this.setStatus(
        "no-token",
        "No Upstox access token configured. Set UPSTOX_ACCESS_TOKEN to receive live prices.",
      );
      return this.status;
    }

    /*
      Outside market hours there is nothing to stream. Upstox sends no ticks,
      and holding a socket open overnight only invites the vendor to drop it and
      this class to reconnect in a loop. The cached last traded prices stay in
      memory, which is what the closed-market UI shows.
    */
    if (!isMarketOpen()) {
      this.setStatus("idle", "Market closed — showing the last traded prices received.");
      return this.status;
    }

    for (const id of instrumentIds) this.wanted.add(id);

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.subscribe(instrumentIds);
    } else {
      void this.connect();
    }

    return this.status;
  }

  private async connect(): Promise<void> {
    if (this.socket || this.disposed) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting", "Connecting to Upstox…");

      try {
        const proto = await this.loadProto();
        const url = await this.authorize();
        if (!url) {
          this.setStatus("error", "Upstox did not authorise a feed connection.");
          this.scheduleReconnect();
          return;
        }

        /*
          Node's built-in WebSocket, not the `ws` package.

          `ws` masks outgoing frames through the optional native `bufferutil`
          addon. Bundled into a Next server build that addon does not resolve,
          and every send throws `TypeError: b.mask is not a function` — so the
          subscribe frame never left the process. The socket was connected, the
          logs said "subscribed", and Upstox had been told nothing, which is
          exactly what a frozen price screen looks like.

          The platform WebSocket has no native dependency and no bundler to
          confuse. It needs Node 22 or newer, which this project already
          requires.
        */
        const socket = new WebSocket(url);
        // Frames arrive as protobuf; without this they would be Blobs.
        socket.binaryType = "arraybuffer";

        socket.addEventListener("open", () => {
          this.attempt = 0;
          log("connected");
          this.socket = socket;
          this.setStatus("connecting", "Connected; subscribing…");

          // A reconnect starts with no server-side subscriptions, so replay
          // from `wanted`, which is the durable record of what was asked for.
          this.subscribed.clear();
          this.subscribe([...this.wanted]);
        });

        socket.addEventListener("message", (event: MessageEvent) => {
          const payload = event.data;
          if (!(payload instanceof ArrayBuffer)) return;
          this.ingest(new Uint8Array(payload), proto);
        });

        socket.addEventListener("error", () => {
          // Never the error object: it can carry request headers, and headers
          // carry the bearer token.
          log("socket error; will retry");
          this.setStatus("error", "Upstox feed error; retrying.");
        });

        socket.addEventListener("close", () => {
          log("disconnected");
          this.socket = null;
          this.receiving = false;
          this.announcedSnapshot = false;
          this.announcedTick = false;
          if (!this.disposed) this.scheduleReconnect();
        });
      } catch {
        this.setStatus("error", "Could not connect to Upstox.");
        this.scheduleReconnect();
      } finally {
        this.connecting = null;
      }
    })();

    return this.connecting;
  }

  /** Compile the vendor schema once per process. */
  private async loadProto(): Promise<ProtoType> {
    if (this.proto) return this.proto;

    const protobuf = await import("protobufjs");
    const root = protobuf.parse(MARKET_DATA_FEED_V3_PROTO).root;
    this.proto = root.lookupType(
      "com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse",
    ) as unknown as ProtoType;
    return this.proto;
  }

  /**
   * Exchange the access token for a one-time socket URL.
   *
   * The token is sent in the Authorization header and never appears in a log
   * line. The URL that comes back embeds a single-use code, so it is not logged
   * either.
   */
  private async authorize(): Promise<string | null> {
    const response = await fetch(AUTHORIZE_URL, {
      headers: {
        Authorization: `Bearer ${serverEnv.upstoxAccessToken ?? ""}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(AUTHORIZE_TIMEOUT_MS),
    });

    if (!response.ok) {
      log(`authorize failed (${response.status})`);
      return null;
    }

    const payload = (await response.json()) as { data?: { authorizedRedirectUri?: string } };
    return payload.data?.authorizedRedirectUri ?? null;
  }

  /** Exponential backoff with jitter, so a vendor outage is not hammered. */
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;

    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempt);
    this.attempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (isMarketOpen()) void this.connect();
    }, delay + Math.random() * 250);
  }

  /**
   * Send a subscription for instruments not already covered.
   *
   * The payload is the V3 contract exactly: a `sub` method carrying the mode
   * and the vendor instrument keys.
   */
  private subscribe(instrumentIds: readonly string[]): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const keys: string[] = [];
    for (const id of instrumentIds) {
      const key = toUpstoxKey(id);
      // No vendor key means no feed for this instrument. Silence, not a guess.
      if (!key || this.subscribed.has(key)) continue;
      keys.push(key);
    }

    if (keys.length === 0) return;

    /*
      Sent as a *binary* frame, not text.

      Upstox's V3 feeder ignores a text frame carrying the same JSON — it
      accepts the subscription only over a binary one. Passing a string to
      `WebSocket.send` produces a text frame, so the request left the process,
      arrived, and was silently discarded: socket open, nothing subscribed, no
      ticks, and no error anywhere to explain it.
    */
    socket.send(
      new TextEncoder().encode(
        JSON.stringify({
          guid: `stockx-${Date.now()}`,
          method: "sub",
          data: { mode: "ltpc", instrumentKeys: keys },
        }),
      ),
    );

    for (const key of keys) this.subscribed.add(key);
    log(`subscribed: ${this.subscribed.size} instruments`);
    this.setStatus(this.status.state, this.status.detail);
  }

  /**
   * Decode one frame and fold its prices into the cache.
   *
   * `feeds` is keyed by the vendor instrument key. LTPC mode puts the prices at
   * `ltpc`; index feeds nest theirs under `fullFeed.indexFF`, so both are read
   * rather than assuming the flat shape.
   */
  private ingest(data: Uint8Array, proto: ProtoType): void {
    let frame: DecodedFrame;
    try {
      frame = proto.toObject(proto.decode(data), {
        longs: String,
        defaults: true,
      });
    } catch {
      // A frame this app cannot read is dropped, not fatal.
      log("undecodable frame dropped");
      return;
    }

    const feeds = frame.feeds;
    if (!feeds) return;

    if (!this.announcedSnapshot) {
      this.announcedSnapshot = true;
      log(`first market snapshot received (${Object.keys(feeds).length} instruments)`);
    }

    const receivedAt = Date.now();
    let delivered = 0;

    for (const [vendorKey, entry] of Object.entries(feeds)) {
      const ltpc =
        entry?.ltpc ?? entry?.fullFeed?.marketFF?.ltpc ?? entry?.fullFeed?.indexFF?.ltpc;
      if (!ltpc) continue;

      const instrumentId = fromUpstoxKey(vendorKey);
      // A key this app does not recognise is ignored rather than cached under a
      // guessed id, which would show one company's price against another.
      if (!instrumentId) continue;

      const ltp = Number(ltpc.ltp);
      // A zero or absent last traded price is not a price; publishing it would
      // read as a 100% crash.
      if (!Number.isFinite(ltp) || ltp <= 0) continue;

      // `ltt` is an int64, which protobufjs renders as a string.
      const ltt = Number(ltpc.ltt);

      // `cp` absent or zero is "not sent", which is not the same as a close of
      // zero and must not become one.
      const cp = Number(ltpc.cp);

      const tick: LiveTick = {
        instrumentId,
        ltp,
        cp: Number.isFinite(cp) && cp > 0 ? cp : null,
        ltt: Number.isFinite(ltt) && ltt > 0 ? ltt : receivedAt,
        receivedAt,
      };

      this.ticks.set(instrumentId, tick);
      delivered += 1;

      for (const listener of this.listeners) {
        try {
          listener(tick);
        } catch {
          // One bad subscriber must not stall the feed.
        }
      }
    }

    if (delivered === 0) return;

    if (!this.announcedTick) {
      this.announcedTick = true;
      log("live tick received");
    }

    this.receiving = true;
    this.status = { ...this.status, lastTickAt: receivedAt, receiving: true };
    this.setStatus("live", "Receiving live prices from Upstox.");
  }

  /** Close the socket and drop timers. Called on server shutdown. */
  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    try {
      this.socket?.close();
    } catch {
      // Already gone.
    }

    if (this.status.lastTickAt) log(`last tick timestamp: ${new Date(this.status.lastTickAt).toISOString()}`);

    this.socket = null;
    this.receiving = false;
    this.subscribed.clear();
    this.listeners.clear();
    this.setStatus("idle", "Feed disposed.");
  }
}

/*
  One instance per process, kept on `globalThis` so Next's dev-mode module
  reloading does not leave a second socket connected behind the first — the same
  reason the Prisma client is held this way.
*/
const globalForFeed = globalThis as unknown as { __upstoxFeed?: UpstoxFeed };

export const upstoxFeed: UpstoxFeed = (globalForFeed.__upstoxFeed ??= new UpstoxFeed());

/** Close the socket when the server goes down. Registered once. */
if (!(globalThis as { __upstoxFeedShutdown?: boolean }).__upstoxFeedShutdown) {
  (globalThis as { __upstoxFeedShutdown?: boolean }).__upstoxFeedShutdown = true;
  for (const signal of ["SIGTERM", "SIGINT", "beforeExit"] as const) {
    process.once(signal, () => upstoxFeed.dispose());
  }
}

/**
 * A live tick as this app's `Quote`.
 *
 * Prices convert to `PriceE4` at this boundary, so nothing downstream ever
 * handles a vendor float. `source: "live"` is what lets the UI label the data
 * honestly rather than showing it as simulated.
 */
export function tickToQuote(tick: LiveTick): Quote {
  const price = rupeesToPrice(tick.ltp);

  /*
    The day's change comes from `ltpc.cp` and nothing else.

    Every fallback that once stood here was a way of writing zero: `tick.cp ||
    tick.ltp` made the previous close equal the last price, so the change and
    the percentage were both exactly 0 whenever Upstox had not sent a close.
    An unknown close now stays unknown all the way to the cell, which renders
    "--".
  */
  const { previousClose, change, changePercent } = dayChange(price, toPrice(tick.cp));

  return {
    instrumentId: tick.instrumentId,
    price,
    previousClose,
    change,
    changePercent,
    /*
      The feed runs in LTPC mode, which carries a price, a close and a time —
      no OHLC and no volume. These were being filled in with the previous close
      and the last price respectively, which reads on screen as a real session
      open and a day range of zero width. Null says what is true: not sent.
    */
    open: null,
    dayHigh: null,
    dayLow: null,
    volume: 0,
    averageVolume: 0,
    timestamp: tick.ltt,
    source: "live",
  };
}

function toPrice(rupees: number | null): PriceE4 | null {
  return rupees === null ? null : rupeesToPrice(rupees);
}

export function isFeedStale(status: FeedStatus): boolean {
  if (status.state !== "live" || status.lastTickAt === null) return false;
  return Date.now() - status.lastTickAt > STALE_AFTER_MS;
}
