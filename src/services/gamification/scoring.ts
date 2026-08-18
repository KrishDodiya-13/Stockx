/**
 * Leaderboard scoring.
 *
 * Pure ranking over account performance. Two principles shape it:
 *
 *  1. **Never rank on absolute profit alone.** The largest bet wins that
 *     contest, not the best decision. Return is one component among five, and
 *     the composite deliberately rewards controlling drawdown and staying
 *     consistent as much as making money.
 *
 *  2. **A thin record does not rank.** An account with three trades and one
 *     lucky winner would otherwise top a return-sorted board. Entries below the
 *     trade minimum are returned but flagged `ranked: false`, so they can be
 *     shown without being placed above people with a real record.
 */

import type { Paise } from "@/lib/money";
import { percentChange } from "@/lib/money";

/** Below this many closed trades, an account is listed but not ranked. */
export const MIN_TRADES_TO_RANK = 10;

export type LeaderboardPeriod = "weekly" | "monthly" | "all-time";

export const PERIOD_LABEL: Record<LeaderboardPeriod, string> = {
  weekly: "This week",
  monthly: "This month",
  "all-time": "All time",
};

/** Window for a period, in epoch ms. `from` is null for all-time. */
export function periodWindow(
  period: LeaderboardPeriod,
  now = Date.now(),
): { from: number | null; to: number } {
  const DAY = 86_400_000;
  if (period === "weekly") return { from: now - 7 * DAY, to: now };
  if (period === "monthly") return { from: now - 30 * DAY, to: now };
  return { from: null, to: now };
}

/** One account's measurable record over a period. */
export interface AccountRecord {
  readonly accountId: string;
  readonly displayName: string;
  readonly startingCapital: Paise;
  /** Equity at the end of the period. */
  readonly endingEquity: Paise;
  readonly closedTrades: number;
  readonly wins: number;
  readonly losses: number;
  /** Largest peak-to-trough fall in realised equity, as a positive amount. */
  readonly maxDrawdown: Paise;
  /** Absolute P&L of each closed trade, for measuring evenness. */
  readonly tradePnls: readonly number[];
  /** Benchmark move over the same window, in percent. */
  readonly benchmarkPercent: number;
}

export interface ScoredEntry {
  readonly accountId: string;
  readonly displayName: string;
  readonly rank: number | null;

  readonly returnPercent: number;
  readonly winRate: number;
  /** Return ÷ maximum drawdown. Null when the account never drew down. */
  readonly riskAdjusted: number | null;
  /** Evenness of trade outcomes, 0–100. */
  readonly consistency: number | null;
  readonly maxDrawdownPercent: number;
  /** Return minus benchmark, in percentage points. */
  readonly outperformance: number;

  readonly closedTrades: number;
  /** False when the record is too thin to place. */
  readonly ranked: boolean;
  /** 0–100 composite. Null when unranked. */
  readonly score: number | null;
}

/**
 * A leaderboard row as it is sent to the browser.
 *
 * `accountId` is deliberately absent — see the note in the gamification route.
 * The caller's own row is marked with `isYou` so the UI can highlight it
 * without needing anyone's identifier.
 */
export type PublicLeaderboardEntry = Omit<ScoredEntry, "accountId"> & {
  readonly isYou: boolean;
};

/**
 * Composite weighting.
 *
 * Return matters most, but not overwhelmingly: an account that made 40% with a
 * 35% drawdown should not outrank one that made 25% with a 6% drawdown, and
 * these weights are chosen so it does not.
 */
const WEIGHTS = {
  return: 0.35,
  riskAdjusted: 0.25,
  consistency: 0.15,
  winRate: 0.15,
  drawdown: 0.1,
} as const;

export function scoreAccounts(records: readonly AccountRecord[]): readonly ScoredEntry[] {
  const scored = records.map((record) => scoreOne(record));

  // Rank only the accounts with a real record; the rest keep rank null.
  const rankable = scored
    .filter((entry) => entry.ranked)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const ranks = new Map(rankable.map((entry, index) => [entry.accountId, index + 1]));

  return scored
    .map((entry) => ({ ...entry, rank: ranks.get(entry.accountId) ?? null }))
    .sort((a, b) => {
      // Ranked accounts first, in rank order; unranked below, by trade count.
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return b.closedTrades - a.closedTrades;
    });
}

function scoreOne(record: AccountRecord): ScoredEntry {
  const returnPercent = percentChange(record.startingCapital, record.endingEquity);

  const winRate =
    record.closedTrades === 0 ? 0 : (record.wins / record.closedTrades) * 100;

  const maxDrawdownPercent =
    record.startingCapital === 0 ? 0 : (record.maxDrawdown / record.startingCapital) * 100;

  /*
    Risk-adjusted return: profit per unit of drawdown endured.

    Null rather than Infinity when there was no drawdown — an undefined ratio
    should not be presented as an unbeatable one.
  */
  const riskAdjusted =
    record.maxDrawdown <= 0 ? null : returnPercent / maxDrawdownPercent;

  const consistency = evenness(record.tradePnls);
  const ranked = record.closedTrades >= MIN_TRADES_TO_RANK;

  return {
    accountId: record.accountId,
    displayName: record.displayName,
    rank: null,
    returnPercent,
    winRate,
    riskAdjusted,
    consistency,
    maxDrawdownPercent,
    outperformance: returnPercent - record.benchmarkPercent,
    closedTrades: record.closedTrades,
    ranked,
    score: ranked
      ? composite({ returnPercent, riskAdjusted, consistency, winRate, maxDrawdownPercent })
      : null,
  };
}

function composite(parts: {
  returnPercent: number;
  riskAdjusted: number | null;
  consistency: number | null;
  winRate: number;
  maxDrawdownPercent: number;
}): number {
  // Each component is normalised to 0–100 before weighting, so one axis with a
  // naturally larger range cannot dominate the total.
  const returnScore = normalise(parts.returnPercent, -30, 60);
  const riskScore = parts.riskAdjusted === null ? 70 : normalise(parts.riskAdjusted, 0, 5);
  const consistencyScore = parts.consistency ?? 50;
  const winScore = normalise(parts.winRate, 0, 100);
  // Lower drawdown is better, so this axis is inverted.
  const drawdownScore = 100 - normalise(parts.maxDrawdownPercent, 0, 40);

  return (
    returnScore * WEIGHTS.return +
    riskScore * WEIGHTS.riskAdjusted +
    consistencyScore * WEIGHTS.consistency +
    winScore * WEIGHTS.winRate +
    drawdownScore * WEIGHTS.drawdown
  );
}

function normalise(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/**
 * Evenness of a set of magnitudes, 0–100.
 *
 * 100 means every trade contributed similarly; low means a handful dominated.
 * Scale-free, so accounts trading different sizes are measured alike.
 */
function evenness(values: readonly number[]): number | null {
  const positive = values.map(Math.abs).filter((value) => value > 0);
  if (positive.length < MIN_TRADES_TO_RANK) return null;

  const average = positive.reduce((a, b) => a + b, 0) / positive.length;
  if (average === 0) return null;

  const variance =
    positive.reduce((total, value) => total + (value - average) ** 2, 0) / positive.length;
  const coefficient = Math.sqrt(variance) / average;

  return Math.max(0, Math.min(100, 100 * (1 - Math.min(coefficient, 1))));
}
