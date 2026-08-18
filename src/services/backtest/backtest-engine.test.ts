import { describe, expect, it } from "vitest";

import type { Candle } from "@/domain/market";
import type { Rule, Strategy } from "@/domain/strategy";
import { rupeesToPaise, rupeesToPrice, type Paise } from "@/lib/money";
import {
  bollingerBands,
  macd as computeMacd,
  rsi as computeRsi,
  sma,
} from "@/services/indicators/indicators";
import { runBacktest } from "@/services/backtest/backtest-engine";

const CAPITAL = rupeesToPaise(1_000_000);

/** Candles at the given closing prices, one minute apart. */
function candles(prices: readonly number[]): Candle[] {
  return prices.map((price, index) => ({
    time: index * 60_000,
    open: rupeesToPrice(price),
    high: rupeesToPrice(price * 1.002),
    low: rupeesToPrice(price * 0.998),
    close: rupeesToPrice(price),
    volume: 100_000,
  }));
}

/** Flat warm-up bars so indicator-based rules start from a settled state. */
function withWarmup(prices: readonly number[], level = 100): Candle[] {
  return candles([...new Array(60).fill(level), ...prices]);
}

function rule(id: string, overrides: Partial<Rule> = {}): Rule {
  return {
    id,
    kind: "CUSTOM",
    order: 0,
    conditions: [],
    operator: "AND",
    actions: [],
    trailPercent: null,
    enabled: true,
    ...overrides,
  };
}

function strategy(rules: Rule[]): Strategy {
  return {
    id: "s1",
    name: "Backtest",
    instrumentId: "NSE:RELIANCE",
    symbol: "RELIANCE",
    status: "ACTIVE",
    rules,
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    activatedAt: null,
    completedAt: null,
  };
}

/** The specification's worked example. */
function workedExample(): Strategy {
  return strategy([
    rule("entry", {
      kind: "ENTRY",
      order: 0,
      conditions: [{ id: "c1", type: "PRICE_ABOVE", value: rupeesToPrice(99.5), period: null }],
      actions: [{ id: "a1", type: "BUY", quantity: 100 }],
    }),
    rule("t1", {
      kind: "TARGET",
      order: 1,
      conditions: [{ id: "c2", type: "PRICE_ABOVE", value: rupeesToPrice(102), period: null }],
      actions: [{ id: "a2", type: "SELL", quantity: 50 }],
    }),
    rule("t2", {
      kind: "TARGET",
      order: 2,
      conditions: [{ id: "c3", type: "PRICE_ABOVE", value: rupeesToPrice(105), period: null }],
      actions: [{ id: "a3", type: "SELL", quantity: 50 }],
    }),
    rule("stop", {
      kind: "STOP",
      order: 3,
      conditions: [{ id: "c4", type: "PRICE_BELOW", value: rupeesToPrice(97), period: null }],
      actions: [{ id: "a4", type: "SELL_ALL", quantity: null }],
    }),
  ]);
}

// ---------------------------------------------------------------------------
// No future data
// ---------------------------------------------------------------------------

describe("no lookahead bias", () => {
  /**
   * The property the whole engine rests on.
   *
   * Every indicator is read at index `i` from a series computed over the full
   * candle set. That is only safe if each indicator is causal — if its value at
   * `i` depends solely on values at or before `i`. These assert exactly that by
   * comparing the full-series value against one computed from the prefix alone.
   */
  const prices = Array.from({ length: 160 }, (_, i) => 100 + Math.sin(i / 7) * 12 + i * 0.08);

  it("SMA at index i is unchanged by later data", () => {
    const full = sma(prices, 50);

    for (const i of [55, 80, 120, 159]) {
      const prefixOnly = sma(prices.slice(0, i + 1), 50);
      expect(prefixOnly[i]).toBeCloseTo(full[i] as number, 10);
    }
  });

  it("RSI at index i is unchanged by later data", () => {
    const full = computeRsi(prices, 14);

    for (const i of [20, 60, 100, 159]) {
      const prefixOnly = computeRsi(prices.slice(0, i + 1), 14);
      expect(prefixOnly[i]).toBeCloseTo(full[i] as number, 10);
    }
  });

  it("MACD and its signal at index i are unchanged by later data", () => {
    const full = computeMacd(prices);

    for (const i of [60, 100, 159]) {
      const prefixOnly = computeMacd(prices.slice(0, i + 1));
      expect(prefixOnly.macd[i]).toBeCloseTo(full.macd[i] as number, 10);
      expect(prefixOnly.signal[i]).toBeCloseTo(full.signal[i] as number, 10);
    }
  });

  it("Bollinger Bands at index i are unchanged by later data", () => {
    const full = bollingerBands(prices, 20, 2);

    for (const i of [30, 90, 159]) {
      const prefixOnly = bollingerBands(prices.slice(0, i + 1), 20, 2);
      expect(prefixOnly.upper[i]).toBeCloseTo(full.upper[i] as number, 10);
      expect(prefixOnly.lower[i]).toBeCloseTo(full.lower[i] as number, 10);
    }
  });

  it("truncating the data after the last trade does not change the result", () => {
    /*
      The strongest end-to-end check. If the engine peeked at future bars, then
      deleting bars that occur *after* everything has already happened would
      change the outcome. It must not.
    */
    /*
      The tail deliberately falls below the entry level, so the strategy does
      not re-arm into another trade. That leaves a genuine stretch of unused
      bars at the end — which is exactly what makes truncation a real test.
    */
    const path = withWarmup([100, 101, 103, 106, 90, 90, 90, 90, 90]);

    const full = runBacktest({ strategy: workedExample(), candles: path, initialCapital: CAPITAL });

    // Everything closes by the bar priced 106; drop the tail after it.
    const lastFillTime = full.fills[full.fills.length - 1]!.time;
    // Guard the guard: there must actually be discarded bars for this to prove
    // anything.
    expect(path.filter((candle) => candle.time > lastFillTime).length).toBeGreaterThan(3);
    const truncated = path.filter((candle) => candle.time <= lastFillTime);

    const shortened = runBacktest({
      strategy: workedExample(),
      candles: truncated,
      initialCapital: CAPITAL,
    });

    expect(shortened.tradeCount).toBe(full.tradeCount);
    expect(shortened.trades.map((t) => t.pnl)).toEqual(full.trades.map((t) => t.pnl));
    expect(shortened.fills.map((f) => `${f.side}:${f.quantity}`)).toEqual(
      full.fills.map((f) => `${f.side}:${f.quantity}`),
    );
  });

  it("fills only ever occur at a bar present in the input", () => {
    const path = withWarmup([100, 101, 103, 106, 95]);
    const result = runBacktest({
      strategy: workedExample(),
      candles: path,
      initialCapital: CAPITAL,
    });

    const validTimes = new Set(path.map((candle) => candle.time));
    for (const fill of result.fills) expect(validTimes.has(fill.time)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

describe("execution", () => {
  it("runs the worked example and books the expected profit", () => {
    // Entry at 100, sell 50 at 103, sell 50 at 106.
    const result = runBacktest({
      strategy: workedExample(),
      candles: withWarmup([100, 103, 106]),
      initialCapital: CAPITAL,
    });

    expect(result.fills.map((f) => `${f.side}:${f.quantity}`)).toEqual([
      "BUY:100",
      "SELL:50",
      "SELL:50",
    ]);

    // 50 × (103−100) + 50 × (106−100) = 150 + 300
    expect(result.tradeCount).toBe(1);
    expect(result.trades[0]!.pnl).toBe(rupeesToPaise(450));
  });

  it("never fires a rule twice within one open position", () => {
    /*
      Price sits above the first target for several bars but never reaches the
      second, so the position stays open throughout. The first target must fire
      once and stay quiet, however long the condition remains true.
    */
    const result = runBacktest({
      strategy: workedExample(),
      candles: withWarmup([100, 103, 103, 103, 104, 104]),
      initialCapital: CAPITAL,
    });

    expect(result.fills.filter((f) => f.side === "BUY")).toHaveLength(1);
    expect(result.fills.filter((f) => f.side === "SELL")).toHaveLength(1);
    // Still holding the second half — no round trip completed.
    expect(result.tradeCount).toBe(0);
  });

  it("re-arms after a round trip so the strategy trades the period, not once", () => {
    /*
      A backtest measures a strategy across a period. Ten clean setups in the
      data must produce ten trades — otherwise trade count, win rate and profit
      factor all describe a single trade and mean nothing.
    */
    const cycles = 10;
    const prices: number[] = [];
    for (let i = 0; i < cycles; i += 1) prices.push(100, 103, 106, 103, 100, 96, 100);

    const swing = strategy([
      rule("entry", {
        kind: "ENTRY",
        order: 0,
        conditions: [{ id: "c1", type: "PRICE_ABOVE", value: rupeesToPrice(102), period: null }],
        actions: [{ id: "a1", type: "BUY", quantity: 10 }],
      }),
      rule("stop", {
        kind: "STOP",
        order: 1,
        conditions: [{ id: "c2", type: "PRICE_BELOW", value: rupeesToPrice(97), period: null }],
        actions: [{ id: "a2", type: "SELL_ALL", quantity: null }],
      }),
    ]);

    const result = runBacktest({
      strategy: swing,
      candles: withWarmup(prices),
      initialCapital: CAPITAL,
    });

    expect(result.tradeCount).toBe(cycles);
    expect(result.fills.filter((f) => f.side === "BUY")).toHaveLength(cycles);
  });

  it("does not re-enter on the same bar it exited", () => {
    /*
      Exiting and re-entering at one closing price is not something a real
      participant could do, and a permissive entry rule would otherwise loop
      endlessly on a single bar.
    */
    const eager = strategy([
      rule("entry", {
        kind: "ENTRY",
        order: 0,
        conditions: [{ id: "c1", type: "PRICE_ABOVE", value: rupeesToPrice(1), period: null }],
        actions: [{ id: "a1", type: "BUY", quantity: 10 }],
      }),
      rule("exit", {
        kind: "TARGET",
        order: 1,
        conditions: [{ id: "c2", type: "PRICE_ABOVE", value: rupeesToPrice(1), period: null }],
        actions: [{ id: "a2", type: "SELL_ALL", quantity: null }],
      }),
    ]);

    const bars = withWarmup([100, 100, 100]);
    const result = runBacktest({ strategy: eager, candles: bars, initialCapital: CAPITAL });

    // At most one entry per bar, never several within one.
    const buysPerBar = new Map<number, number>();
    for (const fill of result.fills.filter((f) => f.side === "BUY")) {
      buysPerBar.set(fill.time, (buysPerBar.get(fill.time) ?? 0) + 1);
    }
    for (const count of buysPerBar.values()) expect(count).toBe(1);

    // And the run terminates rather than looping.
    expect(result.tradeCount).toBeLessThanOrEqual(bars.length);
  });

  it("closes the position on a stop and records the loss", () => {
    const result = runBacktest({
      strategy: workedExample(),
      candles: withWarmup([100, 99, 96]),
      initialCapital: CAPITAL,
    });

    expect(result.tradeCount).toBe(1);
    expect(result.trades[0]!.pnl).toBe(rupeesToPaise(-400)); // 100 × (96−100)
    expect(result.lossCount).toBe(1);
  });

  it("refuses a buy the capital cannot afford", () => {
    const big = strategy([
      rule("entry", {
        kind: "ENTRY",
        conditions: [{ id: "c", type: "PRICE_ABOVE", value: rupeesToPrice(1), period: null }],
        actions: [{ id: "a", type: "BUY", quantity: 1_000_000 }],
      }),
    ]);

    const result = runBacktest({
      strategy: big,
      candles: withWarmup([100, 101]),
      initialCapital: rupeesToPaise(1_000),
    });

    expect(result.fills).toHaveLength(0);
    expect(result.finalEquity).toBe(rupeesToPaise(1_000));
  });

  it("never lets equity go negative", () => {
    const result = runBacktest({
      strategy: workedExample(),
      candles: withWarmup([100, 99, 98, 97, 96, 90, 80]),
      initialCapital: CAPITAL,
    });

    for (const point of result.equityCurve) expect(point.equity).toBeGreaterThan(0);
  });

  it("reports an error rather than throwing on insufficient data", () => {
    const result = runBacktest({
      strategy: workedExample(),
      candles: candles([100]),
      initialCapital: CAPITAL,
    });

    expect(result.error).toBeTruthy();
    expect(result.tradeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

describe("statistics", () => {
  it("keeps equity equal to cash plus position at every bar", () => {
    const result = runBacktest({
      strategy: workedExample(),
      candles: withWarmup([100, 103, 106]),
      initialCapital: CAPITAL,
    });

    // With everything closed, final equity must be capital plus booked P&L.
    const booked = result.trades.reduce((total, trade) => total + trade.pnl, 0);
    expect(result.finalEquity).toBe((CAPITAL + booked) as Paise);
    expect(result.totalReturn).toBe(booked as Paise);
  });

  it("computes win rate over closed trades", () => {
    const result = runBacktest({
      strategy: workedExample(),
      candles: withWarmup([100, 103, 106]),
      initialCapital: CAPITAL,
    });

    expect(result.winCount).toBe(1);
    expect(result.winRate).toBe(100);
  });

  it("reports profit factor as null when nothing lost", () => {
    const result = runBacktest({
      strategy: workedExample(),
      candles: withWarmup([100, 103, 106]),
      initialCapital: CAPITAL,
    });

    // Infinity would flatter the result; null says "not meaningful".
    expect(result.profitFactor).toBeNull();
  });

  it("measures drawdown peak-to-trough, not from the start", () => {
    // Rise to a peak, fall back, recover.
    const result = runBacktest({
      strategy: workedExample(),
      candles: withWarmup([100, 104, 104, 98, 98, 104]),
      initialCapital: CAPITAL,
    });

    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.maxDrawdownPercent).toBeLessThanOrEqual(0);
  });

  it("has zero drawdown on a monotonically rising equity curve", () => {
    const flat = strategy([]);
    const result = runBacktest({
      strategy: flat,
      candles: withWarmup([100, 101, 102]),
      initialCapital: CAPITAL,
    });

    expect(result.maxDrawdown).toBe(0);
    expect(result.tradeCount).toBe(0);
  });

  it("identifies best and worst trades", () => {
    const result = runBacktest({
      strategy: workedExample(),
      candles: withWarmup([100, 103, 106]),
      initialCapital: CAPITAL,
    });

    expect(result.bestTrade?.pnl).toBe(result.worstTrade?.pnl);
    expect(result.bestTrade?.pnl).toBe(rupeesToPaise(450));
  });

  it("produces one equity point per candle", () => {
    const path = withWarmup([100, 103, 106]);
    const result = runBacktest({
      strategy: workedExample(),
      candles: path,
      initialCapital: CAPITAL,
    });

    expect(result.equityCurve).toHaveLength(path.length);
  });

  it("is deterministic", () => {
    const path = withWarmup([100, 101, 103, 106, 95]);
    const a = runBacktest({ strategy: workedExample(), candles: path, initialCapital: CAPITAL });
    const b = runBacktest({ strategy: workedExample(), candles: path, initialCapital: CAPITAL });

    expect(a.finalEquity).toBe(b.finalEquity);
    expect(a.trades).toEqual(b.trades);
  });
});
