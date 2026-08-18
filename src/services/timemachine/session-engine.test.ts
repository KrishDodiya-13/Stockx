import { describe, expect, it } from "vitest";

import type { Candle } from "@/domain/market";
import { rupeesToPaise, rupeesToPrice } from "@/lib/money";
import {
  buildReport,
  createSession,
  currentPrice,
  placeSessionOrder,
  revealNext,
  sessionEquity,
  SPEEDS,
  tickInterval,
  type SessionState,
} from "@/services/timemachine/session-engine";

const CAPITAL = rupeesToPaise(100_000);

function candles(prices: readonly number[]): Candle[] {
  return prices.map((price, index) => ({
    time: index * 60_000,
    open: rupeesToPrice(price),
    high: rupeesToPrice(price),
    low: rupeesToPrice(price),
    close: rupeesToPrice(price),
    volume: 1000,
  }));
}

/** Advance a session through `count` bars of the given series. */
function advance(state: SessionState, series: readonly Candle[], count: number): SessionState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    const candle = series[next.cursor];
    if (!candle) break;
    next = revealNext(next, candle);
  }
  return next;
}

describe("progressive reveal", () => {
  it("starts with nothing revealed", () => {
    const session = createSession(CAPITAL, 10);
    expect(session.revealed).toHaveLength(0);
    expect(currentPrice(session)).toBeNull();
  });

  it("reveals exactly one bar at a time", () => {
    const series = candles([100, 101, 102, 103]);
    let session = createSession(CAPITAL, series.length);

    session = revealNext(session, series[0]!);
    expect(session.revealed).toHaveLength(1);

    session = revealNext(session, series[1]!);
    expect(session.revealed).toHaveLength(2);
  });

  it("never holds a bar beyond the cursor", () => {
    /*
      The core guarantee. After n reveals the session must contain exactly the
      first n bars — no more — so nothing downstream can read ahead.
    */
    const series = candles([100, 110, 120, 130, 140, 150]);
    let session = createSession(CAPITAL, series.length);

    for (let step = 1; step <= series.length; step += 1) {
      session = revealNext(session, series[step - 1]!);

      expect(session.revealed).toHaveLength(step);
      expect(session.revealed.map((c) => c.close)).toEqual(
        series.slice(0, step).map((c) => c.close),
      );

      // The next bar's value must be absent from session state entirely.
      const future = series.slice(step).map((c) => c.close);
      for (const value of future) {
        expect(session.revealed.some((c) => c.close === value)).toBe(false);
      }
    }
  });

  it("prices at the latest revealed close, not the final one", () => {
    const series = candles([100, 200, 300]);
    let session = createSession(CAPITAL, series.length);

    session = revealNext(session, series[0]!);
    expect(currentPrice(session)).toBe(rupeesToPrice(100));

    session = revealNext(session, series[1]!);
    expect(currentPrice(session)).toBe(rupeesToPrice(200));
  });

  it("finishes once every bar is revealed", () => {
    const series = candles([100, 101]);
    const session = advance(createSession(CAPITAL, series.length), series, 2);

    expect(session.status).toBe("finished");
    expect(session.cursor).toBe(series.length);
  });

  it("cannot advance past the end", () => {
    const series = candles([100]);
    let session = advance(createSession(CAPITAL, 1), series, 1);
    session = revealNext(session, series[0]!);

    expect(session.revealed).toHaveLength(1);
    expect(session.status).toBe("finished");
  });
});

describe("session trading", () => {
  const series = candles([100, 110, 120]);

  it("refuses an order before any price is known", () => {
    const outcome = placeSessionOrder(createSession(CAPITAL, 3), "BUY", 10);
    expect(outcome.ok).toBe(false);
    expect(outcome.rejection).toBe("no-price");
  });

  it("fills at the current revealed price", () => {
    const session = advance(createSession(CAPITAL, 3), series, 1);
    const outcome = placeSessionOrder(session, "BUY", 100);

    expect(outcome.ok).toBe(true);
    expect(outcome.state.trades[0]!.price).toBe(rupeesToPrice(100));
    expect(outcome.state.cash).toBe(rupeesToPaise(90_000));
  });

  it("refuses a buy the session cannot afford", () => {
    const session = advance(createSession(CAPITAL, 3), series, 1);
    const outcome = placeSessionOrder(session, "BUY", 100_000);

    expect(outcome.ok).toBe(false);
    expect(outcome.rejection).toBe("insufficient-funds");
    // A refused order must leave the session untouched.
    expect(outcome.state).toBe(session);
  });

  it("refuses selling more than is held", () => {
    let session = advance(createSession(CAPITAL, 3), series, 1);
    session = placeSessionOrder(session, "BUY", 10).state;

    const outcome = placeSessionOrder(session, "SELL", 50);
    expect(outcome.ok).toBe(false);
    expect(outcome.rejection).toBe("insufficient-shares");
  });

  it("books profit on a round trip", () => {
    let session = advance(createSession(CAPITAL, 3), series, 1);
    session = placeSessionOrder(session, "BUY", 100).state;

    session = advance(session, series, 1); // price now 110
    session = placeSessionOrder(session, "SELL", 100).state;

    expect(session.realisedPnl).toBe(rupeesToPaise(1_000));
    expect(session.cash).toBe(rupeesToPaise(101_000));
    expect(session.holding).toBeNull();
  });

  it("marks an open position at the latest close", () => {
    let session = advance(createSession(CAPITAL, 3), series, 1);
    session = placeSessionOrder(session, "BUY", 100).state;
    session = advance(session, series, 1); // 110

    // 90,000 cash + 100 × 110
    expect(sessionEquity(session)).toBe(rupeesToPaise(101_000));
  });
});

describe("report", () => {
  it("measures a flat session as no return", () => {
    const series = candles([100, 100, 100]);
    const session = advance(createSession(CAPITAL, 3), series, 3);
    const report = buildReport(session);

    expect(report.totalReturn).toBe(0);
    expect(report.benchmarkReturnPercent).toBe(0);
    expect(report.outperformancePercent).toBe(0);
  });

  it("compares against buy-and-hold over the same window", () => {
    // Market rose 20%; the trader captured only the first 10%.
    const series = candles([100, 110, 120]);
    let session = advance(createSession(CAPITAL, 3), series, 1);
    session = placeSessionOrder(session, "BUY", 100).state;
    session = advance(session, series, 1);
    session = placeSessionOrder(session, "SELL", 100).state;
    session = advance(session, series, 1);

    const report = buildReport(session);

    expect(report.benchmarkReturnPercent).toBeCloseTo(20);
    expect(report.totalReturnPercent).toBeCloseTo(1); // ₹1,000 on ₹100,000
    // Underperformed a market that simply went up.
    expect(report.outperformancePercent).toBeCloseTo(-19);
  });

  it("credits outperformance when the market fell and the trader did not", () => {
    const series = candles([100, 90, 80]);
    const session = advance(createSession(CAPITAL, 3), series, 3);
    const report = buildReport(session);

    // Held cash throughout: flat while the market lost 20%.
    expect(report.totalReturnPercent).toBe(0);
    expect(report.benchmarkReturnPercent).toBeCloseTo(-20);
    expect(report.outperformancePercent).toBeCloseTo(20);
  });

  it("marks an open position rather than force-selling it", () => {
    const series = candles([100, 150]);
    let session = advance(createSession(CAPITAL, 2), series, 1);
    session = placeSessionOrder(session, "BUY", 100).state;
    session = advance(session, series, 1);

    const report = buildReport(session);

    // The position is valued, but no closing trade was invented.
    expect(report.tradeCount).toBe(1);
    expect(report.endingCapital).toBe(rupeesToPaise(105_000));
  });

  it("computes win rate over closing trades only", () => {
    const series = candles([100, 120, 90]);
    let session = advance(createSession(CAPITAL, 3), series, 1);

    session = placeSessionOrder(session, "BUY", 100).state;
    session = advance(session, series, 1);
    session = placeSessionOrder(session, "SELL", 100).state; // win

    session = placeSessionOrder(session, "BUY", 100).state;
    session = advance(session, series, 1);
    session = placeSessionOrder(session, "SELL", 100).state; // loss

    const report = buildReport(session);

    expect(report.tradeCount).toBe(4);
    // Buys cannot win or lose; only the two sells count.
    expect(report.winCount).toBe(1);
    expect(report.lossCount).toBe(1);
    expect(report.winRate).toBe(50);
  });

  it("measures drawdown peak-to-trough", () => {
    const series = candles([100, 150, 80, 120]);
    let session = advance(createSession(CAPITAL, 4), series, 1);
    session = placeSessionOrder(session, "BUY", 100).state;
    session = advance(session, series, 3);

    const report = buildReport(session);

    expect(report.maxDrawdown).toBeGreaterThan(0);
    expect(report.maxDrawdownPercent).toBeLessThan(0);
  });

  it("reports zero drawdown on a session that only rose", () => {
    const series = candles([100, 110, 120]);
    let session = advance(createSession(CAPITAL, 3), series, 1);
    session = placeSessionOrder(session, "BUY", 100).state;
    session = advance(session, series, 2);

    expect(buildReport(session).maxDrawdown).toBe(0);
  });

  it("handles a session with no trades", () => {
    const series = candles([100, 105]);
    const report = buildReport(advance(createSession(CAPITAL, 2), series, 2));

    expect(report.tradeCount).toBe(0);
    expect(report.winRate).toBe(0);
    expect(report.endingCapital).toBe(CAPITAL);
  });
});

describe("playback speed", () => {
  it("advances faster at higher multipliers", () => {
    expect(tickInterval(1)).toBe(1000);
    expect(tickInterval(2)).toBe(500);
    expect(tickInterval(3)).toBe(333);
    expect(tickInterval(5)).toBe(200);
    expect(tickInterval(10)).toBe(100);
  });

  it("offers every speed the transport shows", () => {
    expect(SPEEDS).toEqual([1, 2, 3, 5, 10]);
  });

  it("gives every listed speed a usable interval", () => {
    // A speed that produced 0ms would spin the clock as fast as the event loop
    // allows; one that produced a non-integer would drift.
    for (const speed of SPEEDS) {
      const ms = tickInterval(speed);
      expect(ms).toBeGreaterThan(0);
      expect(Number.isInteger(ms)).toBe(true);
    }
  });

  it("is strictly monotonic — each speed is faster than the one before", () => {
    const intervals = SPEEDS.map(tickInterval);
    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i]!).toBeLessThan(intervals[i - 1]!);
    }
  });
});

describe("equity curve", () => {
  it("records one point per revealed bar", () => {
    const series = candles([100, 101, 102, 103]);
    const session = advance(createSession(CAPITAL, 4), series, 4);

    expect(session.equityCurve).toHaveLength(4);
    expect(session.equityCurve.map((p) => p.time)).toEqual(series.map((c) => c.time));
  });

  it("never contains a point beyond the cursor", () => {
    const series = candles([100, 101, 102, 103]);
    const session = advance(createSession(CAPITAL, 4), series, 2);

    expect(session.equityCurve).toHaveLength(2);
    const lastTime = session.equityCurve[session.equityCurve.length - 1]!.time;
    expect(lastTime).toBe(series[1]!.time);
  });
});
