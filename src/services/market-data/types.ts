/**
 * The market-data contract.
 *
 * Application code depends only on `MarketDataProvider`. Swapping the local
 * simulation for a real vendor (REST + WebSocket) means writing one new
 * provider — no page, hook or component changes.
 */

import type { ConnectionStatus } from "@/domain/connection";
import type {
  Candle,
  CandleInterval,
  Instrument,
  MarketStatus,
  Quote,
  QuoteSource,
  SectorPerformance,
  Tick,
} from "@/domain/market";

export type Unsubscribe = () => void;

export interface CandleRequest {
  readonly instrumentId: string;
  readonly interval: CandleInterval;
  /** Inclusive epoch-ms lower bound. */
  readonly from: number;
  /** Inclusive epoch-ms upper bound. Nothing after this may be returned. */
  readonly to: number;
}

export interface MarketDataProvider {
  /** Stable provider name, surfaced in diagnostics. */
  readonly name: string;

  /**
   * Provenance of everything this provider emits. Drives the data-source badge;
   * simulated data is never presented as a real market print.
   */
  readonly source: QuoteSource;

  /** Full instrument master. */
  listInstruments(): Promise<readonly Instrument[]>;

  /** Substring match over symbol and name. */
  searchInstruments(query: string, limit?: number): Promise<readonly Instrument[]>;

  getQuote(instrumentId: string): Promise<Quote | null>;

  getQuotes(instrumentIds: readonly string[]): Promise<readonly Quote[]>;

  /**
   * Bars strictly within [from, to]. Providers must not return data after `to` —
   * the Time Machine relies on this to avoid leaking future prices.
   */
  getCandles(request: CandleRequest): Promise<readonly Candle[]>;

  getSectorPerformance(): Promise<readonly SectorPerformance[]>;

  getMarketStatus(): Promise<MarketStatus>;

  /** Push updates for the given symbols. Returns an unsubscribe handle. */
  subscribe(instrumentIds: readonly string[], onTick: (tick: Tick) => void): Unsubscribe;

  /** Current transport health. */
  getConnectionStatus(): ConnectionStatus;

  /** Observe transport health changes. Returns an unsubscribe handle. */
  onConnectionChange(listener: (status: ConnectionStatus) => void): Unsubscribe;

  /** Release timers, sockets and buffers. */
  dispose(): void;
}

/**
 * @deprecated Phase 1 name for `MarketDataProvider`. Retained so existing
 * imports keep compiling; prefer `MarketDataProvider` in new code.
 */
export type MarketDataAdapter = MarketDataProvider;
