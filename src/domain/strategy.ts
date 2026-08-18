/**
 * Strategy domain model.
 *
 * A strategy is an ordered list of rules. Each rule is:
 *
 *     IF  <conditions joined by AND/OR>  THEN  <actions>
 *
 * Order matters and is the execution order — entry first, then targets in the
 * sequence the user arranged them, then protective stops. That is why the
 * builder is a stack of blocks rather than a free-floating node graph: in a
 * trading plan, "what happens first" is the most important fact on screen, and
 * a graph makes it the hardest thing to read.
 *
 * Nothing in this file executes anything. The engine evaluates rules and
 * *proposes* actions; turning a proposal into an order is Phase 6's job.
 */

import type { Paise, PriceE4 } from "@/lib/money";

// --- conditions ------------------------------------------------------------

export type ConditionType =
  | "PRICE_ABOVE"
  | "PRICE_BELOW"
  | "PRICE_REACHES"
  | "PERCENT_INCREASE"
  | "PERCENT_DECREASE"
  | "VOLUME_ABOVE"
  | "RSI_ABOVE"
  | "RSI_BELOW"
  | "MACD_CROSSES_ABOVE"
  | "MACD_CROSSES_BELOW"
  | "PRICE_ABOVE_MA"
  | "PRICE_BELOW_MA"
  | "BOLLINGER_UPPER_BREAK"
  | "BOLLINGER_LOWER_BREAK"
  | "PORTFOLIO_PNL_ABOVE"
  | "PORTFOLIO_PNL_BELOW"
  | "POSITION_PNL_ABOVE"
  | "POSITION_PNL_BELOW";

/** How a condition's `value` should be read and edited. */
export type ValueKind = "price" | "percent" | "volume" | "indicator" | "money";

export interface ConditionMeta {
  readonly type: ConditionType;
  readonly label: string;
  readonly valueKind: ValueKind;
  /** Some conditions need a look-back period (RSI 14, MA 50). */
  readonly needsPeriod: boolean;
  readonly defaultPeriod?: number;
  readonly group: "Price" | "Movement" | "Volume" | "Indicator" | "P&L";
  /** Shown in the builder so the rule reads as a sentence. */
  readonly hint: string;
}

export const CONDITIONS: readonly ConditionMeta[] = [
  { type: "PRICE_ABOVE", label: "Price is above", valueKind: "price", needsPeriod: false, group: "Price", hint: "Last traded price rises above the level" },
  { type: "PRICE_BELOW", label: "Price is below", valueKind: "price", needsPeriod: false, group: "Price", hint: "Last traded price falls below the level" },
  { type: "PRICE_REACHES", label: "Price reaches", valueKind: "price", needsPeriod: false, group: "Price", hint: "Price touches the level from either direction" },
  { type: "PERCENT_INCREASE", label: "Rises by", valueKind: "percent", needsPeriod: false, group: "Movement", hint: "Percentage gain from the previous close" },
  { type: "PERCENT_DECREASE", label: "Falls by", valueKind: "percent", needsPeriod: false, group: "Movement", hint: "Percentage loss from the previous close" },
  { type: "VOLUME_ABOVE", label: "Volume is above", valueKind: "volume", needsPeriod: false, group: "Volume", hint: "Session volume exceeds the figure" },
  { type: "RSI_ABOVE", label: "RSI is above", valueKind: "indicator", needsPeriod: true, defaultPeriod: 14, group: "Indicator", hint: "Relative Strength Index above the level" },
  { type: "RSI_BELOW", label: "RSI is below", valueKind: "indicator", needsPeriod: true, defaultPeriod: 14, group: "Indicator", hint: "Relative Strength Index below the level" },
  { type: "MACD_CROSSES_ABOVE", label: "MACD crosses above signal", valueKind: "indicator", needsPeriod: false, group: "Indicator", hint: "MACD line crosses up through its signal line" },
  { type: "MACD_CROSSES_BELOW", label: "MACD crosses below signal", valueKind: "indicator", needsPeriod: false, group: "Indicator", hint: "MACD line crosses down through its signal line" },
  { type: "PRICE_ABOVE_MA", label: "Price is above MA", valueKind: "indicator", needsPeriod: true, defaultPeriod: 50, group: "Indicator", hint: "Price trades above its moving average" },
  { type: "PRICE_BELOW_MA", label: "Price is below MA", valueKind: "indicator", needsPeriod: true, defaultPeriod: 50, group: "Indicator", hint: "Price trades below its moving average" },
  { type: "BOLLINGER_UPPER_BREAK", label: "Breaks upper Bollinger band", valueKind: "indicator", needsPeriod: true, defaultPeriod: 20, group: "Indicator", hint: "Price closes above the upper band" },
  { type: "BOLLINGER_LOWER_BREAK", label: "Breaks lower Bollinger band", valueKind: "indicator", needsPeriod: true, defaultPeriod: 20, group: "Indicator", hint: "Price closes below the lower band" },
  { type: "POSITION_PNL_ABOVE", label: "Position P&L is above", valueKind: "percent", needsPeriod: false, group: "P&L", hint: "Unrealised gain on this position, in percent" },
  { type: "POSITION_PNL_BELOW", label: "Position P&L is below", valueKind: "percent", needsPeriod: false, group: "P&L", hint: "Unrealised loss on this position, in percent" },
  { type: "PORTFOLIO_PNL_ABOVE", label: "Portfolio P&L is above", valueKind: "percent", needsPeriod: false, group: "P&L", hint: "Total account P&L, in percent" },
  { type: "PORTFOLIO_PNL_BELOW", label: "Portfolio P&L is below", valueKind: "percent", needsPeriod: false, group: "P&L", hint: "Total account P&L, in percent" },
];

export const CONDITION_BY_TYPE: ReadonlyMap<ConditionType, ConditionMeta> = new Map(
  CONDITIONS.map((meta) => [meta.type, meta]),
);

export interface Condition {
  readonly id: string;
  readonly type: ConditionType;
  /**
   * The threshold. Units depend on `valueKind`:
   *   price     → PriceE4
   *   percent   → plain number (2.5 === 2.5%)
   *   volume    → share count
   *   indicator → indicator units (RSI 0–100); unused by cross conditions
   */
  readonly value: number;
  /** Look-back for indicator conditions. */
  readonly period: number | null;
}

// --- actions ---------------------------------------------------------------

export type ActionType = "BUY" | "SELL" | "SELL_PERCENT" | "SELL_ALL";

export interface ActionMeta {
  readonly type: ActionType;
  readonly label: string;
  /** Whether the action carries a quantity or percentage. */
  readonly needsQuantity: boolean;
  readonly unit: "shares" | "percent" | null;
  readonly hint: string;
}

export const ACTIONS: readonly ActionMeta[] = [
  { type: "BUY", label: "Buy", needsQuantity: true, unit: "shares", hint: "Open or add to the position" },
  { type: "SELL", label: "Sell", needsQuantity: true, unit: "shares", hint: "Reduce the position by a fixed quantity" },
  { type: "SELL_PERCENT", label: "Sell", needsQuantity: true, unit: "percent", hint: "Reduce the position by a share of what is held" },
  { type: "SELL_ALL", label: "Sell all", needsQuantity: false, unit: null, hint: "Close the position completely" },
];

export const ACTION_BY_TYPE: ReadonlyMap<ActionType, ActionMeta> = new Map(
  ACTIONS.map((meta) => [meta.type, meta]),
);

export interface Action {
  readonly id: string;
  readonly type: ActionType;
  /** Shares for BUY/SELL, percent for SELL_PERCENT, ignored for SELL_ALL. */
  readonly quantity: number | null;
}

// --- rules -----------------------------------------------------------------

export type LogicOperator = "AND" | "OR";

/**
 * What a rule is *for*. Purely descriptive — it drives grouping, ordering and
 * validation in the builder, not evaluation.
 */
export type RuleKind = "ENTRY" | "TARGET" | "STOP" | "TRAILING_STOP" | "CUSTOM";

export const RULE_KIND_LABEL: Record<RuleKind, string> = {
  ENTRY: "Entry",
  TARGET: "Target",
  STOP: "Stop loss",
  TRAILING_STOP: "Trailing stop",
  CUSTOM: "Rule",
};

export interface Rule {
  readonly id: string;
  readonly kind: RuleKind;
  /** Position in the strategy. Lower runs first. */
  readonly order: number;
  readonly conditions: readonly Condition[];
  /** How the conditions combine. Ignored when there is a single condition. */
  readonly operator: LogicOperator;
  readonly actions: readonly Action[];
  /**
   * Trailing distance in percent, for TRAILING_STOP rules. The stop follows the
   * highest price seen since entry, never downward.
   */
  readonly trailPercent: number | null;
  readonly enabled: boolean;
}

// --- strategy --------------------------------------------------------------

export type StrategyStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";

export const STRATEGY_STATUS_LABEL: Record<StrategyStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/**
 * Permitted status transitions.
 *
 * A finished strategy is immutable: COMPLETED and CANCELLED are terminal, so a
 * historical record can never be re-activated and quietly rewritten. Activating
 * requires passing validation, which the API enforces.
 */
export const STATUS_TRANSITIONS: Record<StrategyStatus, readonly StrategyStatus[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAUSED", "COMPLETED", "CANCELLED"],
  PAUSED: ["ACTIVE", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: StrategyStatus, to: StrategyStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: StrategyStatus): boolean {
  return STATUS_TRANSITIONS[status].length === 0;
}

/** A strategy may only be edited before it has ever run. */
export function isEditable(status: StrategyStatus): boolean {
  return status === "DRAFT" || status === "PAUSED";
}

export interface Strategy {
  readonly id: string;
  readonly name: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly status: StrategyStatus;
  readonly rules: readonly Rule[];
  readonly notes: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activatedAt: number | null;
  readonly completedAt: number | null;
}

// --- presentation ----------------------------------------------------------

/**
 * Render a rule as a single readable line: "IF price above ₹102 THEN sell 50%".
 *
 * Lives in the domain rather than in a component because the list view, the
 * builder summary and (later) the execution log all need the same phrasing —
 * three renderings of the same rule that disagree would be worse than none.
 */
export function describeStrategyLine(rule: Rule): string {
  const conditions =
    rule.kind === "TRAILING_STOP" && rule.trailPercent !== null
      ? `price falls ${rule.trailPercent}% below its high`
      : rule.conditions
          .map((condition) => describeCondition(condition))
          .join(rule.operator === "OR" ? " or " : " and ");

  const actions = rule.actions.map((action) => describeAction(action)).join(" and ");

  const prefix = rule.enabled ? "" : "(disabled) ";
  return `${prefix}IF ${conditions || "—"} THEN ${actions || "—"}`;
}

export function describeCondition(condition: Condition): string {
  const meta = CONDITION_BY_TYPE.get(condition.type);
  if (!meta) return condition.type;

  const label = meta.label.toLowerCase();

  switch (meta.valueKind) {
    case "price":
      return `${label} ₹${(condition.value / 10_000).toFixed(2)}`;
    case "percent":
      return `${label} ${condition.value}%`;
    case "volume":
      return `${label} ${condition.value.toLocaleString("en-IN")}`;
    case "indicator":
      return meta.needsPeriod
        ? `${label} ${condition.value} (${condition.period ?? "?"})`
        : label;
    default:
      return `${label} ${condition.value}`;
  }
}

export function describeAction(action: Action): string {
  const meta = ACTION_BY_TYPE.get(action.type);
  if (!meta) return action.type;

  switch (action.type) {
    case "SELL_ALL":
      return "sell all";
    case "SELL_PERCENT":
      return `sell ${action.quantity ?? 0}%`;
    default:
      return `${meta.label.toLowerCase()} ${action.quantity ?? 0}`;
  }
}

// --- evaluation context ----------------------------------------------------

/**
 * Everything a rule can be evaluated against, at one instant.
 *
 * Indicator values are supplied rather than computed here so the engine stays
 * pure and synchronous: the caller decides where the candles come from, which
 * is what lets the same engine serve live evaluation, the backtester and the
 * Time Machine without change.
 */
export interface MarketContext {
  readonly instrumentId: string;
  readonly price: PriceE4;
  /**
   * Previous close, or null when the market-data provider did not supply one.
   *
   * Nullable for the same reason the indicator fields are: a condition that
   * needs a value the feed has not given cannot be true, and must not be
   * evaluated against a stand-in. A strategy that fires because an unknown
   * close was read as zero, or as the current price, has traded on nothing.
   */
  readonly previousClose: PriceE4 | null;
  readonly volume: number;
  /** Percentage change from the previous close. Null when that is unknown. */
  readonly changePercent: number | null;

  readonly rsi: number | null;
  readonly macd: number | null;
  readonly macdSignal: number | null;
  /** Previous bar's MACD and signal, needed to detect a cross rather than a state. */
  readonly previousMacd: number | null;
  readonly previousMacdSignal: number | null;
  readonly movingAverage: number | null;
  readonly bollingerUpper: number | null;
  readonly bollingerLower: number | null;

  /** Unrealised P&L on the open position in this instrument, in percent. */
  readonly positionPnlPercent: number | null;
  /** Total account P&L, in percent. */
  readonly portfolioPnlPercent: number | null;

  /** Shares currently held. Zero when flat. */
  readonly positionQuantity: number;
  readonly availableCash: Paise;
  /** Highest price seen since the position opened, for trailing stops. */
  readonly highWaterPrice: PriceE4 | null;
}
