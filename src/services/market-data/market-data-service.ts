/**
 * MarketDataService — the single entry point the application uses to reach
 * market data.
 *
 * It owns exactly one provider and adds the concerns that should not be
 * reimplemented per provider:
 *   - a last-value cache, so a newly mounted component paints immediately
 *   - subscription multiplexing, so ten widgets watching RELIANCE cost one
 *     upstream subscription
 *   - applying ticks onto cached quotes (day high/low, change, change %)
 *   - a rolling price history per instrument, which is what sparklines draw
 *   - snapshot derivation (gainers, losers, most active, volume spikes) from
 *     the one cache, so no two panels can disagree about the same instrument
 */

import type { ConnectionStatus } from "@/domain/connection";
import { IDLE_CONNECTION } from "@/domain/connection";
import type {
  Instrument,
  MarketSnapshot,
  Quote,
  RankedQuote,
  Tick,
  VolumeSpike,
} from "@/domain/market";
import { dayChange } from "@/domain/day-change";
import { type PriceE4 } from "@/lib/money";
import type { CandleRequest, MarketDataProvider, Unsubscribe } from "@/services/market-data/types";
import { INSTRUMENT_BY_ID } from "@/services/market-data/universe";

export type QuoteListener = (quote: Quote) => void;

/** Points kept per instrument for sparklines. ~2 minutes at a 900ms tick. */
const HISTORY_LIMIT = 120;

/** Off-screen flush cadence, used where there are no animation frames. */
const FLUSH_INTERVAL_MS = 100;

/** Relative volume at or above this counts as a spike. */
export const VOLUME_SPIKE_THRESHOLD = 1.5;

export interface HistoryPoint {
  readonly time: number;
  readonly price: PriceE4;
}

export class MarketDataService {
  private readonly provider: MarketDataProvider;
  private readonly quoteCache = new Map<string, Quote>();
  private readonly history = new Map<string, HistoryPoint[]>();
  private readonly listeners = new Map<string, Set<QuoteListener>>();
  private readonly upstream = new Map<string, Unsubscribe>();
  private instrumentsPromise: Promise<readonly Instrument[]> | null = null;

  /** Instruments whose seed quote is waiting to go out in the next batch. */
  private readonly pendingSeeds = new Set<string>();
  private seedScheduled = false;

  /** Instruments that ticked since the last flush to subscribers. */
  private readonly dirty = new Set<string>();
  private flushScheduled = false;

  constructor(provider: MarketDataProvider) {
    this.provider = provider;
  }

  /** Provenance of everything this service returns. */
  get source() {
    return this.provider.source;
  }

  get providerName(): string {
    return this.provider.name;
  }

  /** @deprecated Phase 1 name. Use `providerName`. */
  get adapterName(): string {
    return this.provider.name;
  }

  listInstruments(): Promise<readonly Instrument[]> {
    // The instrument master is immutable for a session; fetch it once.
    this.instrumentsPromise ??= this.provider.listInstruments();
    return this.instrumentsPromise;
  }

  searchInstruments(query: string, limit?: number): Promise<readonly Instrument[]> {
    return this.provider.searchInstruments(query, limit);
  }

  async getQuote(instrumentId: string): Promise<Quote | null> {
    const quote = await this.provider.getQuote(instrumentId);
    if (quote) this.store(quote);
    return quote;
  }

  async getQuotes(instrumentIds: readonly string[]): Promise<readonly Quote[]> {
    const quotes = await this.provider.getQuotes(instrumentIds);
    for (const quote of quotes) this.store(quote);
    return quotes;
  }

  /** Cached last value, if any. Never triggers a fetch. */
  peekQuote(instrumentId: string): Quote | null {
    return this.quoteCache.get(instrumentId) ?? null;
  }

  /** Rolling recent prices for an instrument, oldest first. */
  getHistory(instrumentId: string): readonly HistoryPoint[] {
    return this.history.get(instrumentId) ?? [];
  }

  getCandles(request: CandleRequest) {
    return this.provider.getCandles(request);
  }

  getSectorPerformance() {
    return this.provider.getSectorPerformance();
  }

  getMarketStatus() {
    return this.provider.getMarketStatus();
  }

  getConnectionStatus(): ConnectionStatus {
    return this.provider.getConnectionStatus?.() ?? IDLE_CONNECTION;
  }

  onConnectionChange(listener: (status: ConnectionStatus) => void): Unsubscribe {
    return this.provider.onConnectionChange?.(listener) ?? (() => {});
  }

  /**
   * Watch one symbol. The listener fires with the cached quote immediately (if
   * one exists) and then on every subsequent tick.
   */
  subscribeQuote(instrumentId: string, listener: QuoteListener): Unsubscribe {
    let set = this.listeners.get(instrumentId);
    if (!set) {
      set = new Set();
      this.listeners.set(instrumentId, set);
    }
    set.add(listener);

    const cached = this.quoteCache.get(instrumentId);
    if (cached) listener(cached);

    if (!this.upstream.has(instrumentId)) {
      const unsubscribe = this.provider.subscribe([instrumentId], (tick) => this.onTick(tick));
      this.upstream.set(instrumentId, unsubscribe);

      // Seed the cache so the first tick has a previous close to compare to.
      if (!cached) this.scheduleSeed(instrumentId);
    }

    return () => {
      const current = this.listeners.get(instrumentId);
      if (!current) return;
      current.delete(listener);
      if (current.size > 0) return;

      this.listeners.delete(instrumentId);
      this.upstream.get(instrumentId)?.();
      this.upstream.delete(instrumentId);
    };
  }

  /**
   * Queue a seed fetch, and send the whole queue as one request.
   *
   * A table of ninety rows mounts ninety `subscribeQuote` calls in a single
   * synchronous pass. Fetching per instrument turned that into ninety HTTP
   * requests, and in live mode ninety separate Upstox round trips — measurably
   * the slowest thing about a page load, and entirely self-inflicted.
   *
   * Deferring to a microtask lets every subscription raised in the same tick
   * collapse into one `getQuotes` call. Nothing waits on it: subscribers keep
   * their cached or empty state until the batch resolves.
   */
  private scheduleSeed(instrumentId: string): void {
    this.pendingSeeds.add(instrumentId);
    if (this.seedScheduled) return;

    this.seedScheduled = true;
    queueMicrotask(() => {
      this.seedScheduled = false;
      const ids = [...this.pendingSeeds];
      this.pendingSeeds.clear();
      if (ids.length === 0) return;

      void this.getQuotes(ids).then((quotes) => {
        for (const quote of quotes) this.emit(quote);
      });
    });
  }

  /** Watch several symbols with one listener. */
  subscribeQuotes(instrumentIds: readonly string[], listener: QuoteListener): Unsubscribe {
    const unsubscribes = instrumentIds.map((id) => this.subscribeQuote(id, listener));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }

  /**
   * Derive a whole-market read from the current cache.
   *
   * Everything here comes from the same quote map the individual panels render,
   * taken at one instant — so the heatmap, the movers list and a symbol row can
   * never show different prices for the same instrument.
   *
   * Only instruments already in the cache participate, so callers must be
   * subscribed to the universe they want ranked.
   */
  buildSnapshot(options: { limit?: number } = {}): MarketSnapshot {
    const limit = options.limit ?? 8;

    const indices: Quote[] = [];
    const equities: { quote: Quote; instrument: Instrument }[] = [];

    for (const quote of this.quoteCache.values()) {
      const instrument = INSTRUMENT_BY_ID.get(quote.instrumentId);
      if (!instrument) continue;
      if (instrument.kind === "index") indices.push(quote);
      else equities.push({ quote, instrument });
    }

    /*
      Breadth and the movers lists are counts and rankings of instruments whose
      move is *known*. An instrument with no previous close has no move to
      rank, and counting it as unchanged would quietly inflate the flat column
      with instruments that might have done anything at all.
    */
    const moved = equities.filter(
      (entry): entry is { quote: Quote & { changePercent: number }; instrument: Instrument } =>
        entry.quote.changePercent !== null,
    );

    let advancing = 0;
    let declining = 0;
    let unchanged = 0;
    for (const { quote } of moved) {
      if (quote.changePercent > 0) advancing += 1;
      else if (quote.changePercent < 0) declining += 1;
      else unchanged += 1;
    }

    const byChangeDesc = [...moved].sort((a, b) => b.quote.changePercent - a.quote.changePercent);

    const gainers = rank(byChangeDesc.filter((e) => e.quote.changePercent > 0).slice(0, limit));
    const losers = rank(
      [...byChangeDesc].reverse().filter((e) => e.quote.changePercent < 0).slice(0, limit),
    );
    const mostActive = rank(
      [...equities].sort((a, b) => b.quote.volume - a.quote.volume).slice(0, limit),
    );

    const volumeSpikes: VolumeSpike[] = equities
      .map(({ quote, instrument }) => ({
        instrument,
        quote,
        relativeVolume: relativeVolume(quote),
      }))
      // averageVolume of 0 means "unknown", which must not read as a spike.
      .filter((spike) => spike.relativeVolume >= VOLUME_SPIKE_THRESHOLD)
      .sort((a, b) => b.relativeVolume - a.relativeVolume)
      .slice(0, limit);

    return {
      indices,
      gainers,
      losers,
      mostActive,
      volumeSpikes,
      sectors: [],
      advancing,
      declining,
      unchanged,
      timestamp: Date.now(),
      source: this.provider.source,
    };
  }

  dispose(): void {
    for (const unsubscribe of this.upstream.values()) unsubscribe();
    this.upstream.clear();
    this.listeners.clear();
    this.quoteCache.clear();
    this.history.clear();
    this.provider.dispose();
  }

  // --- internals -----------------------------------------------------------

  private onTick(tick: Tick): void {
    const previous = this.quoteCache.get(tick.instrumentId);
    if (!previous) return;

    /*
      The day's change is recomputed against the *previous close* carried on
      the cached quote — never against the price this instrument last ticked
      at, and never against whatever the cell currently shows. A tick-to-tick
      delta is not the day's move, and a chart or a table built from one would
      report a different figure depending on when the page was opened.

      When the close is unknown the whole change stays unknown, and the price
      still updates. A live price with an honest "--" beside it is a working
      row; a live price with a fabricated 0.00% is not.
    */
    const { previousClose, change, changePercent } = dayChange(
      tick.price,
      // A tick that carries a close supersedes the cached one; a tick that
      // says nothing about it leaves the cached one in place.
      tick.previousClose === undefined ? previous.previousClose : tick.previousClose,
    );

    const next: Quote = {
      ...previous,
      price: tick.price,
      volume: tick.volume,
      // A missing session high stays missing: the first tick after subscribing
      // is not the day's high, it is just the first one this process saw.
      dayHigh:
        previous.dayHigh === null
          ? null
          : ((tick.price > previous.dayHigh ? tick.price : previous.dayHigh) as PriceE4),
      dayLow:
        previous.dayLow === null
          ? null
          : ((tick.price < previous.dayLow ? tick.price : previous.dayLow) as PriceE4),
      previousClose,
      change,
      changePercent,
      timestamp: tick.timestamp,
      source: tick.source,
    };

    this.emit(next);
  }

  /**
   * Record a quote, and tell subscribers about it on the next frame.
   *
   * ── Why the cache updates now but React does not ───────────────────────
   *
   * `store` runs synchronously, so `peekQuote`, snapshots and anything reading
   * the cache always see the newest price — no staleness is introduced here.
   *
   * What is deferred is the notification. A liquid instrument can print many
   * times a second, and every listener is a React `setState`; a table of ninety
   * rows would otherwise re-render on every one of them, on the main thread,
   * for a change of a few paise. Coalescing to one flush per animation frame
   * caps that at the display's refresh rate, and collapses several ticks for
   * the same instrument into the single latest value — which is the only one
   * that was ever going to be painted.
   */
  private emit(quote: Quote): void {
    this.store(quote);
    if (!this.listeners.has(quote.instrumentId)) return;

    this.dirty.add(quote.instrumentId);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;

    /*
      `requestAnimationFrame` where there is a screen, so updates land with the
      paint and pause entirely in a background tab. On the server — the strategy
      runner subscribes there — fall back to a timer, since a headless process
      has no frames and must not simply stop delivering ticks.
    */
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => this.flush());
    } else {
      setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  private flush(): void {
    this.flushScheduled = false;
    if (this.dirty.size === 0) return;

    const ids = [...this.dirty];
    this.dirty.clear();

    for (const id of ids) {
      const quote = this.quoteCache.get(id);
      const listeners = this.listeners.get(id);
      if (!quote || !listeners) continue;

      for (const listener of listeners) {
        try {
          listener(quote);
        } catch {
          // One bad subscriber must not stop the rest of the flush.
        }
      }
    }
  }

  /** Cache the quote and append it to the rolling history. */
  private store(quote: Quote): void {
    this.quoteCache.set(quote.instrumentId, quote);

    let points = this.history.get(quote.instrumentId);
    if (!points) {
      points = [];
      this.history.set(quote.instrumentId, points);
    }

    points.push({ time: quote.timestamp, price: quote.price });
    // Bounded so a long session cannot grow the buffer without limit.
    if (points.length > HISTORY_LIMIT) points.splice(0, points.length - HISTORY_LIMIT);
  }
}

/** Session volume against its own norm. Returns 0 when the norm is unknown. */
export function relativeVolume(quote: Quote): number {
  if (!quote.averageVolume || quote.averageVolume <= 0) return 0;
  return quote.volume / quote.averageVolume;
}

function rank(entries: readonly { quote: Quote; instrument: Instrument }[]): RankedQuote[] {
  return entries.map((entry, index) => ({
    rank: index + 1,
    quote: entry.quote,
    instrument: entry.instrument,
  }));
}
