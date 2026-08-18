import { describe, expect, it } from "vitest";

import { rupeesToPaise, type Paise } from "@/lib/money";
import {
  MIN_TRADES_FOR_AWARD,
  evaluateAchievements,
  evaluateChallenges,
  type AccountSnapshot,
} from "@/services/gamification/challenges";
import {
  MIN_TRADES_TO_RANK,
  periodWindow,
  scoreAccounts,
  type AccountRecord,
} from "@/services/gamification/scoring";

function record(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    accountId: "a1",
    displayName: "Trader",
    startingCapital: rupeesToPaise(1_000_000),
    endingEquity: rupeesToPaise(1_100_000),
    closedTrades: 20,
    wins: 12,
    losses: 8,
    maxDrawdown: rupeesToPaise(30_000),
    tradePnls: Array.from({ length: 20 }, () => 5000),
    benchmarkPercent: 5,
    ...overrides,
  };
}

function snapshot(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    startingCapital: rupeesToPaise(1_000_000),
    currentEquity: rupeesToPaise(1_100_000),
    returnPercent: 10,
    benchmarkPercent: 3,
    closedTrades: 20,
    wins: 13,
    winRate: 65,
    maxDrawdownPercent: 3,
    strategiesCreated: 3,
    strategiesActivated: 1,
    tradesWithStops: 18,
    averageWinHoldMs: 6 * 3_600_000,
    averageLossHoldMs: 2 * 3_600_000,
    consistency: 70,
    ...overrides,
  };
}

describe("ranking integrity", () => {
  it("does not rank an account with too thin a record", () => {
    /*
      Otherwise three trades and one lucky winner would top a return-sorted
      board above someone with a hundred trades.
    */
    const [entry] = scoreAccounts([record({ closedTrades: MIN_TRADES_TO_RANK - 1 })]);

    expect(entry!.ranked).toBe(false);
    expect(entry!.rank).toBeNull();
    expect(entry!.score).toBeNull();
  });

  it("still lists an unranked account rather than hiding it", () => {
    const entries = scoreAccounts([record({ closedTrades: 2 })]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.closedTrades).toBe(2);
  });

  it("places ranked accounts above unranked ones", () => {
    const entries = scoreAccounts([
      record({ accountId: "thin", closedTrades: 3, endingEquity: rupeesToPaise(2_000_000) }),
      record({ accountId: "solid", closedTrades: 40 }),
    ]);

    expect(entries[0]!.accountId).toBe("solid");
    expect(entries[1]!.accountId).toBe("thin");
  });

  it("does not rank on absolute profit alone", () => {
    /*
      The core requirement. A big return bought with a huge drawdown must not
      beat a smaller return earned cleanly.
    */
    const reckless = record({
      accountId: "reckless",
      endingEquity: rupeesToPaise(1_400_000), // +40%
      maxDrawdown: rupeesToPaise(350_000), // 35% drawdown
      tradePnls: [200_000, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500],
      closedTrades: 12,
      wins: 6,
      losses: 6,
    });

    const careful = record({
      accountId: "careful",
      endingEquity: rupeesToPaise(1_250_000), // +25%
      maxDrawdown: rupeesToPaise(60_000), // 6% drawdown
      tradePnls: Array.from({ length: 30 }, () => 8000),
      closedTrades: 30,
      wins: 20,
      losses: 10,
    });

    const entries = scoreAccounts([reckless, careful]);
    expect(entries[0]!.accountId).toBe("careful");
  });

  it("reports risk-adjusted return as null when there was no drawdown", () => {
    const [entry] = scoreAccounts([record({ maxDrawdown: 0 as Paise })]);
    // An undefined ratio must not be presented as an unbeatable one.
    expect(entry!.riskAdjusted).toBeNull();
  });

  it("computes outperformance against the benchmark", () => {
    const [entry] = scoreAccounts([record({ benchmarkPercent: 4 })]);
    expect(entry!.returnPercent).toBeCloseTo(10);
    expect(entry!.outperformance).toBeCloseTo(6);
  });

  it("numbers ranks from 1 without gaps", () => {
    const entries = scoreAccounts([
      record({ accountId: "a" }),
      record({ accountId: "b", endingEquity: rupeesToPaise(1_200_000) }),
      record({ accountId: "c", endingEquity: rupeesToPaise(900_000) }),
    ]);

    expect(entries.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it("handles an empty board", () => {
    expect(scoreAccounts([])).toHaveLength(0);
  });
});

describe("period windows", () => {
  it("bounds weekly and monthly, and leaves all-time open", () => {
    const now = Date.now();
    expect(periodWindow("weekly", now).from).toBe(now - 7 * 86_400_000);
    expect(periodWindow("monthly", now).from).toBe(now - 30 * 86_400_000);
    expect(periodWindow("all-time", now).from).toBeNull();
  });
});

describe("challenges", () => {
  it("marks rate-based challenges unmeasurable on a thin record", () => {
    const challenges = evaluateChallenges(snapshot({ closedTrades: 3 }));
    const winRate = challenges.find((c) => c.id === "maintain-win-rate")!;

    expect(winRate.measurable).toBe(false);
    expect(winRate.complete).toBe(false);
  });

  it("measures a return target from the balance without a trade minimum", () => {
    // The balance is the balance, however few trades produced it.
    const challenges = evaluateChallenges(snapshot({ closedTrades: 1, returnPercent: 25 }));
    const target = challenges.find((c) => c.id === "target-return")!;

    expect(target.measurable).toBe(true);
    expect(target.complete).toBe(true);
  });

  it("completes the benchmark challenge only with enough history", () => {
    const thin = evaluateChallenges(snapshot({ closedTrades: 4, returnPercent: 20, benchmarkPercent: 2 }));
    const thick = evaluateChallenges(snapshot({ closedTrades: 30, returnPercent: 20, benchmarkPercent: 2 }));

    expect(thin.find((c) => c.id === "beat-nifty")!.complete).toBe(false);
    expect(thick.find((c) => c.id === "beat-nifty")!.complete).toBe(true);
  });

  it("treats being behind the benchmark as zero progress, not negative", () => {
    const challenges = evaluateChallenges(snapshot({ returnPercent: -10, benchmarkPercent: 5 }));
    const beat = challenges.find((c) => c.id === "beat-nifty")!;

    expect(beat.progress).toBe(0);
  });

  it("inverts drawdown progress so less is better", () => {
    const clean = evaluateChallenges(snapshot({ maxDrawdownPercent: 1 }));
    const rough = evaluateChallenges(snapshot({ maxDrawdownPercent: 9 }));

    const cleanProgress = clean.find((c) => c.id === "control-drawdown")!.progress;
    const roughProgress = rough.find((c) => c.id === "control-drawdown")!.progress;

    expect(cleanProgress).toBeGreaterThan(roughProgress);
    expect(roughProgress).toBe(0);
  });

  it("keeps every progress value within 0 and 100", () => {
    const extremes: Partial<AccountSnapshot>[] = [
      { returnPercent: 500, benchmarkPercent: -50 },
      { returnPercent: -90, benchmarkPercent: 40 },
      { maxDrawdownPercent: 90 },
      { winRate: 0, closedTrades: 50 },
    ];

    for (const shape of extremes) {
      for (const challenge of evaluateChallenges(snapshot(shape))) {
        expect(challenge.progress).toBeGreaterThanOrEqual(0);
        expect(challenge.progress).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("achievements", () => {
  it("never awards an outcome badge on a thin record", () => {
    const achievements = evaluateAchievements(
      snapshot({ closedTrades: MIN_TRADES_FOR_AWARD - 1, returnPercent: 50, maxDrawdownPercent: 0 }),
    );

    for (const id of ["market-master", "risk-manager", "momentum-trader", "consistent-trader"]) {
      expect(achievements.find((a) => a.id === id)!.earned).toBe(false);
    }
  });

  it("awards Strategy Architect on activity rather than outcome", () => {
    // Building strategies is something you did, not something that happened to
    // you, so it needs no trade minimum.
    const achievements = evaluateAchievements(
      snapshot({ closedTrades: 0, strategiesCreated: 3, strategiesActivated: 1 }),
    );

    expect(achievements.find((a) => a.id === "strategy-architect")!.earned).toBe(true);
  });

  it("requires activation, not just creation, for Strategy Architect", () => {
    const achievements = evaluateAchievements(
      snapshot({ strategiesCreated: 8, strategiesActivated: 0 }),
    );
    expect(achievements.find((a) => a.id === "strategy-architect")!.earned).toBe(false);
  });

  it("awards Momentum Trader only when winners are held markedly longer", () => {
    const yes = evaluateAchievements(
      snapshot({ averageWinHoldMs: 5 * 3_600_000, averageLossHoldMs: 2 * 3_600_000 }),
    );
    const no = evaluateAchievements(
      snapshot({ averageWinHoldMs: 2 * 3_600_000, averageLossHoldMs: 2 * 3_600_000 }),
    );

    expect(yes.find((a) => a.id === "momentum-trader")!.earned).toBe(true);
    expect(no.find((a) => a.id === "momentum-trader")!.earned).toBe(false);
  });

  it("handles a trader with no losing trades without dividing by zero", () => {
    const achievements = evaluateAchievements(
      snapshot({ averageWinHoldMs: 4 * 3_600_000, averageLossHoldMs: null }),
    );

    const momentum = achievements.find((a) => a.id === "momentum-trader")!;
    expect(momentum.earned).toBe(false);
    expect(Number.isFinite(momentum.progress)).toBe(true);
  });

  it("states an explicit criterion for every achievement", () => {
    // A badge whose requirement is unstated is just a mystery box.
    for (const achievement of evaluateAchievements(snapshot())) {
      expect(achievement.criterion.length).toBeGreaterThan(10);
      expect(achievement.current.length).toBeGreaterThan(0);
    }
  });

  it("keeps every progress value within 0 and 100", () => {
    const shapes: Partial<AccountSnapshot>[] = [
      { returnPercent: 900, benchmarkPercent: -100 },
      { maxDrawdownPercent: 200 },
      { consistency: null },
      { strategiesCreated: 99 },
    ];

    for (const shape of shapes) {
      for (const achievement of evaluateAchievements(snapshot(shape))) {
        expect(achievement.progress).toBeGreaterThanOrEqual(0);
        expect(achievement.progress).toBeLessThanOrEqual(100);
      }
    }
  });
});
