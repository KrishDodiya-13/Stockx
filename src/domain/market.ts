/**
 * Market domain model.
 *
 * These types describe what the application knows about *the market*. They are
 * deliberately provider-agnostic: a live provider adapter must map its payloads
 * into these shapes rather than leaking its own schema upwards.
 */

import type { PriceE4 } from "@/lib/money";

export type Exchange = "NSE" | "BSE";

export type InstrumentKind = "equity" | "index";

export type Sector =
  | "Energy"
  | "Financials"
  | "Technology"
  | "Consumer"
  | "Healthcare"
  | "Industrials"
  | "Materials"
  | "Telecom"
  | "Utilities"
  | "Auto"
  | "Chemicals";

export const SECTORS: readonly Sector[] = [
  "Energy",
  "Financials",
  "Technology",
  "Consumer",
  "Healthcare",
  "Industrials",
  "Materials",
  "Telecom",
  "Utilities",
  "Auto",
  "Chemicals",
] as const;

/** A tradable (or trackable) symbol. */
export interface Instrument {
  /** Stable identifier used across the app, e.g. "NSE:RELIANCE". */
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: Exchange;
  readonly kind: InstrumentKind;
  readonly sector: Sector | null;
  /** Free-float market cap in crore, used for weighting and heatmap sizing. */
  readonly marketCapCr: number;
  /**
   * BSE scrip code, where it is known.
   *
   * Optional because this registry is hand-maintained reference data, and a
   * scrip code is a real-world identifier: a wrong one is worse than a missing
   * one. Rows are filled in as codes are confirmed, and a live instrument
   * master supplies the rest.
   */
  readonly bseCode?: string;
}

/**
 * A point-in-time snapshot for one instrument.
 *
 * ── null means unknown, and only unknown ───────────────────────────────────
 *
 * Several fields are nullable, and that is the whole point of them. A provider
 * that has not been told an instrument's previous close must say so by leaving
 * it null; it must never substitute the last traded price, zero, or anything
 * else that types cleanly. Both were being done, and the visible result was an
 * instruments table where every stock in the market had moved exactly 0.00%.
 *
 * Consumers render null as "--". They must not coalesce it to 0: "unchanged"
 * and "not known" are different claims about the market, and only one of them
 * is ever true by accident.
 */
export interface Quote {
  readonly instrumentId: string;
  readonly price: PriceE4;
  /**
   * Previous session's close — the base for day change.
   *
   * Null when the provider did not supply one. Upstox's websocket carries it
   * as `ltpc.cp`; its REST quote carries it as `last_price - net_change`.
   */
  readonly previousClose: PriceE4 | null;
  /** Session open. Null in feed modes that carry no OHLC (Upstox LTPC). */
  readonly open: PriceE4 | null;
  readonly dayHigh: PriceE4 | null;
  readonly dayLow: PriceE4 | null;
  /** Shares traded so far in the session. */
  readonly volume: number;
  /**
   * Typical full-session volume for this instrument, used as the denominator
   * for relative volume. Providers that cannot supply it should report 0, and
   * consumers must treat 0 as "unknown" rather than dividing by it.
   */
  readonly averageVolume: number;
  /** Absolute change vs previousClose, per share. Null when that is unknown. */
  readonly change: PriceE4 | null;
  /**
   * Percentage change vs previousClose (12.5 === 12.5%).
   *
   * Null when `previousClose` is unknown or zero — never 0, which would claim
   * the instrument is flat.
   */
  readonly changePercent: number | null;
  /** Epoch milliseconds of this snapshot. */
  readonly timestamp: number;
  /**
   * Provenance of this quote. The UI must never render `simulated` data as if
   * it were a real market print.
   */
  readonly source: QuoteSource;
}

export type QuoteSource = "simulated" | "live" | "historical";

/** OHLCV bar. */
export interface Candle {
  readonly time: number;
  readonly open: PriceE4;
  readonly high: PriceE4;
  readonly low: PriceE4;
  readonly close: PriceE4;
  readonly volume: number;
}

export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "1d";

export interface SectorPerformance {
  readonly sector: Sector;
  readonly changePercent: number;
  /** Number of constituents currently up on the day. */
  readonly advancing: number;
  readonly declining: number;
}

/**
 * A quote ranked within some view of the market (gainers, losers, most active).
 * The rank is carried alongside the quote so a list and its ordering cannot
 * drift apart as prices tick underneath it.
 */
export interface RankedQuote {
  readonly rank: number;
  readonly quote: Quote;
  readonly instrument: Instrument;
}

/** Traded volume running unusually far ahead of its own norm. */
export interface VolumeSpike {
  readonly instrument: Instrument;
  readonly quote: Quote;
  /** Session volume ÷ average volume. 2.4 means 2.4× its usual. */
  readonly relativeVolume: number;
}

/** One consistent read of the whole market, taken at a single instant. */
export interface MarketSnapshot {
  readonly indices: readonly Quote[];
  readonly gainers: readonly RankedQuote[];
  readonly losers: readonly RankedQuote[];
  readonly mostActive: readonly RankedQuote[];
  readonly volumeSpikes: readonly VolumeSpike[];
  readonly sectors: readonly SectorPerformance[];
  readonly advancing: number;
  readonly declining: number;
  readonly unchanged: number;
  readonly timestamp: number;
  readonly source: QuoteSource;
}

export type MarketPhase = "pre-open" | "open" | "closed";

export interface MarketStatus {
  readonly phase: MarketPhase;
  readonly timestamp: number;
  readonly source: QuoteSource;
}

/** A single-symbol tick pushed by a streaming adapter. */
export interface Tick {
  readonly instrumentId: string;
  readonly price: PriceE4;
  readonly volume: number;
  readonly timestamp: number;
  readonly source: QuoteSource;
  /**
   * The previous close this tick was quoted against, where the transport
   * carries one (Upstox sends it on every LTPC frame as `cp`).
   *
   * Optional because not every transport has it, and undefined therefore means
   * "this tick says nothing about the close" — the consumer keeps the one it
   * already had. It exists so a close learned from the websocket is not thrown
   * away on the way to the client, which would leave a row showing "--" while
   * the data needed to fill it was arriving on every frame.
   */
  readonly previousClose?: PriceE4 | null;
}
