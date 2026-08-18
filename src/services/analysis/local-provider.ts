/**
 * Local trade review.
 *
 * Rule-based, deterministic and offline. This is the **default** provider, not
 * a degraded fallback: with no API key configured the product still produces a
 * complete, grounded review of every trade.
 *
 * Determinism is a feature here. The same trade always yields the same review,
 * so a user can return to a trade and find the same reading, and so the output
 * can be tested exactly. A model-backed provider cannot promise that, which is
 * one reason this remains the default.
 *
 * Every sentence is generated from a number in `TradeFacts` and quotes it.
 * There is no path in this file that produces a claim without a figure behind
 * it, and none that says what will happen next.
 */

import { formatCurrency, formatPercent } from "@/lib/format";
import { priceToRupees, type Paise } from "@/lib/money";
import {
  REVIEW_DISCLAIMER,
  adverseExcursionPercent,
  type TradeAnalysisProvider,
  type TradeFacts,
  type TradeReview,
} from "@/services/analysis/trade-analysis";

/** Above this share of the best available move, the exit captured most of it. */
const GOOD_CAPTURE = 60;
/** Below this, a large part of the move was left behind. */
const WEAK_CAPTURE = 35;
/** Exposure above this share of capital is worth remarking on. */
const HIGH_EXPOSURE = 25;
/** Unrealised drawdown above this share of cost is worth remarking on. */
const DEEP_DRAWDOWN = 8;

export class LocalAnalysisProvider implements TradeAnalysisProvider {
  readonly name = "local";
  readonly available = true;

  async analyse(facts: TradeFacts): Promise<TradeReview> {
    return {
      source: "local",
      headline: headline(facts),
      wentWell: wentWell(facts),
      couldImprove: couldImprove(facts),
      riskObservations: riskObservations(facts),
      behaviouralObservations: behaviouralObservations(facts),
      disclaimer: REVIEW_DISCLAIMER,
    };
  }
}

function headline(facts: TradeFacts): string {
  const outcome =
    facts.realisedPnl > 0 ? "closed for a gain" : facts.realisedPnl < 0 ? "closed for a loss" : "closed flat";

  return `${facts.quantity.toLocaleString("en-IN")} ${facts.symbol} ${outcome} of ${formatCurrency(
    Math.abs(facts.realisedPnl) as Paise,
    { whole: true },
  )} over ${duration(facts.holdMs)}, while the instrument moved ${formatPercent(facts.marketMovePercent, { signed: true })}.`;
}

function wentWell(facts: TradeFacts): string[] {
  const items: string[] = [];

  if (facts.captureRatio !== null && facts.captureRatio >= GOOD_CAPTURE) {
    items.push(
      `The exit captured ${facts.captureRatio.toFixed(0)}% of the best gain the position reached (${formatCurrency(facts.maxFavourable, { whole: true })}).`,
    );
  }

  if (facts.realisedPnl > 0 && facts.marketMovePercent < 0) {
    items.push(
      `The trade booked a gain while ${facts.symbol} fell ${formatPercent(Math.abs(facts.marketMovePercent))} across the window.`,
    );
  }

  const adverse = adverseExcursionPercent(facts);
  if (facts.maxAdverse === 0 && facts.realisedPnl > 0) {
    items.push("The position was never underwater at any point during the hold.");
  } else if (adverse > 0 && adverse < 2) {
    items.push(
      `The deepest the position went against you was ${formatPercent(adverse)} of its cost — a shallow drawdown.`,
    );
  }

  if (
    facts.postExitMovePercent !== null &&
    facts.realisedPnl > 0 &&
    facts.postExitMovePercent < -1
  ) {
    items.push(
      `Price fell ${formatPercent(Math.abs(facts.postExitMovePercent))} after the exit, so the position was closed ahead of that move.`,
    );
  }

  if (items.length === 0) {
    items.push("No standout strengths were measurable in this trade's numbers.");
  }

  return items;
}

/**
 * Observations a trader might learn from.
 *
 * Phrased as statements about what happened — "the position was closed before
 * the peak" — rather than instructions. The section is titled "what could
 * improve"; the items themselves stay factual, because telling someone what
 * they should have done is advice, and this is not that.
 */
function couldImprove(facts: TradeFacts): string[] {
  const items: string[] = [];

  if (facts.captureRatio !== null && facts.captureRatio < WEAK_CAPTURE) {
    items.push(
      `The position reached ${formatCurrency(facts.maxFavourable, { whole: true })} in unrealised gain but was closed for ${formatCurrency(facts.realisedPnl, { whole: true, signed: true })} — ${facts.captureRatio.toFixed(0)}% of the move available while it was open.`,
    );
  }

  if (facts.postExitMovePercent !== null && facts.postExitMovePercent > 1) {
    items.push(
      `${facts.symbol} rose a further ${formatPercent(facts.postExitMovePercent)} after the exit within the window shown.`,
    );
  }

  if (facts.realisedPnl < 0 && facts.maxFavourable > 0) {
    items.push(
      `The position was in profit by as much as ${formatCurrency(facts.maxFavourable, { whole: true })} before it was closed at a loss.`,
    );
  }

  if (facts.realisedPnl > 0 && facts.marketMovePercent > facts.realisedPnlPercent + 2) {
    items.push(
      `${facts.symbol} moved ${formatPercent(facts.marketMovePercent, { signed: true })} across the window while the trade returned ${formatPercent(facts.realisedPnlPercent, { signed: true })}.`,
    );
  }

  if (items.length === 0) {
    items.push("Nothing in this trade's numbers stands out as an obvious shortfall.");
  }

  return items;
}

function riskObservations(facts: TradeFacts): string[] {
  const items: string[] = [];
  const adverse = adverseExcursionPercent(facts);

  items.push(
    `The position cost ${formatCurrency(facts.cost, { whole: true })}, which was ${formatPercent(facts.exposurePercent)} of account capital.`,
  );

  if (facts.exposurePercent > HIGH_EXPOSURE) {
    items.push(
      `That is a concentrated position — a single instrument accounted for more than ${HIGH_EXPOSURE}% of the account.`,
    );
  }

  if (adverse >= DEEP_DRAWDOWN) {
    items.push(
      `At its worst the position was ${formatCurrency(Math.abs(facts.maxAdverse) as Paise, { whole: true })} underwater, or ${formatPercent(adverse)} of its cost.`,
    );
  } else if (adverse > 0) {
    items.push(
      `The largest unrealised loss during the hold was ${formatCurrency(Math.abs(facts.maxAdverse) as Paise, { whole: true })} (${formatPercent(adverse)} of cost).`,
    );
  }

  if (facts.maxFavourable > 0 && Math.abs(facts.maxAdverse) > 0) {
    const ratio = facts.maxFavourable / Math.abs(facts.maxAdverse);
    items.push(
      `While open, the position ranged ${ratio.toFixed(1)}× further in your favour than against you.`,
    );
  }

  return items;
}

function behaviouralObservations(facts: TradeFacts): string[] {
  const items: string[] = [];

  items.push(
    `The position was held for ${duration(facts.holdMs)}${facts.barsHeld > 0 ? ` across ${facts.barsHeld} bars` : ""}.`,
  );

  if (facts.automated) {
    items.push("At least one fill in this trade came from an automated strategy rather than a manual order.");
  } else {
    items.push("Every fill in this trade was placed manually.");
  }

  if (facts.exitPrice !== null) {
    const entry = priceToRupees(facts.entryPrice);
    const exit = priceToRupees(facts.exitPrice);
    items.push(
      `Average entry was ₹${entry.toFixed(2)} and average exit ₹${exit.toFixed(2)}, a move of ${formatPercent(((exit - entry) / entry) * 100, { signed: true })} per share.`,
    );
  }

  if (facts.holdMs < 5 * 60_000 && facts.realisedPnl < 0) {
    items.push(
      `The position was closed within ${duration(facts.holdMs)} of opening, at a loss.`,
    );
  }

  return items;
}

function duration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} seconds`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} minutes`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} hours`;
  return `${(ms / 86_400_000).toFixed(1)} days`;
}
