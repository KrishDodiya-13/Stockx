/**
 * Risk calculations.
 *
 * The single source of truth for "what does this trade risk". The Risk
 * Simulator, the strategy builder's pre-flight check and the post-trade
 * analysis must all call this — a second implementation anywhere would let two
 * screens disagree about the same trade.
 *
 * Everything here is arithmetic on the numbers the user supplied. It models no
 * slippage, no fees and no probability of any outcome, and it is not a
 * prediction.
 */

import type { Paise, PriceE4 } from "@/lib/money";
import { notional, percentChange, priceToRupees, subPaise, ZERO_PAISE } from "@/lib/money";

export interface RiskInput {
  readonly entryPrice: PriceE4;
  readonly quantity: number;
  /** Total virtual capital the position is measured against. */
  readonly capital: Paise;
  /** Exit price for the profit case. Optional — a trade may have no target. */
  readonly targetPrice: PriceE4 | null;
  /** Exit price for the loss case. Optional — but a warning is emitted. */
  readonly stopPrice: PriceE4 | null;
}

export type RiskWarningCode =
  | "no-stop-loss"
  | "stop-above-entry"
  | "target-below-entry"
  | "exceeds-capital"
  | "concentrated-position"
  | "oversized-risk"
  | "poor-risk-reward";

export interface RiskWarning {
  readonly code: RiskWarningCode;
  readonly message: string;
  readonly severity: "info" | "caution" | "blocking";
}

export interface RiskProfile {
  /** Cost to open the position. */
  readonly capitalExposure: Paise;
  /** Exposure as a share of total capital (12.5 === 12.5%). */
  readonly exposurePercent: number;
  /** Loss if the stop is hit exactly. Zero when no stop is set. */
  readonly maxLoss: Paise;
  /** Loss as a share of total capital. */
  readonly maxLossPercent: number;
  /** Profit if the target is hit exactly. Zero when no target is set. */
  readonly potentialProfit: Paise;
  readonly potentialProfitPercent: number;
  /** Reward ÷ risk. Null when either leg is missing or risk is zero. */
  readonly riskRewardRatio: number | null;
  /** Move to the stop, in percent (negative). */
  readonly stopDistancePercent: number;
  /** Move to the target, in percent (positive). */
  readonly targetDistancePercent: number;
  /** Break-even is the entry price — restated so the UI need not infer it. */
  readonly breakEvenPrice: PriceE4;
  readonly warnings: readonly RiskWarning[];
  /** False when the position cannot be opened at all. */
  readonly isViable: boolean;
}

/** Risk above this share of capital is flagged. */
const RISK_CAUTION_PERCENT = 2;
/** Exposure above this share of capital is flagged as concentrated. */
const CONCENTRATION_CAUTION_PERCENT = 25;
/** Below this reward:risk the trade is flagged as unfavourable. */
const MIN_HEALTHY_RR = 1;

export function calculateRisk(input: RiskInput): RiskProfile {
  const { entryPrice, quantity, capital, targetPrice, stopPrice } = input;

  const safeQuantity = Number.isFinite(quantity) ? Math.max(0, Math.trunc(quantity)) : 0;
  const capitalExposure = notional(entryPrice, safeQuantity);
  const exposurePercent = capital > 0 ? (capitalExposure / capital) * 100 : 0;

  const entryRupees = priceToRupees(entryPrice);
  const warnings: RiskWarning[] = [];

  // --- loss leg ------------------------------------------------------------
  let maxLoss: Paise = ZERO_PAISE;
  let stopDistancePercent = 0;

  if (stopPrice === null) {
    warnings.push({
      code: "no-stop-loss",
      severity: "caution",
      message: "No stop loss set — the downside on this position is not bounded.",
    });
  } else if (stopPrice >= entryPrice) {
    warnings.push({
      code: "stop-above-entry",
      severity: "blocking",
      message: "A stop loss at or above the entry price does not limit a loss.",
    });
  } else {
    maxLoss = subPaise(capitalExposure, notional(stopPrice, safeQuantity));
    stopDistancePercent = percentChange(entryRupees, priceToRupees(stopPrice));
  }

  // --- profit leg ----------------------------------------------------------
  let potentialProfit: Paise = ZERO_PAISE;
  let targetDistancePercent = 0;

  if (targetPrice !== null) {
    if (targetPrice <= entryPrice) {
      warnings.push({
        code: "target-below-entry",
        severity: "blocking",
        message: "A target at or below the entry price cannot produce a profit on a long position.",
      });
    } else {
      potentialProfit = subPaise(notional(targetPrice, safeQuantity), capitalExposure);
      targetDistancePercent = percentChange(entryRupees, priceToRupees(targetPrice));
    }
  }

  // --- ratios and portfolio context ---------------------------------------
  const maxLossPercent = capital > 0 ? (maxLoss / capital) * 100 : 0;
  const potentialProfitPercent = capital > 0 ? (potentialProfit / capital) * 100 : 0;

  const riskRewardRatio =
    maxLoss > 0 && potentialProfit > 0 ? potentialProfit / maxLoss : null;

  if (capitalExposure > capital) {
    warnings.push({
      code: "exceeds-capital",
      severity: "blocking",
      message: "This position costs more than the available virtual capital.",
    });
  } else if (exposurePercent > CONCENTRATION_CAUTION_PERCENT) {
    warnings.push({
      code: "concentrated-position",
      severity: "caution",
      message: `This single position is ${exposurePercent.toFixed(1)}% of the portfolio.`,
    });
  }

  if (maxLossPercent > RISK_CAUTION_PERCENT) {
    warnings.push({
      code: "oversized-risk",
      severity: "caution",
      message: `A stop-out costs ${maxLossPercent.toFixed(2)}% of total capital.`,
    });
  }

  if (riskRewardRatio !== null && riskRewardRatio < MIN_HEALTHY_RR) {
    warnings.push({
      code: "poor-risk-reward",
      severity: "caution",
      message: "The target pays less than the stop risks.",
    });
  }

  return {
    capitalExposure,
    exposurePercent,
    maxLoss,
    maxLossPercent,
    potentialProfit,
    potentialProfitPercent,
    riskRewardRatio,
    stopDistancePercent,
    targetDistancePercent,
    breakEvenPrice: entryPrice,
    warnings,
    isViable:
      safeQuantity > 0 && warnings.every((warning) => warning.severity !== "blocking"),
  };
}

/**
 * Largest whole-share quantity whose stop-out loss stays within
 * `riskBudgetPercent` of capital, also capped by what the capital can buy.
 * Returns 0 when the stop is not below the entry.
 */
export function maxQuantityForRisk(
  entryPrice: PriceE4,
  stopPrice: PriceE4,
  capital: Paise,
  riskBudgetPercent: number,
): number {
  if (stopPrice >= entryPrice || entryPrice <= 0) return 0;

  const riskBudget = (capital * riskBudgetPercent) / 100;
  const riskPerShare = notional((entryPrice - stopPrice) as PriceE4, 1);
  if (riskPerShare <= 0) return 0;

  const byRisk = Math.floor(riskBudget / riskPerShare);
  const byCapital = Math.floor(capital / Math.max(notional(entryPrice, 1), 1));

  return Math.max(0, Math.min(byRisk, byCapital));
}

/** "1:2.4" — the conventional way traders read reward against risk. */
export function formatRiskReward(ratio: number | null): string {
  if (ratio === null) return "—";
  return `1 : ${ratio.toFixed(2)}`;
}
