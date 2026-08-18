/**
 * Upstox REST client.
 *
 * Server-only: only route handlers under `/api/market-data/*` may import
 * this. It talks to Upstox's plain REST endpoints (no protobuf, no
 * websocket) so `subscribe()` on the live provider can be implemented as
 * short-interval polling instead of parsing Upstox's binary market feed —
 * simpler to get right and to test without a live connection.
 *
 * Every function maps Upstox's response shape into this app's own domain
 * types (`Quote`, `Candle`) at this boundary; nothing above this module
 * should ever see an Upstox-shaped payload.
 */

import type { Candle, CandleInterval, Quote, QuoteSource } from "@/domain/market";
import { dayChange } from "@/domain/day-change";
import { rupeesToPrice, type PriceE4 } from "@/lib/money";
import { serverEnv } from "@/config/env";
import { resolveUpstoxAccessToken } from "@/services/market-data/providers/upstox/token-store";
import { fromUpstoxKey, toUpstoxKey } from "@/services/market-data/providers/upstox/instrument-keys";

const UPSTOX_BASE_URL = "https://api.upstox.com";

/** Thrown on a 401 from Upstox, so callers can surface "session expired". */
export class UpstoxAuthError extends Error {
  /**
   * False when no token was ever supplied, true when one was sent and Upstox
   * rejected it. The fixes differ — fill in `.env` versus refresh a token that
   * has aged out — so the two must not collapse into one message.
   */
  readonly configured: boolean;

  constructor(
    message = "Upstox access token is missing or expired.",
    options: { configured?: boolean } = {},
  ) {
    super(message);
    this.name = "UpstoxAuthError";
    this.configured = options.configured ?? true;
  }
}

export class UpstoxRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UpstoxRequestError";
  }
}

/** Upper bound on any single Upstox HTTP call. */
const UPSTOX_TIMEOUT_MS = 8_000;

async function currentAccessToken(): Promise<string> {
  const token = (await resolveUpstoxAccessToken()) ?? serverEnv.upstoxAccessToken;
  if (!token) {
    /*
      Flagged as "never configured" rather than "expired". They need opposite
      responses — one is a line missing from `.env`, the other is a token that
      has aged out — and reporting the second for the first sends you to the
      Upstox console when the fix is local. Note that a token left as the
      `.env.example` placeholder arrives here as absent, by design.
    */
    throw new UpstoxAuthError(
      "No Upstox access token configured. Set UPSTOX_ACCESS_TOKEN in .env, or visit /api/market-data/upstox/login.",
      { configured: false },
    );
  }
  return token;
}

async function upstoxFetch(path: string, init?: RequestInit): Promise<unknown> {
  const token = await currentAccessToken();

  /*
    Bounded on purpose.

    `fetch` has no default timeout, so a vendor that accepts the connection and
    then stops responding holds this promise open indefinitely — and with it
    the route handler, the request, and whatever page was waiting on it. A
    price that arrives after eight seconds is of no use to a trading screen
    anyway; failing is better than hanging.
  */
  const response = await fetch(`${UPSTOX_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...init?.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTOX_TIMEOUT_MS),
  });

  if (response.status === 401) {
    throw new UpstoxAuthError();
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new UpstoxRequestError(
      `Upstox request to ${path} failed (${response.status}): ${body.slice(0, 300)}`,
      response.status,
    );
  }

  return response.json();
}

// --- quotes ------------------------------------------------------------------

/** Upstox allows at most this many instrument_keys per quotes request. */
const MAX_KEYS_PER_QUOTES_CALL = 500;

interface UpstoxOhlc {
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
  readonly close?: number;
}

export interface UpstoxQuoteEntry {
  readonly instrument_token?: string;
  readonly last_price?: number;
  readonly volume?: number;
  readonly average_price?: number;
  readonly net_change?: number;
  readonly ohlc?: UpstoxOhlc;
  readonly timestamp?: string | number;
}

interface UpstoxQuotesResponse {
  readonly status?: string;
  readonly data?: Record<string, UpstoxQuoteEntry>;
}

/** Small TTL cache so several widgets/tabs polling at once share one upstream call. */
const QUOTE_CACHE_TTL_MS = 2_500;
const quoteCache = new Map<string, { readonly expiresAt: number; readonly quotes: readonly Quote[] }>();

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function cacheKey(instrumentKeys: readonly string[]): string {
  return [...instrumentKeys].sort().join(",");
}

/**
 * Fetch live quotes for the given app-level instrument ids. Ids with no
 * known Upstox mapping are silently skipped (see instrument-keys.ts).
 */
export async function fetchQuotes(instrumentIds: readonly string[]): Promise<readonly Quote[]> {
  if (instrumentIds.length === 0) return [];

  const key = cacheKey(instrumentIds);
  const cached = quoteCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.quotes;

  const keyToId = new Map<string, string>();
  for (const id of instrumentIds) {
    const upstoxKey = toUpstoxKey(id);
    if (upstoxKey) keyToId.set(upstoxKey, id);
  }
  const upstoxKeys = [...keyToId.keys()];
  if (upstoxKeys.length === 0) return [];

  const results: Quote[] = [];
  for (const batch of chunk(upstoxKeys, MAX_KEYS_PER_QUOTES_CALL)) {
    const search = new URLSearchParams({ instrument_key: batch.join(",") });
    const payload = (await upstoxFetch(`/v2/market-quote/quotes?${search}`)) as UpstoxQuotesResponse;
    const data = payload.data ?? {};

    for (const [returnedKey, entry] of Object.entries(data)) {
      // Upstox echoes the key back in a couple of slightly different forms
      // depending on endpoint version; fall back to the token we requested.
      const instrumentId =
        keyToId.get(returnedKey) ??
        (entry.instrument_token ? keyToId.get(entry.instrument_token) : undefined) ??
        fromUpstoxKey(returnedKey);
      if (!instrumentId) continue;

      const quote = toQuote(instrumentId, entry);
      if (quote) results.push(quote);
    }
  }

  quoteCache.set(key, { expiresAt: Date.now() + QUOTE_CACHE_TTL_MS, quotes: results });
  return results;
}

/**
 * The previous session's close, from a quote entry.
 *
 * ── Do not read this from `ohlc.close` ─────────────────────────────────────
 *
 * `ohlc` on this endpoint is *today's* bar, so `ohlc.close` is today's close —
 * which, once the session ends, is the last traded price, and intraday is not
 * a settled figure at all. Deriving the previous close from it therefore
 * produced `previousClose === last_price` for every instrument, an absolute
 * change of exactly zero, and an instruments table in which the entire market
 * had moved 0.00%. Verified against Upstox on 2026-08-18: HDFCBANK came back
 * with `last_price: 723` and `ohlc.close: 723`, alongside `net_change: -6`.
 *
 * `net_change` is the vendor's own change against the previous close, so the
 * close is `last_price - net_change` — the one relationship the payload
 * actually states. When it is absent the previous close is unknown, and it
 * stays unknown; there is no third field worth guessing from.
 */
export function previousCloseOf(entry: UpstoxQuoteEntry, lastPrice: number): PriceE4 | null {
  const netChange = entry.net_change;
  if (typeof netChange !== "number" || !Number.isFinite(netChange)) return null;

  const previousClose = lastPrice - netChange;
  if (!Number.isFinite(previousClose) || previousClose <= 0) return null;

  return rupeesToPrice(previousClose);
}

/*
  Exported for testing.

  This mapping is where a vendor payload becomes a number a trader reads, and
  it is where the 0.00%-everywhere bug lived. It is worth pinning against
  recorded Upstox responses directly, rather than only through a network call
  that cannot be replayed.
*/
export function toQuote(instrumentId: string, entry: UpstoxQuoteEntry): Quote | null {
  const lastPrice = entry.last_price;
  if (typeof lastPrice !== "number" || !Number.isFinite(lastPrice) || lastPrice <= 0) return null;

  const ohlc = entry.ohlc ?? {};
  const price = rupeesToPrice(lastPrice);

  /*
    Today's bar, where Upstox sent one. Each field is independently optional:
    an absent high is unknown, not "the last price", which would draw a day
    range of zero width around wherever the stock happens to be trading.
  */
  const open = typeof ohlc.open === "number" && ohlc.open > 0 ? rupeesToPrice(ohlc.open) : null;
  const dayHigh =
    typeof ohlc.high === "number" && ohlc.high > 0
      ? (rupeesToPrice(Math.max(ohlc.high, lastPrice)) as PriceE4)
      : null;
  const dayLow =
    typeof ohlc.low === "number" && ohlc.low > 0
      ? (rupeesToPrice(Math.min(ohlc.low, lastPrice)) as PriceE4)
      : null;

  const { previousClose, change, changePercent } = dayChange(
    price,
    previousCloseOf(entry, lastPrice),
  );
  const source: QuoteSource = "live";

  const timestamp =
    typeof entry.timestamp === "number"
      ? entry.timestamp
      : typeof entry.timestamp === "string"
        ? Date.parse(entry.timestamp) || Date.now()
        : Date.now();

  return {
    instrumentId,
    price,
    previousClose,
    open,
    dayHigh,
    dayLow,
    volume: entry.volume ?? 0,
    // Upstox's quotes endpoint does not return a session-average volume.
    // 0 is the documented "unknown" sentinel for this field.
    averageVolume: 0,
    change,
    changePercent,
    timestamp,
    source,
  };
}

// --- candles -------------------------------------------------------------------

interface UpstoxCandlesResponse {
  readonly status?: string;
  readonly data?: {
    readonly candles?: readonly (readonly [string, number, number, number, number, number, number])[];
  };
}

/** Upstox v3 historical-candle unit/interval pair for one of this app's intervals. */
function toUpstoxUnitAndInterval(interval: CandleInterval): { unit: string; interval: string } {
  switch (interval) {
    case "1m":
      return { unit: "minutes", interval: "1" };
    case "5m":
      return { unit: "minutes", interval: "5" };
    case "15m":
      return { unit: "minutes", interval: "15" };
    case "1h":
      return { unit: "hours", interval: "1" };
    case "1d":
      return { unit: "days", interval: "1" };
  }
}

function toDateStamp(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Fetch historical candles for one instrument between `fromMs` and `toMs`
 * (inclusive), mapped into this app's `Candle` shape, oldest first.
 */
export async function fetchCandles(
  instrumentId: string,
  interval: CandleInterval,
  fromMs: number,
  toMs: number,
): Promise<readonly Candle[]> {
  const upstoxKey = toUpstoxKey(instrumentId);
  if (!upstoxKey) return [];

  const { unit, interval: upstoxInterval } = toUpstoxUnitAndInterval(interval);
  const toDate = toDateStamp(toMs);
  const fromDate = toDateStamp(fromMs);

  const path = `/v3/historical-candle/${encodeURIComponent(upstoxKey)}/${unit}/${upstoxInterval}/${toDate}/${fromDate}`;
  const payload = (await upstoxFetch(path)) as UpstoxCandlesResponse;
  const rows = payload.data?.candles ?? [];

  // Upstox returns newest-first: [timestamp, open, high, low, close, volume, oi].
  const candles: Candle[] = rows
    .map((row) => {
      const [timestamp, open, high, low, close, volume] = row;
      const time = Date.parse(timestamp);
      if (!Number.isFinite(time)) return null;
      return {
        time,
        open: rupeesToPrice(open),
        high: rupeesToPrice(high),
        low: rupeesToPrice(low),
        close: rupeesToPrice(close),
        volume: volume ?? 0,
      } satisfies Candle;
    })
    .filter((candle): candle is Candle => candle !== null && candle.time >= fromMs && candle.time <= toMs)
    .sort((a, b) => a.time - b.time);

  return candles;
}
