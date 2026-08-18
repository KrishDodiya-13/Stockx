/**
 * Challenges and achievements.
 *
 * Pure evaluation against an account's real record. Nothing here is awarded on
 * participation or on a single lucky trade: every criterion carries a minimum
 * sample, so a badge means something happened repeatedly rather than once.
 *
 * Progress is always reported, including for criteria not yet met — a locked
 * badge with no indication of distance is just a locked door.
 */

import type { Paise } from "@/lib/money";

/** Minimum closed trades before an outcome-based award can be earned. */
export const MIN_TRADES_FOR_AWARD = 10;

export interface AccountSnapshot {
  readonly startingCapital: Paise;
  readonly currentEquity: Paise;
  readonly returnPercent: number;
  readonly benchmarkPercent: number;
  readonly closedTrades: number;
  readonly wins: number;
  readonly winRate: number;
  readonly maxDrawdownPercent: number;
  /** Strategies the user has built, and how many have ever run. */
  readonly strategiesCreated: number;
  readonly strategiesActivated: number;
  /** Share of closed trades that had a stop rule protecting them. */
  readonly tradesWithStops: number;
  /** Average hold of winners and losers, in ms. Null without both. */
  readonly averageWinHoldMs: number | null;
  readonly averageLossHoldMs: number | null;
  /** Evenness of trade outcomes, 0–100. */
  readonly consistency: number | null;
}

export type ChallengeId =
  | "beat-nifty"
  | "target-return"
  | "maintain-win-rate"
  | "control-drawdown";

export interface Challenge {
  readonly id: ChallengeId;
  readonly title: string;
  readonly description: string;
  /** What the user is measured against. */
  readonly target: string;
  /** 0–100. */
  readonly progress: number;
  readonly complete: boolean;
  /** Human-readable current standing. */
  readonly current: string;
  /** False when there is not yet enough history to judge. */
  readonly measurable: boolean;
  readonly requirement: string;
}

export function evaluateChallenges(snapshot: AccountSnapshot): readonly Challenge[] {
  const enough = snapshot.closedTrades >= MIN_TRADES_FOR_AWARD;
  const requirement = `Needs ${MIN_TRADES_FOR_AWARD} closed trades`;

  const outperformance = snapshot.returnPercent - snapshot.benchmarkPercent;

  return [
    {
      id: "beat-nifty",
      title: "Beat the benchmark",
      description: "Finish ahead of simply holding the index over the same period.",
      target: "+5% vs benchmark",
      // Progress toward a 5-point margin; being behind reads as zero, not negative.
      progress: clamp((outperformance / 5) * 100),
      complete: enough && outperformance >= 5,
      current: `${outperformance >= 0 ? "+" : ""}${outperformance.toFixed(2)}% vs benchmark`,
      measurable: enough,
      requirement,
    },
    {
      id: "target-return",
      // Named as a proportion, not as ₹10L → ₹12L. The challenge is measured on
      // `returnPercent`, so it is the same challenge whatever an account was
      // funded with — and now that funding is chosen at sign-up, absolute
      // figures in the title would be wrong for everyone who did not deposit
      // the full cap.
      title: "Grow your capital by a fifth",
      description: "Finish 20% ahead of everything you have deposited.",
      target: "+20% return",
      progress: clamp((snapshot.returnPercent / 20) * 100),
      complete: snapshot.returnPercent >= 20,
      current: `${snapshot.returnPercent >= 0 ? "+" : ""}${snapshot.returnPercent.toFixed(2)}%`,
      // A return target is measurable from the balance alone, so it needs no
      // trade minimum — unlike the rate-based challenges below.
      measurable: true,
      requirement: "Measured on account balance",
    },
    {
      id: "maintain-win-rate",
      title: "Hold a 60% win rate",
      description: "Win more than three in five closed trades.",
      target: "60% win rate",
      progress: clamp((snapshot.winRate / 60) * 100),
      complete: enough && snapshot.winRate >= 60,
      current: enough ? `${snapshot.winRate.toFixed(0)}%` : `${snapshot.closedTrades} trades so far`,
      measurable: enough,
      requirement,
    },
    {
      id: "control-drawdown",
      title: "Keep drawdown under 5%",
      description: "Never let the account fall more than a twentieth from its peak.",
      target: "Max drawdown below 5%",
      // Inverted: the less drawdown, the more progress.
      progress: clamp(100 - (snapshot.maxDrawdownPercent / 5) * 100),
      complete: enough && snapshot.maxDrawdownPercent < 5,
      current: `${snapshot.maxDrawdownPercent.toFixed(2)}% peak-to-trough`,
      measurable: enough,
      requirement,
    },
  ];
}

// --- achievements ----------------------------------------------------------

export type AchievementId =
  | "market-master"
  | "strategy-architect"
  | "risk-manager"
  | "momentum-trader"
  | "consistent-trader";

export interface Achievement {
  readonly id: AchievementId;
  readonly title: string;
  readonly description: string;
  /** Exactly what had to happen — stated so a badge is never mysterious. */
  readonly criterion: string;
  readonly earned: boolean;
  /** 0–100 toward earning it. */
  readonly progress: number;
  readonly current: string;
}

export function evaluateAchievements(snapshot: AccountSnapshot): readonly Achievement[] {
  const enough = snapshot.closedTrades >= MIN_TRADES_FOR_AWARD;

  const stopCoverage =
    snapshot.closedTrades === 0 ? 0 : (snapshot.tradesWithStops / snapshot.closedTrades) * 100;

  const holdRatio =
    snapshot.averageWinHoldMs === null ||
    snapshot.averageLossHoldMs === null ||
    snapshot.averageLossHoldMs === 0
      ? null
      : snapshot.averageWinHoldMs / snapshot.averageLossHoldMs;

  return [
    {
      id: "market-master",
      title: "Market Master",
      description: "Outperformed the benchmark with a real record behind it.",
      criterion: `Beat the benchmark by 5 points across at least ${MIN_TRADES_FOR_AWARD} closed trades`,
      earned: enough && snapshot.returnPercent - snapshot.benchmarkPercent >= 5,
      progress: clamp(((snapshot.returnPercent - snapshot.benchmarkPercent) / 5) * 100),
      current: `${(snapshot.returnPercent - snapshot.benchmarkPercent).toFixed(2)} points vs benchmark`,
    },
    {
      id: "strategy-architect",
      title: "Strategy Architect",
      description: "Built conditional strategies and put them to work.",
      criterion: "Create three strategies and activate at least one",
      earned: snapshot.strategiesCreated >= 3 && snapshot.strategiesActivated >= 1,
      progress: clamp((snapshot.strategiesCreated / 3) * 100),
      current: `${snapshot.strategiesCreated} built · ${snapshot.strategiesActivated} activated`,
    },
    {
      id: "risk-manager",
      title: "Risk Manager",
      description: "Kept losses bounded and drawdown shallow.",
      criterion: `Drawdown under 5% across at least ${MIN_TRADES_FOR_AWARD} closed trades`,
      earned: enough && snapshot.maxDrawdownPercent < 5,
      progress: clamp(100 - (snapshot.maxDrawdownPercent / 5) * 100),
      current: `${snapshot.maxDrawdownPercent.toFixed(2)}% max drawdown · ${stopCoverage.toFixed(0)}% of trades had a stop`,
    },
    {
      id: "momentum-trader",
      title: "Momentum Trader",
      description: "Let winners run longer than losers.",
      criterion: `Hold winners at least 1.5× as long as losers, across ${MIN_TRADES_FOR_AWARD} closed trades`,
      earned: enough && holdRatio !== null && holdRatio >= 1.5,
      progress: holdRatio === null ? 0 : clamp((holdRatio / 1.5) * 100),
      current:
        holdRatio === null
          ? "Needs both winning and losing trades"
          : `Winners held ${holdRatio.toFixed(1)}× as long`,
    },
    {
      id: "consistent-trader",
      title: "Consistent Trader",
      description: "Results spread across many trades rather than a lucky few.",
      criterion: `Outcome evenness above 60 across at least ${MIN_TRADES_FOR_AWARD} closed trades`,
      earned: enough && snapshot.consistency !== null && snapshot.consistency >= 60,
      progress: snapshot.consistency === null ? 0 : clamp((snapshot.consistency / 60) * 100),
      current:
        snapshot.consistency === null
          ? `${snapshot.closedTrades} trades so far`
          : `Evenness ${snapshot.consistency.toFixed(0)} of 100`,
    },
  ];
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
