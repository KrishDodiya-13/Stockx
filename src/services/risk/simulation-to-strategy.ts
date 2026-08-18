/**
 * Turning a risk simulation into a strategy.
 *
 * A simulation is a single planned trade: enter here, take profit there, cut
 * the loss at this level. That maps exactly onto the strategy model's ordered
 * rules, so this converts one into the other rather than asking the user to
 * retype a plan they have already specified.
 *
 * Pure and deterministic — no ids from a database, no clock. The caller
 * persists whatever this returns.
 */

import type { ActionType, ConditionType, RuleKind } from "@/domain/strategy";
import type { PriceE4 } from "@/lib/money";

export interface SimulationInput {
  readonly name: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly entryPrice: PriceE4;
  readonly quantity: number;
  readonly targetPrice: PriceE4 | null;
  readonly stopPrice: PriceE4 | null;
}

/** Shape the strategy API accepts, so the result can be POSTed directly. */
export interface StrategyRuleDraft {
  readonly kind: RuleKind;
  readonly operator: "AND";
  readonly trailPercent: number | null;
  readonly enabled: boolean;
  readonly conditions: readonly {
    readonly type: ConditionType;
    readonly value: number;
    readonly period: number | null;
  }[];
  readonly actions: readonly { readonly type: ActionType; readonly quantity: number | null }[];
}

export interface StrategyDraftPayload {
  readonly name: string;
  readonly instrumentId: string;
  readonly notes: string;
  readonly rules: readonly StrategyRuleDraft[];
}

/**
 * Build the rule stack a simulation implies.
 *
 * Entry, then target, then stop — in that order, because the strategy engine
 * runs rules top to bottom and a stop that sat above the target would close the
 * position before the target could ever be evaluated.
 *
 * The exit sells the full position rather than a partial: a simulation
 * describes one entry and one exit, and inventing intermediate targets the user
 * never specified would put words in their mouth. Partial exits are added in
 * the builder, where they can be seen.
 */
export function simulationToStrategy(simulation: SimulationInput): StrategyDraftPayload {
  const rules: StrategyRuleDraft[] = [];

  rules.push({
    kind: "ENTRY",
    operator: "AND",
    trailPercent: null,
    enabled: true,
    conditions: [{ type: "PRICE_REACHES", value: simulation.entryPrice, period: null }],
    actions: [{ type: "BUY", quantity: simulation.quantity }],
  });

  if (simulation.targetPrice !== null) {
    rules.push({
      kind: "TARGET",
      operator: "AND",
      trailPercent: null,
      enabled: true,
      conditions: [{ type: "PRICE_ABOVE", value: simulation.targetPrice, period: null }],
      actions: [{ type: "SELL_ALL", quantity: null }],
    });
  }

  if (simulation.stopPrice !== null) {
    rules.push({
      kind: "STOP",
      operator: "AND",
      trailPercent: null,
      enabled: true,
      conditions: [{ type: "PRICE_BELOW", value: simulation.stopPrice, period: null }],
      actions: [{ type: "SELL_ALL", quantity: null }],
    });
  }

  return {
    name: simulation.name.trim().length > 0 ? simulation.name.trim() : `${simulation.symbol} plan`,
    instrumentId: simulation.instrumentId,
    notes: "Created from a risk simulation.",
    rules,
  };
}

/**
 * Whether a simulation is complete enough to become a strategy.
 *
 * A strategy with no entry can never open a position, so an entry price and a
 * quantity are the minimum. Targets and stops are optional here — the strategy
 * validator will warn about a missing stop separately, which is the right place
 * for that judgement.
 */
export function canConvertToStrategy(simulation: {
  entryPrice: PriceE4 | null;
  quantity: number;
}): boolean {
  return simulation.entryPrice !== null && simulation.entryPrice > 0 && simulation.quantity > 0;
}
