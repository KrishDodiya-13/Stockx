import { describe, expect, it } from "vitest";

import { rupeesToPaise, rupeesToPrice } from "@/lib/money";
import type { RoundTrip } from "@/services/replay/replay-engine";
import {
  MIN_TRADES_FOR_COMPARISON,
  MIN_TRADES_FOR_METRICS,
  analyseTrades,
  formatDuration,
  generateInsights,
  type InstrumentMeta,
} from "@/services/dna/dna-engine";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let sequence = 0;

function trip(overrides: Partial<RoundTrip> = {}): RoundTrip {
  sequence += 1;
  const openedAt = sequence * DAY;

  return {
    id: `t${sequence}`,
    instrumentId: "NSE:RELIANCE",
    symbol: "RELIANCE",
    status: "CLOSED",
    openedAt,
    closedAt: openedAt + 2 * HOUR,
    fills: [],
    quantity: 100,
    averageEntry: rupeesToPrice(100),
    averageExit: rupeesToPrice(110),
    realisedPnl: rupeesToPaise(1000),
    realisedPnlPercent: 10,
    automated: false,
    ...overrides,
  };
}

const instruments = new Map<string, InstrumentMeta>([
  ["NSE:RELIANCE", { symbol: "RELIANCE", sector: "Energy" }],
  ["NSE:TCS", { symbol: "TCS", sector: "Technology" }],
]);

function many(count: number, overrides: (i: number) => Partial<RoundTrip> = () => ({})) {
  return Array.from({ length: count }, (_, i) => trip(overrides(i)));
}

describe("sample-size gating", () => {
  it("reports nothing at all below the metric threshold", () => {
    /*
      The integrity requirement. A win rate of 100% from two trades is not a
      win rate, and presenting one would mislead.
    */
    const profile = analyseTrades(many(MIN_TRADES_FOR_METRICS - 1), instruments);

    expect(profile.sufficient).toBe(false);
    expect(profile.winRate).toBeNull();
    expect(profile.averageWin).toBeNull();
    expect(profile.riskReward).toBeNull();
    expect(profile.styleMix).toBeNull();
    expect(profile.riskDiscipline).toBeNull();
  });

  it("produces no insights below the threshold", () => {
    const profile = analyseTrades(many(2), instruments);
    expect(generateInsights(profile)).toHaveLength(0);
  });

  it("starts reporting once the threshold is met", () => {
    const profile = analyseTrades(many(MIN_TRADES_FOR_METRICS), instruments);

    expect(profile.sufficient).toBe(true);
    expect(profile.winRate).not.toBeNull();
  });

  it("withholds comparative rankings until there is enough to compare", () => {
    const few = analyseTrades(many(MIN_TRADES_FOR_METRICS), instruments);
    expect(few.bySector).toHaveLength(0);
    expect(few.byHour).toHaveLength(0);

    const enough = analyseTrades(many(MIN_TRADES_FOR_COMPARISON), instruments);
    expect(enough.bySector.length).toBeGreaterThan(0);
  });

  it("marks a thin group as insufficient rather than dropping it", () => {
    const trips = [
      ...many(11),
      trip({ instrumentId: "NSE:TCS", symbol: "TCS" }),
    ];

    const profile = analyseTrades(trips, instruments);
    const tcs = profile.bySymbol.find((group) => group.key === "TCS");

    expect(tcs).toBeDefined();
    expect(tcs!.sufficient).toBe(false);
  });

  it("ignores open trips — an unrealised result is not an outcome", () => {
    const trips = [...many(6), trip({ status: "OPEN", closedAt: null })];
    const profile = analyseTrades(trips, instruments);

    expect(profile.tradeCount).toBe(7);
    expect(profile.closedCount).toBe(6);
  });
});

describe("core metrics", () => {
  it("computes win rate over closed trades", () => {
    const trips = [
      ...many(3, () => ({ realisedPnl: rupeesToPaise(1000) })),
      ...many(2, () => ({ realisedPnl: rupeesToPaise(-500) })),
    ];

    expect(analyseTrades(trips, instruments).winRate).toBe(60);
  });

  it("averages wins and losses separately", () => {
    const trips = [
      ...many(3, () => ({ realisedPnl: rupeesToPaise(1000) })),
      ...many(2, () => ({ realisedPnl: rupeesToPaise(-500) })),
    ];

    const profile = analyseTrades(trips, instruments);
    expect(profile.averageWin).toBe(rupeesToPaise(1000));
    // Reported as a positive magnitude.
    expect(profile.averageLoss).toBe(rupeesToPaise(500));
    expect(profile.riskReward).toBeCloseTo(2);
  });

  it("returns a null risk/reward when there were no losses", () => {
    const profile = analyseTrades(many(6, () => ({ realisedPnl: rupeesToPaise(100) })), instruments);
    // Dividing by no losses is not a ratio worth printing.
    expect(profile.averageLoss).toBeNull();
    expect(profile.riskReward).toBeNull();
  });

  it("measures drawdown peak-to-trough on realised equity", () => {
    const trips = [
      trip({ realisedPnl: rupeesToPaise(1000) }),
      trip({ realisedPnl: rupeesToPaise(1000) }),
      trip({ realisedPnl: rupeesToPaise(-1500) }),
      trip({ realisedPnl: rupeesToPaise(-500) }),
      trip({ realisedPnl: rupeesToPaise(300) }),
    ];

    // Peak +2,000, trough 0 → drawdown 2,000.
    const profile = analyseTrades(trips, instruments);
    expect(profile.maxDrawdown).toBe(rupeesToPaise(2000));
    expect(profile.maxDrawdownPercent).toBeCloseTo(-100);
  });

  it("reports a null drawdown percentage when equity never rose above its start", () => {
    /*
      A percentage of a peak of zero is undefined. Reporting 0% beside a
      non-zero rupee drawdown would contradict itself on screen.
    */
    const trips = many(5, () => ({ realisedPnl: rupeesToPaise(-500) }));
    const profile = analyseTrades(trips, instruments);

    expect(profile.maxDrawdown).toBeGreaterThan(0);
    expect(profile.maxDrawdownPercent).toBeNull();
  });

  it("separates winner and loser holding times", () => {
    const trips = [
      ...many(3, (i) => ({
        realisedPnl: rupeesToPaise(500),
        closedAt: (sequence + i) * DAY,
      })),
      ...many(2, () => ({ realisedPnl: rupeesToPaise(-500) })),
    ];

    const profile = analyseTrades(trips, instruments);
    expect(profile.averageWinHoldMs).not.toBeNull();
    expect(profile.averageLossHoldMs).not.toBeNull();
  });
});

describe("style mix", () => {
  it("buckets by holding period and sums to 100", () => {
    const base = 1_000 * DAY;
    const trips = [
      trip({ openedAt: base, closedAt: base + 30 * 60_000 }), // scalp
      trip({ openedAt: base, closedAt: base + 5 * HOUR }), // intraday
      trip({ openedAt: base, closedAt: base + 3 * DAY }), // swing
      trip({ openedAt: base, closedAt: base + 20 * DAY }), // position
      trip({ openedAt: base, closedAt: base + 10 * 60_000 }), // scalp
    ];

    const mix = analyseTrades(trips, instruments).styleMix!;
    const total = mix.scalping + mix.intraday + mix.swing + mix.position;

    expect(total).toBeCloseTo(100);
    expect(mix.scalping).toBeCloseTo(40);
  });
});

describe("behavioural scores", () => {
  it("scores identical position sizes as highly consistent", () => {
    const profile = analyseTrades(
      many(8, () => ({ quantity: 100, averageEntry: rupeesToPrice(100) })),
      instruments,
    );
    expect(profile.sizingConsistency).toBeGreaterThan(90);
  });

  it("scores wildly varying sizes as inconsistent", () => {
    const profile = analyseTrades(
      many(8, (i) => ({ quantity: i === 0 ? 10_000 : 10, averageEntry: rupeesToPrice(100) })),
      instruments,
    );
    expect(profile.sizingConsistency).toBeLessThan(50);
  });

  it("scores discipline above the midpoint when losers are cut sooner", () => {
    const base = 1_000 * DAY;
    const trips = [
      ...Array.from({ length: 3 }, () =>
        trip({ realisedPnl: rupeesToPaise(500), openedAt: base, closedAt: base + 10 * DAY }),
      ),
      ...Array.from({ length: 3 }, () =>
        trip({ realisedPnl: rupeesToPaise(-500), openedAt: base, closedAt: base + 1 * HOUR }),
      ),
    ];

    expect(analyseTrades(trips, instruments).riskDiscipline!).toBeGreaterThan(50);
  });

  it("scores discipline below the midpoint when losers are held longer", () => {
    const base = 1_000 * DAY;
    const trips = [
      ...Array.from({ length: 3 }, () =>
        trip({ realisedPnl: rupeesToPaise(500), openedAt: base, closedAt: base + 1 * HOUR }),
      ),
      ...Array.from({ length: 3 }, () =>
        trip({ realisedPnl: rupeesToPaise(-500), openedAt: base, closedAt: base + 10 * DAY }),
      ),
    ];

    expect(analyseTrades(trips, instruments).riskDiscipline!).toBeLessThan(50);
  });

  it("keeps every score within 0 and 100", () => {
    const profile = analyseTrades(
      many(20, (i) => ({
        realisedPnl: rupeesToPaise(i % 3 === 0 ? -2000 : 500),
        quantity: 10 + i * 37,
      })),
      instruments,
    );

    for (const score of [
      profile.sizingConsistency,
      profile.riskDiscipline,
      profile.outcomeConsistency,
    ]) {
      if (score === null) continue;
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe("insights", () => {
  it("never predicts, only describes", () => {
    const profile = analyseTrades(many(20, (i) => ({ realisedPnl: rupeesToPaise(i % 2 ? 900 : -300) })), instruments);
    const insights = generateInsights(profile);

    expect(insights.length).toBeGreaterThan(0);

    // No forward-looking or advisory language anywhere.
    const forbidden = /\bwill\b|\bshould\b|\bguarantee|\bexpect to\b|\bpredict|\bwe recommend\b/i;
    for (const insight of insights) {
      expect(insight.text).not.toMatch(forbidden);
    }
  });

  it("attaches a sample size and confidence to every insight", () => {
    const profile = analyseTrades(many(20), instruments);
    for (const insight of generateInsights(profile)) {
      expect(insight.sampleSize).toBe(profile.closedCount);
      expect(["low", "moderate"]).toContain(insight.confidence);
    }
  });

  it("marks a thin sample as low confidence", () => {
    const profile = analyseTrades(many(MIN_TRADES_FOR_METRICS), instruments);
    for (const insight of generateInsights(profile)) {
      expect(insight.confidence).toBe("low");
    }
  });

  it("flags losers being held longer than winners", () => {
    const base = 1_000 * DAY;
    const trips = [
      ...Array.from({ length: 4 }, () =>
        trip({ realisedPnl: rupeesToPaise(500), openedAt: base, closedAt: base + 1 * HOUR }),
      ),
      ...Array.from({ length: 4 }, () =>
        trip({ realisedPnl: rupeesToPaise(-500), openedAt: base, closedAt: base + 10 * DAY }),
      ),
    ];

    const ids = generateInsights(analyseTrades(trips, instruments)).map((i) => i.id);
    expect(ids).toContain("losers-held-longer");
  });

  it("makes no comparative claim on a thin sample", () => {
    const profile = analyseTrades(many(MIN_TRADES_FOR_METRICS), instruments);
    const ids = generateInsights(profile).map((insight) => insight.id);
    // "Your best sector" needs more than five trades to mean anything.
    expect(ids).not.toContain("best-sector");
  });
});

describe("formatDuration", () => {
  it("scales the unit to the magnitude", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(30 * 60_000)).toBe("30m");
    expect(formatDuration(5 * HOUR)).toBe("5.0h");
    expect(formatDuration(3 * DAY)).toBe("3.0d");
  });

  it("renders a dash for no data", () => {
    expect(formatDuration(null)).toBe("—");
  });
});
