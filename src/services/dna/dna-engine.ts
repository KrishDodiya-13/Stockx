/**
 * Strategy DNA.
 *
 * Descriptive statistics over a trader's own completed round trips. Pure — the
 * caller supplies the trips and instrument metadata.
 *
 * ── What this is, and is not ───────────────────────────────────────────────
 *
 * Every figure here describes what *already happened*. None of it forecasts
 * anything, and the module is built to make overclaiming difficult:
 *
 *  - Metrics that need a minimum sample return `null` rather than a number
 *    computed from two trades. A win rate of "100%" from one trade is not a
 *    win rate, and rendering it as one would be misleading.
 *
 *  - Style scores are defined *only* from holding periods, which are directly
 *    observable in the trade record. Labels like "momentum" or "value" are
 *    tempting but would require inferring intent from data that does not
 *    capture it, so the scores here say exactly what they measure and no more.
 *
 *  - Insights carry a confidence derived from sample size, and are phrased as
 *    observations about past trades rather than as advice or prediction.
 */

import type { Sector } from "@/domain/market";
import type { RoundTrip } from "@/services/replay/replay-engine";
import { addPaise, priceToRupees, subPaise, ZERO_PAISE, type Paise } from "@/lib/money";

/** Below this, no aggregate metric is reported at all. */
export const MIN_TRADES_FOR_METRICS = 5;
/** Below this, comparative claims (best hour, best sector) are withheld. */
export const MIN_TRADES_FOR_COMPARISON = 12;
/** Below this, a per-group figure is not reported for that group. */
export const MIN_TRADES_PER_GROUP = 3;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface InstrumentMeta {
  readonly symbol: string;
  readonly sector: Sector | null;
}

export interface GroupPerformance {
  readonly key: string;
  readonly trades: number;
  readonly totalPnl: Paise;
  readonly winRate: number;
  /** False when the group has too few trades to characterise. */
  readonly sufficient: boolean;
}

/**
 * Holding-period mix.
 *
 * The one style measure derivable from the trade record without inferring
 * intent. Buckets are shares of closed trades and sum to 100.
 */
export interface StyleMix {
  /** Under an hour. */
  readonly scalping: number;
  /** An hour to a day. */
  readonly intraday: number;
  /** A day to a week. */
  readonly swing: number;
  /** Over a week. */
  readonly position: number;
}

export interface DnaProfile {
  readonly tradeCount: number;
  readonly closedCount: number;
  /** True when there is enough history for the headline metrics. */
  readonly sufficient: boolean;

  readonly winRate: number | null;
  readonly averageWin: Paise | null;
  readonly averageLoss: Paise | null;
  /** Average win ÷ average loss. Null when either side is missing. */
  readonly riskReward: number | null;

  readonly averageHoldMs: number | null;
  readonly averageWinHoldMs: number | null;
  readonly averageLossHoldMs: number | null;

  readonly maxDrawdown: Paise;
  /**
   * Drawdown as a share of the peak it fell from.
   *
   * Null when realised equity never rose above its starting point: a
   * percentage of a peak of zero is undefined, and reporting it as 0% beside a
   * non-zero rupee drawdown would contradict itself.
   */
  readonly maxDrawdownPercent: number | null;

  /** Closed trades per active trading day. */
  readonly tradesPerDay: number | null;
  readonly activeDays: number;

  readonly styleMix: StyleMix | null;

  /**
   * How consistently position size is chosen, 0–100. Derived from the spread
   * of capital committed per trade: a trader who risks a similar amount each
   * time scores high. It measures *repeatability*, not correctness.
   */
  readonly sizingConsistency: number | null;

  /**
   * Whether losses are cut faster than winners are held, 0–100. 50 means
   * winners and losers are held equally long; above 50 means losers are closed
   * sooner.
   */
  readonly riskDiscipline: number | null;

  /**
   * Evenness of outcomes, 0–100. High means results cluster; low means a few
   * trades dominate the total. Neither is inherently good.
   */
  readonly outcomeConsistency: number | null;

  readonly bySymbol: readonly GroupPerformance[];
  readonly bySector: readonly GroupPerformance[];
  readonly byHour: readonly GroupPerformance[];
}

export function analyseTrades(
  trips: readonly RoundTrip[],
  instruments: ReadonlyMap<string, InstrumentMeta>,
): DnaProfile {
  const closed = trips.filter((trip) => trip.status === "CLOSED" && trip.closedAt !== null);
  const sufficient = closed.length >= MIN_TRADES_FOR_METRICS;

  const empty: DnaProfile = {
    tradeCount: trips.length,
    closedCount: closed.length,
    sufficient,
    winRate: null,
    averageWin: null,
    averageLoss: null,
    riskReward: null,
    averageHoldMs: null,
    averageWinHoldMs: null,
    averageLossHoldMs: null,
    maxDrawdown: ZERO_PAISE,
    maxDrawdownPercent: null,
    tradesPerDay: null,
    activeDays: 0,
    styleMix: null,
    sizingConsistency: null,
    riskDiscipline: null,
    outcomeConsistency: null,
    bySymbol: [],
    bySector: [],
    byHour: [],
  };

  if (!sufficient) return empty;

  const wins = closed.filter((trip) => trip.realisedPnl > 0);
  const losses = closed.filter((trip) => trip.realisedPnl < 0);

  const averageWin =
    wins.length === 0
      ? null
      : (Math.round(wins.reduce((t, trip) => t + trip.realisedPnl, 0) / wins.length) as Paise);

  const averageLoss =
    losses.length === 0
      ? null
      : (Math.round(
          Math.abs(losses.reduce((t, trip) => t + trip.realisedPnl, 0)) / losses.length,
        ) as Paise);

  const holdOf = (trip: RoundTrip): number => (trip.closedAt ?? trip.openedAt) - trip.openedAt;

  const mean = (values: readonly number[]): number | null =>
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

  const averageHoldMs = mean(closed.map(holdOf));
  const averageWinHoldMs = mean(wins.map(holdOf));
  const averageLossHoldMs = mean(losses.map(holdOf));

  // --- drawdown on the realised equity path -------------------------------
  const chronological = [...closed].sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));

  let running = ZERO_PAISE;
  let peak = ZERO_PAISE;
  let maxDrawdown = ZERO_PAISE;

  for (const trip of chronological) {
    running = addPaise(running, trip.realisedPnl);
    if (running > peak) peak = running;
    const drawdown = subPaise(peak, running);
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const maxDrawdownPercent = peak <= 0 ? null : -(maxDrawdown / peak) * 100;

  // --- frequency ----------------------------------------------------------
  const days = new Set(chronological.map((trip) => new Date(trip.openedAt).toDateString()));
  const activeDays = days.size;

  // --- style mix ----------------------------------------------------------
  const buckets = { scalping: 0, intraday: 0, swing: 0, position: 0 };
  for (const trip of closed) {
    const held = holdOf(trip);
    if (held < HOUR) buckets.scalping += 1;
    else if (held < DAY) buckets.intraday += 1;
    else if (held < 7 * DAY) buckets.swing += 1;
    else buckets.position += 1;
  }

  const styleMix: StyleMix = {
    scalping: (buckets.scalping / closed.length) * 100,
    intraday: (buckets.intraday / closed.length) * 100,
    swing: (buckets.swing / closed.length) * 100,
    position: (buckets.position / closed.length) * 100,
  };

  // --- behavioural scores -------------------------------------------------
  const sizes = closed.map((trip) => trip.quantity * priceToRupees(trip.averageEntry));
  const sizingConsistency = evenness(sizes);

  /*
    Risk discipline: are losers closed sooner than winners are held?

    Expressed as a 0–100 score around a midpoint of 50, where 50 means the two
    are held equally long. It says nothing about whether the exits were *right*
    — only about the asymmetry, which is the behaviour traders most often get
    backwards.
  */
  const riskDiscipline =
    averageWinHoldMs === null || averageLossHoldMs === null || averageWinHoldMs === 0
      ? null
      : clamp(
          50 + 50 * ((averageWinHoldMs - averageLossHoldMs) / Math.max(averageWinHoldMs, averageLossHoldMs)),
        );

  const outcomeConsistency = evenness(closed.map((trip) => Math.abs(trip.realisedPnl)));

  // --- groupings ----------------------------------------------------------
  const comparable = closed.length >= MIN_TRADES_FOR_COMPARISON;

  const bySymbol = groupBy(closed, (trip) => trip.symbol);
  const bySector = groupBy(closed, (trip) => {
    const meta = instruments.get(trip.instrumentId);
    return meta?.sector ?? "Unclassified";
  });
  const byHour = groupBy(closed, (trip) =>
    String(new Date(trip.openedAt).getHours()).padStart(2, "0"),
  );

  return {
    tradeCount: trips.length,
    closedCount: closed.length,
    sufficient: true,
    winRate: (wins.length / closed.length) * 100,
    averageWin,
    averageLoss,
    riskReward:
      averageWin === null || averageLoss === null || averageLoss === 0
        ? null
        : averageWin / averageLoss,
    averageHoldMs,
    averageWinHoldMs,
    averageLossHoldMs,
    maxDrawdown,
    maxDrawdownPercent,
    tradesPerDay: activeDays === 0 ? null : closed.length / activeDays,
    activeDays,
    styleMix,
    sizingConsistency,
    riskDiscipline,
    outcomeConsistency,
    // Comparative rankings are withheld until there is enough history for a
    // comparison to mean anything.
    bySymbol: comparable ? bySymbol : [],
    bySector: comparable ? bySector : [],
    byHour: comparable ? byHour : [],
  };
}

function groupBy(
  trips: readonly RoundTrip[],
  key: (trip: RoundTrip) => string,
): GroupPerformance[] {
  const groups = new Map<string, RoundTrip[]>();

  for (const trip of trips) {
    const k = key(trip);
    groups.set(k, [...(groups.get(k) ?? []), trip]);
  }

  return [...groups.entries()]
    .map(([k, list]) => ({
      key: k,
      trades: list.length,
      totalPnl: list.reduce<Paise>((total, trip) => addPaise(total, trip.realisedPnl), ZERO_PAISE),
      winRate: (list.filter((trip) => trip.realisedPnl > 0).length / list.length) * 100,
      // A group of one or two says nothing; flagged so the UI can mark it.
      sufficient: list.length >= MIN_TRADES_PER_GROUP,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

/**
 * How evenly a set of values is spread, 0–100.
 *
 * 100 means every value is identical; lower means a few dominate. Uses the
 * coefficient of variation, which is scale-free — so a trader working in
 * thousands and one working in lakhs are measured the same way.
 */
function evenness(values: readonly number[]): number | null {
  if (values.length < MIN_TRADES_FOR_METRICS) return null;

  const positive = values.filter((value) => value > 0);
  if (positive.length === 0) return null;

  const average = positive.reduce((a, b) => a + b, 0) / positive.length;
  if (average === 0) return null;

  const variance =
    positive.reduce((total, value) => total + (value - average) ** 2, 0) / positive.length;
  const coefficient = Math.sqrt(variance) / average;

  // A coefficient of 1 or more is very uneven; map [0,1] onto [100,0].
  return clamp(100 * (1 - Math.min(coefficient, 1)));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// --- insights --------------------------------------------------------------

export type InsightTone = "observation" | "caution" | "strength";

export interface Insight {
  readonly id: string;
  readonly text: string;
  readonly tone: InsightTone;
  /** How many trades this observation rests on. */
  readonly sampleSize: number;
  /** Low samples are labelled as such rather than hidden. */
  readonly confidence: "low" | "moderate";
}

/**
 * Turn the profile into plain-language observations.
 *
 * Rules this generator follows, and the tests enforce:
 *  - Every insight states what happened, never what will happen.
 *  - No insight is produced below the metric threshold.
 *  - Each carries its sample size, so the reader can weigh it.
 */
export function generateInsights(profile: DnaProfile): readonly Insight[] {
  if (!profile.sufficient) return [];

  const insights: Insight[] = [];
  const confidence: Insight["confidence"] =
    profile.closedCount >= MIN_TRADES_FOR_COMPARISON ? "moderate" : "low";

  const add = (id: string, text: string, tone: InsightTone): void => {
    insights.push({ id, text, tone, sampleSize: profile.closedCount, confidence });
  };

  // Holding-time asymmetry — the most actionable observation available.
  if (profile.averageWinHoldMs !== null && profile.averageLossHoldMs !== null) {
    if (profile.averageLossHoldMs > profile.averageWinHoldMs * 1.3) {
      add(
        "losers-held-longer",
        `Your losing trades stayed open about ${ratio(profile.averageLossHoldMs, profile.averageWinHoldMs)}× longer than your winning ones.`,
        "caution",
      );
    } else if (profile.averageWinHoldMs > profile.averageLossHoldMs * 1.3) {
      add(
        "winners-held-longer",
        `You held winning trades about ${ratio(profile.averageWinHoldMs, profile.averageLossHoldMs)}× longer than losing ones.`,
        "strength",
      );
    }
  }

  // Win rate against payoff — the pair only means something together.
  if (profile.winRate !== null && profile.riskReward !== null) {
    if (profile.winRate < 50 && profile.riskReward > 1.5) {
      add(
        "low-hitrate-high-payoff",
        `You won ${profile.winRate.toFixed(0)}% of trades, but your average win was ${profile.riskReward.toFixed(1)}× your average loss.`,
        "observation",
      );
    } else if (profile.winRate > 60 && profile.riskReward < 1) {
      add(
        "high-hitrate-low-payoff",
        `You won ${profile.winRate.toFixed(0)}% of trades, but your average loss was larger than your average win.`,
        "caution",
      );
    }
  }

  if (profile.styleMix) {
    const dominant = dominantStyle(profile.styleMix);
    if (dominant) {
      add(
        "style-mix",
        `${dominant.share.toFixed(0)}% of your trades were ${dominant.label}.`,
        "observation",
      );
    }
  }

  if (profile.sizingConsistency !== null && profile.sizingConsistency < 40) {
    add(
      "uneven-sizing",
      "Your position sizes varied widely between trades, so a single trade could dominate your results.",
      "caution",
    );
  }

  if (profile.outcomeConsistency !== null && profile.outcomeConsistency < 35) {
    add(
      "uneven-outcomes",
      "A small number of trades accounted for most of your profit and loss.",
      "observation",
    );
  }

  // Comparative claims only once there is enough history to compare.
  if (profile.closedCount >= MIN_TRADES_FOR_COMPARISON) {
    const best = profile.bySector.find((group) => group.sufficient && group.totalPnl > 0);
    if (best) {
      add(
        "best-sector",
        `Your ${best.key} trades were your most profitable group, across ${best.trades} trades.`,
        "observation",
      );
    }
  }

  return insights;
}

function ratio(a: number, b: number): string {
  if (b === 0) return "—";
  return (a / b).toFixed(1);
}

function dominantStyle(mix: StyleMix): { label: string; share: number } | null {
  const entries: { label: string; share: number }[] = [
    { label: "held under an hour", share: mix.scalping },
    { label: "closed within the day", share: mix.intraday },
    { label: "held for days", share: mix.swing },
    { label: "held over a week", share: mix.position },
  ];

  const top = entries.reduce((best, entry) => (entry.share > best.share ? entry : best));
  // Only call something dominant when it genuinely is.
  return top.share >= 40 ? top : null;
}

/** Human-readable duration. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < HOUR) return `${Math.round(ms / 60_000)}m`;
  if (ms < DAY) return `${(ms / HOUR).toFixed(1)}h`;
  return `${(ms / DAY).toFixed(1)}d`;
}
