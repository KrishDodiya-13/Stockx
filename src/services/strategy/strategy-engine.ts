/**
 * Strategy engine.
 *
 * Pure and synchronous: given a strategy and a market context, decide which
 * rules fire and what they *propose*. It reads no clock, touches no database
 * and places no orders.
 *
 * That last point is the whole design. `planActions` returns `ActionIntent`
 * objects describing what should happen; converting an intent into a real
 * order — sizing it against cash, validating it, persisting it — is the paper
 * trading engine's job, and is deliberately not wired up here. Phase 6 supplies
 * the loop that feeds contexts in and routes intents out.
 */

import type {
  Action,
  Condition,
  MarketContext,
  Rule,
  Strategy,
} from "@/domain/strategy";
import { CONDITION_BY_TYPE } from "@/domain/strategy";
import { priceToRupees, type PriceE4 } from "@/lib/money";

// --- condition evaluation --------------------------------------------------

/**
 * Evaluate one condition.
 *
 * Returns `false` — never throws — when the data a condition needs is missing.
 * An indicator that has not warmed up yet must not fire a rule, and must not
 * take the whole strategy down either.
 */
export function evaluateCondition(condition: Condition, context: MarketContext): boolean {
  const price = priceToRupees(context.price);
  const { value } = condition;

  switch (condition.type) {
    case "PRICE_ABOVE":
      return price > priceToRupees(value as PriceE4);
    case "PRICE_BELOW":
      return price < priceToRupees(value as PriceE4);
    case "PRICE_REACHES": {
      /*
        "Reaches" is directional-agnostic, so it cannot be an equality test —
        a tick rarely lands exactly on a level. It fires when the price is
        within half a paisa of the target, or has crossed it since the previous
        close, which is what a trader means by the word.
      */
      const target = priceToRupees(value as PriceE4);
      // Without a previous close there is no "since" to cross from; only the
      // proximity half of the test can still be answered.
      const previous = context.previousClose === null ? null : priceToRupees(context.previousClose);
      const crossed =
        previous !== null &&
        ((previous < target && price >= target) || (previous > target && price <= target));
      return crossed || Math.abs(price - target) < 0.005;
    }

    case "PERCENT_INCREASE":
      return context.changePercent !== null && context.changePercent >= value;
    case "PERCENT_DECREASE":
      return context.changePercent !== null && context.changePercent <= -Math.abs(value);

    case "VOLUME_ABOVE":
      return context.volume > value;

    case "RSI_ABOVE":
      return context.rsi !== null && context.rsi > value;
    case "RSI_BELOW":
      return context.rsi !== null && context.rsi < value;

    case "MACD_CROSSES_ABOVE": {
      // A cross is a transition, not a state: it needs the previous bar too.
      const { macd, macdSignal, previousMacd, previousMacdSignal } = context;
      if (macd === null || macdSignal === null || previousMacd === null || previousMacdSignal === null) {
        return false;
      }
      return previousMacd <= previousMacdSignal && macd > macdSignal;
    }
    case "MACD_CROSSES_BELOW": {
      const { macd, macdSignal, previousMacd, previousMacdSignal } = context;
      if (macd === null || macdSignal === null || previousMacd === null || previousMacdSignal === null) {
        return false;
      }
      return previousMacd >= previousMacdSignal && macd < macdSignal;
    }

    case "PRICE_ABOVE_MA":
      return context.movingAverage !== null && price > context.movingAverage;
    case "PRICE_BELOW_MA":
      return context.movingAverage !== null && price < context.movingAverage;

    case "BOLLINGER_UPPER_BREAK":
      return context.bollingerUpper !== null && price > context.bollingerUpper;
    case "BOLLINGER_LOWER_BREAK":
      return context.bollingerLower !== null && price < context.bollingerLower;

    case "POSITION_PNL_ABOVE":
      return context.positionPnlPercent !== null && context.positionPnlPercent > value;
    case "POSITION_PNL_BELOW":
      return context.positionPnlPercent !== null && context.positionPnlPercent < value;

    case "PORTFOLIO_PNL_ABOVE":
      return context.portfolioPnlPercent !== null && context.portfolioPnlPercent > value;
    case "PORTFOLIO_PNL_BELOW":
      return context.portfolioPnlPercent !== null && context.portfolioPnlPercent < value;
  }
}

/** Evaluate a rule's conditions under its AND/OR operator. */
export function evaluateRule(rule: Rule, context: MarketContext): boolean {
  if (!rule.enabled) return false;

  /*
    Trailing stops are checked before the empty-conditions guard below.

    A trailing stop has *no* conditions by design — its trigger is the trail
    distance measured against the high-water mark, not a threshold the user
    typed. Applying the guard first made every trailing stop silently inert.
  */
  if (rule.kind === "TRAILING_STOP" && rule.trailPercent !== null) {
    return isTrailingStopHit(rule.trailPercent, context);
  }

  if (rule.conditions.length === 0) return false;

  return rule.operator === "OR"
    ? rule.conditions.some((condition) => evaluateCondition(condition, context))
    : rule.conditions.every((condition) => evaluateCondition(condition, context));
}

/**
 * Whether a trailing stop has been hit.
 *
 * The stop sits `trailPercent` below the highest price seen since the position
 * opened, and only ever ratchets upward — that is what makes it *trailing*
 * rather than a stop that drifts down with the price and never protects
 * anything.
 */
export function isTrailingStopHit(trailPercent: number, context: MarketContext): boolean {
  if (context.highWaterPrice === null || context.positionQuantity <= 0) return false;

  const high = priceToRupees(context.highWaterPrice);
  const stopLevel = high * (1 - Math.abs(trailPercent) / 100);
  return priceToRupees(context.price) <= stopLevel;
}

// --- action planning -------------------------------------------------------

/**
 * A proposed action. Not an order.
 *
 * Phase 6 turns these into orders through the existing paper trading engine,
 * which re-validates everything: an intent that would overdraw the account or
 * oversell a position is rejected there, exactly as a manual order would be.
 */
export interface ActionIntent {
  readonly ruleId: string;
  readonly ruleKind: Rule["kind"];
  readonly instrumentId: string;
  readonly side: "BUY" | "SELL";
  /** Resolved share count. Percentages are converted against the holding. */
  readonly quantity: number;
  readonly reason: string;
  readonly actionType: Action["type"];
}

/**
 * Which rules fire, and what they propose.
 *
 * Rules are evaluated in order. Quantity is resolved against the *current*
 * position as it would stand after earlier rules in the same pass, so two
 * targets that each sell 50% cannot together propose selling more than is held.
 */
export function planActions(
  strategy: Strategy,
  context: MarketContext,
  /**
   * Rules that have already fired and must not fire again.
   *
   * This is what stops a target selling the same 50 shares on every tick: once
   * price is past ₹102 the rule stays true indefinitely, so "has it already
   * run" — not "is it true" — decides whether it acts.
   */
  firedRuleIds: ReadonlySet<string> = new Set(),
): readonly ActionIntent[] {
  if (strategy.status !== "ACTIVE") return [];

  const intents: ActionIntent[] = [];
  // Tracks the position as the pass proceeds, so later rules size correctly.
  let projectedQuantity = context.positionQuantity;

  const ordered = [...strategy.rules].sort((a, b) => a.order - b.order);

  for (const rule of ordered) {
    if (firedRuleIds.has(rule.id)) continue;
    if (!evaluateRule(rule, context)) continue;

    for (const action of rule.actions) {
      const quantity = resolveQuantity(action, projectedQuantity);
      if (quantity <= 0) continue;

      const side = action.type === "BUY" ? "BUY" : "SELL";

      // Never propose selling more than the position will hold at this point.
      if (side === "SELL" && quantity > projectedQuantity) continue;

      intents.push({
        ruleId: rule.id,
        ruleKind: rule.kind,
        instrumentId: strategy.instrumentId,
        side,
        quantity,
        actionType: action.type,
        reason: describeRule(rule),
      });

      projectedQuantity += side === "BUY" ? quantity : -quantity;
    }
  }

  return intents;
}

function resolveQuantity(action: Action, heldQuantity: number): number {
  switch (action.type) {
    case "BUY":
    case "SELL":
      return Math.max(0, Math.trunc(action.quantity ?? 0));
    case "SELL_PERCENT": {
      const percent = Math.min(100, Math.max(0, action.quantity ?? 0));
      // Floor, so a percentage can never round up past the holding.
      return Math.floor((heldQuantity * percent) / 100);
    }
    case "SELL_ALL":
      return heldQuantity;
  }
}

/** Human-readable summary of why a rule fired. */
export function describeRule(rule: Rule): string {
  const parts = rule.conditions.map((condition) => {
    const meta = CONDITION_BY_TYPE.get(condition.type);
    return meta ? `${meta.label} ${formatConditionValue(condition)}`.trim() : condition.type;
  });

  if (rule.kind === "TRAILING_STOP" && rule.trailPercent !== null) {
    return `Trailing stop ${rule.trailPercent}% below the high`;
  }

  return parts.join(rule.operator === "OR" ? " or " : " and ");
}

function formatConditionValue(condition: Condition): string {
  const meta = CONDITION_BY_TYPE.get(condition.type);
  if (!meta) return String(condition.value);

  switch (meta.valueKind) {
    case "price":
      return `₹${priceToRupees(condition.value as PriceE4).toFixed(2)}`;
    case "percent":
      return `${condition.value}%`;
    case "volume":
      return condition.value.toLocaleString("en-IN");
    case "indicator":
      return meta.needsPeriod ? `${condition.value}` : "";
    default:
      return String(condition.value);
  }
}

// --- validation ------------------------------------------------------------

export type StrategyIssueCode =
  | "no-rules"
  | "no-entry"
  | "empty-conditions"
  | "empty-actions"
  | "invalid-quantity"
  | "invalid-percent"
  | "oversold"
  | "missing-period"
  | "missing-trail"
  | "sell-without-entry"
  | "no-stop";

export interface StrategyIssue {
  readonly code: StrategyIssueCode;
  readonly message: string;
  readonly severity: "error" | "warning";
  /** Which rule the issue belongs to, when it is rule-specific. */
  readonly ruleId: string | null;
}

export interface StrategyValidation {
  readonly issues: readonly StrategyIssue[];
  /** False when any error-severity issue is present. */
  readonly canActivate: boolean;
}

/**
 * Check a strategy before it is allowed to go active.
 *
 * Errors block activation; warnings do not. The distinction matters: a strategy
 * with no stop loss is unwise but legitimate, whereas one whose targets sell
 * 150% of the position is incoherent and would misbehave the moment it ran.
 */
export function validateStrategy(strategy: {
  rules: readonly Rule[];
}): StrategyValidation {
  const issues: StrategyIssue[] = [];
  const rules = strategy.rules.filter((rule) => rule.enabled);

  if (rules.length === 0) {
    issues.push({
      code: "no-rules",
      message: "This strategy has no enabled rules.",
      severity: "error",
      ruleId: null,
    });
  }

  const hasEntry = rules.some((rule) =>
    rule.actions.some((action) => action.type === "BUY"),
  );
  const hasSell = rules.some((rule) => rule.actions.some((action) => action.type !== "BUY"));

  if (!hasEntry && rules.length > 0) {
    issues.push({
      code: "no-entry",
      message: "No rule buys anything, so this strategy can never open a position.",
      severity: hasSell ? "warning" : "error",
      ruleId: null,
    });
  }

  for (const rule of rules) {
    if (rule.conditions.length === 0 && rule.kind !== "TRAILING_STOP") {
      issues.push({
        code: "empty-conditions",
        message: "A rule needs at least one condition.",
        severity: "error",
        ruleId: rule.id,
      });
    }

    if (rule.actions.length === 0) {
      issues.push({
        code: "empty-actions",
        message: "A rule needs at least one action.",
        severity: "error",
        ruleId: rule.id,
      });
    }

    if (rule.kind === "TRAILING_STOP" && (rule.trailPercent === null || rule.trailPercent <= 0)) {
      issues.push({
        code: "missing-trail",
        message: "A trailing stop needs a trail distance above zero.",
        severity: "error",
        ruleId: rule.id,
      });
    }

    for (const condition of rule.conditions) {
      const meta = CONDITION_BY_TYPE.get(condition.type);
      if (meta?.needsPeriod && (condition.period === null || condition.period <= 0)) {
        issues.push({
          code: "missing-period",
          message: `${meta.label} needs a period above zero.`,
          severity: "error",
          ruleId: rule.id,
        });
      }
    }

    for (const action of rule.actions) {
      if (action.type === "BUY" || action.type === "SELL") {
        if (!Number.isInteger(action.quantity) || (action.quantity ?? 0) <= 0) {
          issues.push({
            code: "invalid-quantity",
            message: "Quantity must be a whole number of shares above zero.",
            severity: "error",
            ruleId: rule.id,
          });
        }
      }

      if (action.type === "SELL_PERCENT") {
        const percent = action.quantity ?? 0;
        if (percent <= 0 || percent > 100) {
          issues.push({
            code: "invalid-percent",
            message: "A percentage exit must be between 1 and 100.",
            severity: "error",
            ruleId: rule.id,
          });
        }
      }
    }
  }

  /*
    Do the exits add up to more than the entry?

    Fixed-share sells are compared against total shares bought. This catches the
    common authoring mistake of buying 100 and then writing two targets that
    sell 100 each.
  */
  const totalBought = sumQuantities(rules, "BUY");
  const totalSoldFixed = sumQuantities(rules, "SELL");

  if (totalBought > 0 && totalSoldFixed > totalBought) {
    issues.push({
      code: "oversold",
      message: `Exit rules sell ${totalSoldFixed} shares but the strategy only buys ${totalBought}.`,
      severity: "error",
      ruleId: null,
    });
  }

  if (hasSell && !hasEntry) {
    issues.push({
      code: "sell-without-entry",
      message: "This strategy sells without ever buying — it relies on a position opened elsewhere.",
      severity: "warning",
      ruleId: null,
    });
  }

  const hasStop = rules.some((rule) => rule.kind === "STOP" || rule.kind === "TRAILING_STOP");
  if (hasEntry && !hasStop) {
    issues.push({
      code: "no-stop",
      message: "No stop loss is set, so the downside on this strategy is not bounded.",
      severity: "warning",
      ruleId: null,
    });
  }

  return {
    issues,
    canActivate: issues.every((issue) => issue.severity !== "error"),
  };
}

function sumQuantities(rules: readonly Rule[], type: Action["type"]): number {
  let total = 0;
  for (const rule of rules) {
    for (const action of rule.actions) {
      if (action.type === type) total += Math.max(0, Math.trunc(action.quantity ?? 0));
    }
  }
  return total;
}
