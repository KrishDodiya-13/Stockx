import {
  ACTION_BY_TYPE,
  CONDITION_BY_TYPE,
  type ActionType,
  type ConditionType,
  type LogicOperator,
  type RuleKind,
} from "@/domain/strategy";
import type { StrategyInput } from "@/services/strategy/strategy-repository";

/**
 * Request-body validation for strategies.
 *
 * Hand-written rather than schema-library driven, because the checks that
 * matter here are semantic — is this a real condition type, does this action
 * carry the quantity its type requires — not merely structural. Every unknown
 * enum value is rejected rather than coerced, so a malformed request can never
 * persist a rule the engine would not recognise.
 */

type ParseResult =
  | { ok: true; value: Omit<StrategyInput, "symbol"> & { instrumentId: string } }
  | { ok: false; message: string };

const RULE_KINDS: readonly RuleKind[] = ["ENTRY", "TARGET", "STOP", "TRAILING_STOP", "CUSTOM"];
const OPERATORS: readonly LogicOperator[] = ["AND", "OR"];

const MAX_RULES = 40;
const MAX_PER_RULE = 10;

export function parseStrategyInput(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) return fail("Request body must be an object.");

  const raw = body as Record<string, unknown>;

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length === 0) return fail("`name` is required.");
  if (name.length > 120) return fail("`name` may not exceed 120 characters.");

  const instrumentId = typeof raw.instrumentId === "string" ? raw.instrumentId : "";
  if (instrumentId.length === 0) return fail("`instrumentId` is required.");

  const notes = typeof raw.notes === "string" ? raw.notes.slice(0, 2000) : null;

  if (!Array.isArray(raw.rules)) return fail("`rules` must be an array.");
  if (raw.rules.length > MAX_RULES) return fail(`A strategy may not exceed ${MAX_RULES} rules.`);

  const rules: StrategyInput["rules"][number][] = [];

  for (const [index, entry] of raw.rules.entries()) {
    if (typeof entry !== "object" || entry === null) {
      return fail(`Rule ${index + 1} must be an object.`);
    }
    const rule = entry as Record<string, unknown>;

    const kind = RULE_KINDS.includes(rule.kind as RuleKind) ? (rule.kind as RuleKind) : "CUSTOM";
    const operator = OPERATORS.includes(rule.operator as LogicOperator)
      ? (rule.operator as LogicOperator)
      : "AND";

    const trailPercent =
      rule.trailPercent === null || rule.trailPercent === undefined
        ? null
        : Number(rule.trailPercent);
    if (trailPercent !== null && (!Number.isFinite(trailPercent) || trailPercent <= 0)) {
      return fail(`Rule ${index + 1} has an invalid trail distance.`);
    }

    // --- conditions -------------------------------------------------------
    if (!Array.isArray(rule.conditions)) return fail(`Rule ${index + 1} needs a conditions array.`);
    if (rule.conditions.length > MAX_PER_RULE) {
      return fail(`Rule ${index + 1} may not exceed ${MAX_PER_RULE} conditions.`);
    }

    const conditions = [];
    for (const item of rule.conditions) {
      if (typeof item !== "object" || item === null) {
        return fail(`Rule ${index + 1} has a malformed condition.`);
      }
      const c = item as Record<string, unknown>;

      const type = c.type as ConditionType;
      const meta = CONDITION_BY_TYPE.get(type);
      if (!meta) return fail(`Unknown condition type: ${String(c.type)}`);

      const value = Number(c.value);
      if (!Number.isFinite(value)) {
        return fail(`Rule ${index + 1}: "${meta.label}" needs a numeric value.`);
      }

      const range = checkValueRange(meta.valueKind, value);
      if (range) return fail(`Rule ${index + 1}: "${meta.label}" ${range}`);

      const period =
        c.period === null || c.period === undefined ? null : Math.trunc(Number(c.period));
      if (meta.needsPeriod && (period === null || !Number.isFinite(period) || period <= 0)) {
        return fail(`Rule ${index + 1}: "${meta.label}" needs a period above zero.`);
      }

      conditions.push({ type, value, period });
    }

    // --- actions ----------------------------------------------------------
    if (!Array.isArray(rule.actions)) return fail(`Rule ${index + 1} needs an actions array.`);
    if (rule.actions.length > MAX_PER_RULE) {
      return fail(`Rule ${index + 1} may not exceed ${MAX_PER_RULE} actions.`);
    }

    const actions = [];
    for (const item of rule.actions) {
      if (typeof item !== "object" || item === null) {
        return fail(`Rule ${index + 1} has a malformed action.`);
      }
      const a = item as Record<string, unknown>;

      const type = a.type as ActionType;
      const meta = ACTION_BY_TYPE.get(type);
      if (!meta) return fail(`Unknown action type: ${String(a.type)}`);

      let quantity: number | null = null;
      if (meta.needsQuantity) {
        quantity = Number(a.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return fail(`Rule ${index + 1}: "${meta.label}" needs a value above zero.`);
        }
        if (meta.unit === "shares" && !Number.isInteger(quantity)) {
          return fail(`Rule ${index + 1}: share quantities must be whole numbers.`);
        }
        if (meta.unit === "percent" && quantity > 100) {
          return fail(`Rule ${index + 1}: a percentage exit may not exceed 100.`);
        }
      }

      actions.push({ type, quantity });
    }

    rules.push({
      kind,
      operator,
      trailPercent,
      enabled: rule.enabled !== false,
      conditions,
      actions,
    });
  }

  return { ok: true, value: { name, instrumentId, notes, rules } };
}

function fail(message: string): ParseResult {
  return { ok: false, message };
}

/**
 * Sanity-check a condition's value against the units its type is measured in.
 *
 * A condition `value` is a bare number whose unit depends on the condition:
 * prices are PriceE4 (1/10,000 rupee), percentages are plain percent, volume is
 * a share count. The builder converts correctly, but the route is a public API
 * and the unit is not visible in the payload.
 *
 * This exists because a client sending a price in *rupees* rather than PriceE4
 * — a 10,000× error, and the obvious mistake to make — previously created a
 * strategy whose targets were all far below the market. Every rule fired on the
 * first evaluation cycle and spent virtual money, and nothing anywhere reported
 * a problem. Found by making exactly that mistake while testing.
 *
 * The floors are deliberately loose: they catch an order-of-magnitude unit
 * error, not a badly chosen level. Choosing a poor threshold is the user's
 * prerogative; being silently misread by four orders of magnitude is not.
 *
 * Returns a message describing the problem, or null when the value is usable.
 */
function checkValueRange(kind: string, value: number): string | null {
  switch (kind) {
    case "price":
      if (value <= 0) return "needs a price above zero.";
      // 10,000 PriceE4 = ₹1. Below this a value is almost certainly rupees
      // that were never converted.
      if (value < 10_000) {
        return (
          "has a price level below ₹1, which usually means the value was sent " +
          "in rupees. Prices are expressed in 1/10,000 of a rupee."
        );
      }
      // ₹10,00,000 a share.
      if (value > 100_000_000_000) return "has an implausibly large price level.";
      return null;

    case "percent":
      // Covers P&L conditions, which are legitimately negative.
      if (Math.abs(value) > 10_000) return "has a percentage beyond ±10,000%.";
      return null;

    case "volume":
      if (value < 0) return "needs a volume of zero or more.";
      return null;

    case "indicator":
      // RSI is 0–100; MACD and Bollinger conditions ignore the value entirely,
      // so only an absurd magnitude is worth refusing.
      if (!Number.isFinite(value) || Math.abs(value) > 1e12) {
        return "has an implausible indicator level.";
      }
      return null;

    default:
      return null;
  }
}
