import { describe, expect, it } from "vitest";

import type { Candle } from "@/domain/market";
import { rupeesToPaise, rupeesToPrice, type Paise } from "@/lib/money";
import { LocalAnalysisProvider } from "@/services/analysis/local-provider";
import { extractFacts } from "@/services/analysis/trade-analysis";
import { buildRoundTrips, buildTimeline, type Fill } from "@/services/replay/replay-engine";

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

function roundTrip(entry: number, exit: number, exitBar: number, quantity = 100) {
  const fills: Fill[] = [
    {
      id: "f1", orderId: "o1", instrumentId: "NSE:X", symbol: "X",
      side: "BUY", quantity, price: rupeesToPrice(entry),
      realisedPnl: 0 as Paise, source: "MANUAL", executedAt: 0,
    },
    {
      id: "f2", orderId: "o2", instrumentId: "NSE:X", symbol: "X",
      side: "SELL", quantity, price: rupeesToPrice(exit),
      realisedPnl: rupeesToPaise((exit - entry) * quantity) as Paise,
      source: "MANUAL", executedAt: exitBar * 60_000,
    },
  ];

  return buildRoundTrips(fills)[0]!;
}

describe("capture ratio", () => {
  /*
    Regression: `holdExtremes` only measures bars where a position is open, so
    a trade exited at its peak once reported a "best available" gain lower than
    what it actually booked — and the review claimed it captured 200% of the
    move. You cannot bank more than was available.
  */
  it("never exceeds 100% when the trade exits at its highest point", () => {
    const trip = roundTrip(100, 120, 3);
    const frames = buildTimeline(trip, candles([100, 105, 110, 120]));
    const facts = extractFacts(trip, frames, rupeesToPaise(100_000));

    expect(facts.captureRatio).not.toBeNull();
    expect(facts.captureRatio!).toBeLessThanOrEqual(100);
    expect(facts.captureRatio!).toBeCloseTo(100);
    // The best available must be at least what was booked.
    expect(facts.maxFavourable).toBeGreaterThanOrEqual(facts.realisedPnl);
  });

  it("never exceeds 100% across a range of exit timings", () => {
    const prices = [100, 108, 104, 115, 109, 120];

    for (let exitBar = 1; exitBar < prices.length; exitBar += 1) {
      const trip = roundTrip(100, prices[exitBar]!, exitBar);
      const facts = extractFacts(trip, buildTimeline(trip, candles(prices)), rupeesToPaise(100_000));

      if (facts.captureRatio === null) continue;
      expect(facts.captureRatio).toBeLessThanOrEqual(100);
    }
  });

  it("still reports a partial capture when the peak was missed", () => {
    // Runs to 130 mid-hold, exits at 110 — genuinely left money behind.
    const trip = roundTrip(100, 110, 4);
    const facts = extractFacts(
      trip,
      buildTimeline(trip, candles([100, 120, 130, 115, 110])),
      rupeesToPaise(100_000),
    );

    expect(facts.maxFavourable).toBe(rupeesToPaise(3000));
    expect(facts.captureRatio!).toBeCloseTo(33.3, 0);
  });

  it("produces a coherent review for a trade exited at its peak", async () => {
    const trip = roundTrip(100, 120, 3);
    const facts = extractFacts(trip, buildTimeline(trip, candles([100, 105, 110, 120])), rupeesToPaise(100_000));
    const review = await new LocalAnalysisProvider().analyse(facts);

    const text = [...review.wentWell, ...review.couldImprove].join(" ");

    /*
      Read the percentage back out of the prose and check the value, rather
      than pattern-matching the digits — "100%" is correct and a naive regex
      for three digits flags it as a failure.
    */
    for (const match of text.matchAll(/captured (\d+(?:\.\d+)?)%/g)) {
      expect(Number(match[1])).toBeLessThanOrEqual(100);
    }

    expect(text).toMatch(/captured 100%/);
  });

  it("returns null rather than a ratio when the trade never showed a gain", () => {
    const trip = roundTrip(100, 90, 3);
    const facts = extractFacts(trip, buildTimeline(trip, candles([100, 98, 95, 90])), rupeesToPaise(100_000));

    expect(facts.captureRatio).toBeNull();
  });
});

describe("adverse excursion", () => {
  it("records the worst point endured during the hold", () => {
    const trip = roundTrip(100, 110, 4);
    const facts = extractFacts(
      trip,
      buildTimeline(trip, candles([100, 92, 95, 105, 110])),
      rupeesToPaise(100_000),
    );

    // Dipped to 92 → −₹800 on 100 shares.
    expect(facts.maxAdverse).toBe(rupeesToPaise(-800));
  });
});

describe("exposure", () => {
  it("expresses position cost as a share of capital", () => {
    const trip = roundTrip(100, 110, 2, 100);
    const facts = extractFacts(trip, buildTimeline(trip, candles([100, 105, 110])), rupeesToPaise(50_000));

    // ₹10,000 of ₹50,000
    expect(facts.exposurePercent).toBeCloseTo(20);
  });
});
