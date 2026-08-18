/**
 * Execution decisions, without a database.
 *
 * The runner in `strategy-runner.ts` does the I/O — reading quotes, placing
 * orders, writing logs. Everything it *decides* lives here, pure, so the rules
 * that matter most (fire once, complete when finished, ratchet the high-water
 * mark) can be tested directly rather than inferred from integration behaviour.
 */

import type { MarketContext, Rule, Strategy } from "@/domain/strategy";
import { type PriceE4 } from "@/lib/money";
import { planActions, type ActionIntent } from "@/services/strategy/strategy-engine";

export interface RunnerDecision {
  /** Intents to attempt, in order. */
  readonly intents: readonly ActionIntent[];
  /** New high-water price, or the existing one if unchanged. */
  readonly highWaterPrice: PriceE4 | null;
  /** True when the strategy has nothing left to do. */
  readonly shouldComplete: boolean;
  readonly completionReason: string | null;
}

/**
 * The high-water mark for trailing stops.
 *
 * Only ever moves up, and only while a position is open. Letting it fall with
 * the price would turn a trailing stop into a stop that follows the market
 * down and never protects anything; resetting it while flat stops a new
 * position inheriting the previous one's peak.
 */
export function nextHighWater(
  current: PriceE4 | null,
  price: PriceE4,
  positionQuantity: number,
): PriceE4 | null {
  if (positionQuantity <= 0) return null;
  if (current === null) return price;
  return price > current ? price : current;
}

/**
 * Has this strategy finished?
 *
 * A strategy completes when every enabled rule has fired *and* it is not
 * holding anything. Both halves matter: rules-all-fired while still holding
 * shares means the exits partially filled and the position is still live, and
 * flat-with-rules-remaining means it simply has not entered yet.
 */
export function evaluateCompletion(
  rules: readonly Rule[],
  firedRuleIds: ReadonlySet<string>,
  positionQuantity: number,
): { complete: boolean; reason: string | null } {
  const enabled = rules.filter((rule) => rule.enabled);
  if (enabled.length === 0) return { complete: false, reason: null };

  const allFired = enabled.every((rule) => firedRuleIds.has(rule.id));

  if (allFired && positionQuantity <= 0) {
    return { complete: true, reason: "All rules have fired and the position is closed." };
  }

  /*
    A strategy that has closed its position and has no remaining rule capable
    of buying is also finished — the exits are spent and it can never open
    another position, so leaving it ACTIVE would be misleading.
  */
  if (positionQuantity <= 0) {
    const canStillBuy = enabled.some(
      (rule) => !firedRuleIds.has(rule.id) && rule.actions.some((a) => a.type === "BUY"),
    );
    const hasEverBought = enabled.some(
      (rule) => firedRuleIds.has(rule.id) && rule.actions.some((a) => a.type === "BUY"),
    );

    if (hasEverBought && !canStillBuy) {
      return { complete: true, reason: "The position is closed and no entry rule remains." };
    }
  }

  return { complete: false, reason: null };
}

/**
 * Decide what a single evaluation pass should do.
 *
 * Pure: given the strategy, what has already fired, and the market right now,
 * produce the intents to attempt and the resulting bookkeeping.
 */
export function decideRun(
  strategy: Strategy,
  context: MarketContext,
  firedRuleIds: ReadonlySet<string>,
): RunnerDecision {
  const highWaterPrice = nextHighWater(
    context.highWaterPrice,
    context.price,
    context.positionQuantity,
  );

  // Trailing stops measure against the updated high-water mark, so evaluate
  // with it rather than with the stale value the caller passed in.
  const effectiveContext: MarketContext = { ...context, highWaterPrice };

  const intents = planActions(strategy, effectiveContext, firedRuleIds);

  const { complete, reason } = evaluateCompletion(
    strategy.rules,
    firedRuleIds,
    context.positionQuantity,
  );

  return {
    intents,
    highWaterPrice,
    // Never complete in the same pass that still has work to do.
    shouldComplete: complete && intents.length === 0,
    completionReason: complete && intents.length === 0 ? reason : null,
  };
}
