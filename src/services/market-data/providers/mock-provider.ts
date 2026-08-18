/**
 * Local market simulator.
 *
 * IMPORTANT: every value this provider produces is invented. It is tagged
 * `source: "simulated"` so the UI can label it, and it must never be presented
 * to a user as a real market print. It exists so the product can be built and
 * demonstrated without a data vendor.
 *
 * The model is a geometric random walk with mean reversion toward the seed's
 * reference price, scaled by a per-symbol volatility. It is intentionally not a
 * forecast of anything, and carries no predictive claim whatsoever.
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
import { SECTORS } from "@/domain/market";
import { percentChange, rupeesToPrice, priceToRupees, type PriceE4 } from "@/lib/money";
import { createRng, dayBucket, hashString } from "@/lib/random";
import type { CandleRequest, MarketDataProvider, Unsubscribe } from "@/services/market-data/types";
import { isMarketOpen, marketDataEdge, marketPhase } from "@/services/market-data/market-hours";
import { INSTRUMENTS, SEED_BY_ID } from "@/services/market-data/universe";
import { publicEnv } from "@/config/env";

/** How often the simulator advances, in milliseconds. */
const TICK_INTERVAL_MS = 900;

interface SimState {
  price: number;
  previousClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  /** Typical full-session volume; the denominator for relative volume. */
  averageVolume: number;
  volatility: number;
  reference: number;
  /** Slow-moving drift, refreshed periodically so moves come in runs. */
  drift: number;
  driftTicksLeft: number;
  rng: ReturnType<typeof createRng>;
}

export interface MockProviderOptions {
  /**
   * Fixes the simulated session. Defaults to the current calendar day so a
   * refresh keeps the same opening snapshot, and so server and client render
   * identical markup on first paint.
   */
  readonly seed?: number | string;
  /** Overrides the tick cadence, mainly for tests. */
  readonly tickIntervalMs?: number;
  /** When false, no timer is started (server-side use). */
  readonly streaming?: boolean;
}

/** @deprecated Phase 1 name. Use `MockProviderOptions`. */
export type MockAdapterOptions = MockProviderOptions;

export class MockMarketDataProvider implements MarketDataProvider {
  readonly name = "mock";
  readonly source = "simulated" as const;

  private readonly states = new Map<string, SimState>();
  private readonly listeners = new Map<string, Set<(tick: Tick) => void>>();
  private readonly connectionListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly tickIntervalMs: number;
  private readonly streaming: boolean;
  /** True when Upstox is the price source and the simulator must stand down. */
  private readonly liveModeActive: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private connection: ConnectionStatus = {
    state: "idle",
    detail: "Simulator idle — nothing is subscribed yet.",
    lastMessageAt: null,
    retryCount: 0,
  };

  constructor(options: MockProviderOptions = {}) {
    const seed = options.seed ?? dayBucket();
    this.tickIntervalMs = options.tickIntervalMs ?? TICK_INTERVAL_MS;
    this.streaming = options.streaming ?? typeof window !== "undefined";
    this.liveModeActive = publicEnv.marketDataMode === "live";

    for (const instrument of INSTRUMENTS) {
      this.states.set(instrument.id, createInitialState(instrument.id, seed));
    }
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

  async listInstruments(): Promise<readonly Instrument[]> {
    return INSTRUMENTS;
  }

  async searchInstruments(query: string, limit = 12): Promise<readonly Instrument[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return INSTRUMENTS.slice(0, limit);

    const scored = INSTRUMENTS.map((instrument) => ({
      instrument,
      score: matchScore(instrument, needle),
    }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.instrument.symbol.localeCompare(b.instrument.symbol));

    return scored.slice(0, limit).map((entry) => entry.instrument);
  }

  async getQuote(instrumentId: string): Promise<Quote | null> {
    const state = this.states.get(instrumentId);
    if (!state) return null;
    return this.toQuote(instrumentId, state);
  }

  async getQuotes(instrumentIds: readonly string[]): Promise<readonly Quote[]> {
    const quotes: Quote[] = [];
    for (const id of instrumentIds) {
      const state = this.states.get(id);
      if (state) quotes.push(this.toQuote(id, state));
    }
    return quotes;
  }

  async getCandles(request: CandleRequest): Promise<readonly Candle[]> {
    const state = this.states.get(request.instrumentId);
    if (!state) return [];

    const stepMs = intervalToMs(request.interval);

    /*
      Pull the window back to the last session close when the market is shut.

      Without this the chart still grew after 15:30: callers ask for
      `to: Date.now()`, so every reload or timeframe change minted fresh bars
      for hours the market never traded — frozen quotes above a chart that kept
      extending.

      The whole window shifts rather than just its end. Clamping `to` alone
      would collapse the span to nothing on a Sunday — `to` would land before
      `from` and the chart would come back empty — so the requested duration is
      preserved and simply ends at the last close.
    */
    const edge = marketDataEdge();
    const to = Math.min(request.to, edge);
    const from = request.from - (request.to - to);

    if (to <= from) return [];

    // Anchor the walk to the window start so the same window always replays
    // identically, and never generate a bar that closes after `to`.
    const rng = createRng(`${request.instrumentId}:${request.interval}:${from}`);
    const bars: Candle[] = [];
    const perStepVol = state.volatility / Math.sqrt(252 * (86_400_000 / stepMs));

    // Generate the shape in plain numbers first; it is rescaled below before
    // being converted to prices.
    interface RawBar {
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }

    const raw: RawBar[] = [];
    let close = state.reference;

    for (let time = from; time + stepMs <= to + 1; time += stepMs) {
      const open = close;
      const shock = rng.normal() * perStepVol;
      close = Math.max(0.05, open * (1 + shock));
      const wick = Math.abs(rng.normal()) * perStepVol * open;
      const high = Math.max(open, close) + wick * 0.6;
      const low = Math.max(0.01, Math.min(open, close) - wick * 0.6);

      raw.push({
        time,
        open,
        high,
        low,
        close,
        volume: Math.round(rng.range(20_000, 260_000)),
      });
    }

    if (raw.length === 0) return [];

    /*
      Land the final close on the current simulated price.

      Without this the chart and the price header disagree — the walk drifts
      away from the live quote and the last candle sits at a different number
      from the one printed above it. Scaling multiplicatively (rather than
      shifting) preserves the shape and cannot push a price negative.

      Only applied when the window ends at "now"; a historical window must keep
      its own independent path, since the current price says nothing about where
      an earlier session closed.
    */
    // Compared against the data edge, not the wall clock: while the market is
    // shut the newest bar *is* the last close, and it should still be rescaled
    // to meet the frozen last-traded price so the chart and the quote agree.
    const endsNow = Math.abs(to - edge) <= stepMs;
    const lastClose = raw[raw.length - 1]!.close;
    const factor = endsNow && lastClose > 0 ? state.price / lastClose : 1;

    for (const bar of raw) {
      bars.push({
        time: bar.time,
        open: rupeesToPrice(bar.open * factor),
        high: rupeesToPrice(bar.high * factor),
        low: rupeesToPrice(bar.low * factor),
        close: rupeesToPrice(bar.close * factor),
        volume: bar.volume,
      });
    }

    return bars;
  }

  async getSectorPerformance(): Promise<readonly SectorPerformance[]> {
    const buckets = new Map<string, { sum: number; weight: number; advancing: number; declining: number }>();
    for (const sector of SECTORS) {
      buckets.set(sector, { sum: 0, weight: 0, advancing: 0, declining: 0 });
    }

    for (const instrument of INSTRUMENTS) {
      if (instrument.kind !== "equity" || instrument.sector === null) continue;
      const state = this.states.get(instrument.id);
      const bucket = buckets.get(instrument.sector);
      if (!state || !bucket) continue;

      const change = percentChange(state.previousClose, state.price);
      const weight = Math.max(instrument.marketCapCr, 1);
      bucket.sum += change * weight;
      bucket.weight += weight;
      if (change > 0) bucket.advancing += 1;
      else if (change < 0) bucket.declining += 1;
    }

    return SECTORS.map((sector) => {
      const bucket = buckets.get(sector);
      const weight = bucket?.weight ?? 0;
      return {
        sector,
        changePercent: weight > 0 && bucket ? bucket.sum / weight : 0,
        advancing: bucket?.advancing ?? 0,
        declining: bucket?.declining ?? 0,
      };
    });
  }

  async getMarketStatus(): Promise<MarketStatus> {
    // Shares `market-hours` with the tick loop, so the badge and the simulator
    // can no longer disagree about whether the market is open — which was the
    // whole substance of the bug.
    const now = new Date();
    return { phase: marketPhase(now), timestamp: now.getTime(), source: this.source };
  }

  subscribe(instrumentIds: readonly string[], onTick: (tick: Tick) => void): Unsubscribe {
    if (this.disposed) return () => {};

    for (const id of instrumentIds) {
      if (!this.states.has(id)) continue;
      let set = this.listeners.get(id);
      if (!set) {
        set = new Set();
        this.listeners.set(id, set);
      }
      set.add(onTick);
    }

    this.ensureTimer();

    return () => {
      for (const id of instrumentIds) {
        const set = this.listeners.get(id);
        if (!set) continue;
        set.delete(onTick);
        if (set.size === 0) this.listeners.delete(id);
      }
      if (this.listeners.size === 0) this.stopTimer();
    };
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimer();
    this.listeners.clear();
    this.connectionListeners.clear();
  }

  // --- internals -----------------------------------------------------------

  private ensureTimer(): void {
    if (!this.streaming || this.timer !== null || this.listeners.size === 0) return;
    this.timer = setInterval(() => this.advance(), this.tickIntervalMs);
    this.setConnection({
      state: "connected",
      // Worded so this can never be mistaken for a real feed being live.
      detail: "Simulated feed running locally. These are not real market prices.",
      lastMessageAt: Date.now(),
      retryCount: 0,
    });
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.setConnection({
      state: "idle",
      detail: "Simulator idle — nothing is subscribed.",
      lastMessageAt: this.connection.lastMessageAt,
      retryCount: 0,
    });
  }

  /**
   * Advance only the symbols someone is actually watching.
   *
   * ── The market-hours gate ─────────────────────────────────────────────────
   *
   * This is where simulated prices, percentage changes and volume actually
   * move. The session badge was reading the clock correctly and showing
   * CLOSED, but nothing here consulted it, so the walk carried on through the
   * evening and the weekend.
   *
   * The timer is deliberately left running rather than cleared. Returning
   * early emits no ticks — so prices, changes and volume all hold their last
   * traded values — while the next tick after 09:15 resumes on its own, with
   * no page refresh and no second timer to schedule, drift or leak.
   */
  private advance(): void {
    /*
      In live mode the simulator does not run at all.

      Provider selection should already have kept this class out of the way,
      but if MARKET_DATA_ADAPTER and NEXT_PUBLIC_MARKET_DATA_MODE ever
      disagree, the UI would be showing a LIVE badge over invented prices.
      Emitting nothing is the honest failure: the price simply doesn't update.

      The check is a mode flag rather than a per-instrument lookup on purpose —
      importing the Upstox key map here would pull the vendor's instrument
      table into the browser bundle for no benefit.
    */
    if (this.liveModeActive) return;

    if (!isMarketOpen()) return;

    const timestamp = Date.now();

    for (const [instrumentId, listeners] of this.listeners) {
      const state = this.states.get(instrumentId);
      if (!state) continue;

      step(state, this.tickIntervalMs);

      const tick: Tick = {
        instrumentId,
        price: rupeesToPrice(state.price),
        volume: state.volume,
        timestamp,
        source: this.source,
      };

      for (const listener of listeners) {
        try {
          listener(tick);
        } catch (error) {
          // One bad subscriber must not stall the whole feed.
          console.error(`[mock-adapter] subscriber threw for ${instrumentId}`, error);
        }
      }
    }
  }

  private toQuote(instrumentId: string, state: SimState): Quote {
    const price = rupeesToPrice(state.price);
    const previousClose = rupeesToPrice(state.previousClose);
    const change = (price - previousClose) as PriceE4;

    return {
      instrumentId,
      price,
      previousClose,
      open: rupeesToPrice(state.open),
      dayHigh: rupeesToPrice(Math.max(state.dayHigh, state.price)),
      dayLow: rupeesToPrice(Math.min(state.dayLow, state.price)),
      volume: state.volume,
      averageVolume: state.averageVolume,
      change,
      changePercent: percentChange(priceToRupees(previousClose), priceToRupees(price)),
      timestamp: Date.now(),
      source: this.source,
    };
  }
}

// --- simulation model --------------------------------------------------------

function createInitialState(instrumentId: string, seed: number | string): SimState {
  const config = SEED_BY_ID.get(instrumentId);
  const reference = config?.referencePrice ?? 100;
  const volatility = config?.volatility ?? 0.25;

  const rng = createRng(hashString(`${instrumentId}:${seed}`));

  // Yesterday's close drifts a little from the reference, and today opens with
  // a gap — both derived from the seed, so they are stable across renders.
  const previousClose = round2(reference * (1 + rng.normal() * volatility * 0.03));
  const open = round2(previousClose * (1 + rng.normal() * volatility * 0.012));
  const price = open;

  // A stable per-symbol norm, then a session that runs some multiple of it.
  // Most days sit near 1×; a minority run hot, which is what makes a volume
  // spike meaningful rather than uniform noise.
  const averageVolume = Math.round(rng.range(400_000, 5_500_000));
  const sessionMultiple = Math.max(0.25, 1 + rng.normal() * 0.55);

  return {
    price,
    previousClose,
    open,
    dayHigh: Math.max(open, previousClose),
    dayLow: Math.min(open, previousClose),
    volume: Math.round(averageVolume * sessionMultiple * rng.range(0.35, 0.75)),
    averageVolume,
    volatility,
    reference,
    drift: rng.normal() * 0.15,
    driftTicksLeft: Math.round(rng.range(12, 40)),
    rng,
  };
}

/** One simulation step: drift + shock + gentle pull back to the reference. */
function step(state: SimState, elapsedMs: number): void {
  const { rng } = state;

  if (state.driftTicksLeft <= 0) {
    state.drift = rng.normal() * 0.15;
    state.driftTicksLeft = Math.round(rng.range(12, 40));
  }
  state.driftTicksLeft -= 1;

  // Volatility is annualised; scale it down to this step's slice of a session.
  const stepsPerSession = (6.25 * 3_600_000) / elapsedMs;
  const stepVol = state.volatility / Math.sqrt(252 * stepsPerSession);

  const shock = rng.normal() * stepVol;
  const drift = state.drift * stepVol;
  const reversion = ((state.reference - state.price) / state.reference) * 0.004;

  const next = state.price * (1 + shock + drift + reversion);
  state.price = round2(Math.max(0.05, next));

  if (state.price > state.dayHigh) state.dayHigh = state.price;
  if (state.price < state.dayLow) state.dayLow = state.price;

  state.volume += Math.round(rng.range(120, 9_400) * (1 + Math.abs(shock) * 40));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function matchScore(instrument: Instrument, needle: string): number {
  const symbol = instrument.symbol.toLowerCase();
  const name = instrument.name.toLowerCase();

  if (symbol === needle) return 100;
  if (symbol.startsWith(needle)) return 80;
  if (name.toLowerCase().startsWith(needle)) return 60;
  if (symbol.includes(needle)) return 40;
  if (name.includes(needle)) return 20;
  return 0;
}

function intervalToMs(interval: CandleRequest["interval"]): number {
  switch (interval) {
    case "1m":
      return 60_000;
    case "5m":
      return 300_000;
    case "15m":
      return 900_000;
    case "1h":
      return 3_600_000;
    case "1d":
      return 86_400_000;
  }
}
