import { describe, expect, it } from "vitest";

import type { Action, Condition, MarketContext, Rule, Strategy } from "@/domain/strategy";
import { canTransition, isEditable, isTerminal } from "@/domain/strategy";
import { rupeesToPaise, rupeesToPrice } from "@/lib/money";
import {
  evaluateCondition,
  evaluateRule,
  isTrailingStopHit,
  planActions,
  validateStrategy,
} from "@/services/strategy/strategy-engine";

function context(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    instrumentId: "NSE:RELIANCE",
    price: rupeesToPrice(100),
    previousClose: rupeesToPrice(100),
    volume: 1_000_000,
    changePercent: 0,
    rsi: null,
    macd: null,
    macdSignal: null,
    previousMacd: null,
    previousMacdSignal: null,
    movingAverage: null,
    bollingerUpper: null,
    bollingerLower: null,
    positionPnlPercent: null,
    portfolioPnlPercent: null,
    positionQuantity: 0,
    availableCash: rupeesToPaise(1_000_000),
    highWaterPrice: null,
    ...overrides,
  };
}

function condition(type: Condition["type"], value: number, period: number | null = null): Condition {
  return { id: `c-${type}`, type, value, period };
}

function action(type: Action["type"], quantity: number | null = null): Action {
  return { id: `a-${type}`, type, quantity };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    kind: "CUSTOM",
    order: 0,
    conditions: [],
    operator: "AND",
    actions: [],
    trailPercent: null,
    enabled: true,
    ...overrides,
  };
}

function strategy(rules: Rule[], status: Strategy["status"] = "ACTIVE"): Strategy {
  return {
    id: "s1",
    name: "Test",
    instrumentId: "NSE:RELIANCE",
    symbol: "RELIANCE",
    status,
    rules,
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    activatedAt: null,
    completedAt: null,
  };
}

describe("price conditions", () => {
  it("fires PRICE_ABOVE only above the level", () => {
    const c = condition("PRICE_ABOVE", rupeesToPrice(100));
    expect(evaluateCondition(c, context({ price: rupeesToPrice(101) }))).toBe(true);
    expect(evaluateCondition(c, context({ price: rupeesToPrice(100) }))).toBe(false);
    expect(evaluateCondition(c, context({ price: rupeesToPrice(99) }))).toBe(false);
  });

  it("fires PRICE_BELOW only below the level", () => {
    const c = condition("PRICE_BELOW", rupeesToPrice(100));
    expect(evaluateCondition(c, context({ price: rupeesToPrice(99) }))).toBe(true);
    expect(evaluateCondition(c, context({ price: rupeesToPrice(101) }))).toBe(false);
  });

  it("fires PRICE_REACHES on a cross from either direction", () => {
    const c = condition("PRICE_REACHES", rupeesToPrice(100));
    // Rising through the level.
    expect(
      evaluateCondition(c, context({ previousClose: rupeesToPrice(98), price: rupeesToPrice(101) })),
    ).toBe(true);
    // Falling through it.
    expect(
      evaluateCondition(c, context({ previousClose: rupeesToPrice(103), price: rupeesToPrice(99) })),
    ).toBe(true);
    // Nowhere near it.
    expect(
      evaluateCondition(c, context({ previousClose: rupeesToPrice(80), price: rupeesToPrice(85) })),
    ).toBe(false);
  });

  it("reads percentage moves against the previous close", () => {
    expect(evaluateCondition(condition("PERCENT_INCREASE", 2), context({ changePercent: 2.5 }))).toBe(true);
    expect(evaluateCondition(condition("PERCENT_INCREASE", 2), context({ changePercent: 1.5 }))).toBe(false);
    expect(evaluateCondition(condition("PERCENT_DECREASE", 2), context({ changePercent: -2.5 }))).toBe(true);
    expect(evaluateCondition(condition("PERCENT_DECREASE", 2), context({ changePercent: -1 }))).toBe(false);
  });
});

describe("indicator conditions", () => {
  it("never fires when the indicator has not warmed up", () => {
    // Null indicators must be inert, not throw and not count as satisfied.
    expect(evaluateCondition(condition("RSI_ABOVE", 70), context({ rsi: null }))).toBe(false);
    expect(evaluateCondition(condition("PRICE_ABOVE_MA", 0, 50), context({ movingAverage: null }))).toBe(false);
    expect(evaluateCondition(condition("BOLLINGER_UPPER_BREAK", 0, 20), context({ bollingerUpper: null }))).toBe(false);
  });

  it("compares RSI against the threshold", () => {
    expect(evaluateCondition(condition("RSI_ABOVE", 70), context({ rsi: 75 }))).toBe(true);
    expect(evaluateCondition(condition("RSI_ABOVE", 70), context({ rsi: 65 }))).toBe(false);
    expect(evaluateCondition(condition("RSI_BELOW", 30), context({ rsi: 25 }))).toBe(true);
  });

  it("detects a MACD cross rather than a state", () => {
    const c = condition("MACD_CROSSES_ABOVE", 0);

    // Genuine cross: was below, now above.
    expect(
      evaluateCondition(
        c,
        context({ previousMacd: -1, previousMacdSignal: 0, macd: 1, macdSignal: 0 }),
      ),
    ).toBe(true);

    // Already above on both bars — a state, not a cross. Must not fire.
    expect(
      evaluateCondition(
        c,
        context({ previousMacd: 2, previousMacdSignal: 0, macd: 3, macdSignal: 0 }),
      ),
    ).toBe(false);
  });

  it("detects a downward MACD cross", () => {
    expect(
      evaluateCondition(
        condition("MACD_CROSSES_BELOW", 0),
        context({ previousMacd: 1, previousMacdSignal: 0, macd: -1, macdSignal: 0 }),
      ),
    ).toBe(true);
  });

  it("breaks Bollinger bands only beyond them", () => {
    expect(
      evaluateCondition(
        condition("BOLLINGER_UPPER_BREAK", 0, 20),
        context({ price: rupeesToPrice(110), bollingerUpper: 105 }),
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        condition("BOLLINGER_UPPER_BREAK", 0, 20),
        context({ price: rupeesToPrice(100), bollingerUpper: 105 }),
      ),
    ).toBe(false);
  });
});

describe("P&L conditions", () => {
  it("uses position P&L when present", () => {
    expect(
      evaluateCondition(condition("POSITION_PNL_ABOVE", 5), context({ positionPnlPercent: 7 })),
    ).toBe(true);
    expect(
      evaluateCondition(condition("POSITION_PNL_BELOW", -3), context({ positionPnlPercent: -5 })),
    ).toBe(true);
  });

  it("is inert with no open position", () => {
    expect(
      evaluateCondition(condition("POSITION_PNL_ABOVE", 5), context({ positionPnlPercent: null })),
    ).toBe(false);
  });
});

describe("AND / OR", () => {
  const above = condition("PRICE_ABOVE", rupeesToPrice(90));
  const rsiHigh = condition("RSI_ABOVE", 70);

  it("requires every condition under AND", () => {
    const r = rule({ conditions: [above, rsiHigh], operator: "AND", actions: [action("BUY", 1)] });
    expect(evaluateRule(r, context({ price: rupeesToPrice(100), rsi: 75 }))).toBe(true);
    expect(evaluateRule(r, context({ price: rupeesToPrice(100), rsi: 50 }))).toBe(false);
  });

  it("requires only one condition under OR", () => {
    const r = rule({ conditions: [above, rsiHigh], operator: "OR", actions: [action("BUY", 1)] });
    expect(evaluateRule(r, context({ price: rupeesToPrice(100), rsi: 50 }))).toBe(true);
    expect(evaluateRule(r, context({ price: rupeesToPrice(80), rsi: 50 }))).toBe(false);
  });

  it("never fires a disabled rule", () => {
    const r = rule({ conditions: [above], actions: [action("BUY", 1)], enabled: false });
    expect(evaluateRule(r, context({ price: rupeesToPrice(100) }))).toBe(false);
  });

  it("never fires a rule with no conditions", () => {
    expect(evaluateRule(rule({ actions: [action("BUY", 1)] }), context())).toBe(false);
  });
});

describe("trailing stop", () => {
  it("triggers when price falls the trail distance below the high", () => {
    const ctx = context({
      positionQuantity: 100,
      highWaterPrice: rupeesToPrice(120),
      price: rupeesToPrice(114), // −5% from the high
    });
    expect(isTrailingStopHit(5, ctx)).toBe(true);
  });

  it("does not trigger while price holds within the trail", () => {
    const ctx = context({
      positionQuantity: 100,
      highWaterPrice: rupeesToPrice(120),
      price: rupeesToPrice(117), // −2.5%
    });
    expect(isTrailingStopHit(5, ctx)).toBe(false);
  });

  it("ratchets with the high rather than the entry", () => {
    // Entry at 100, high 150, now 143 — still inside a 5% trail of the high,
    // even though the price is far above entry.
    const ctx = context({
      positionQuantity: 100,
      highWaterPrice: rupeesToPrice(150),
      price: rupeesToPrice(143),
    });
    expect(isTrailingStopHit(5, ctx)).toBe(false);
    expect(isTrailingStopHit(4, ctx)).toBe(true);
  });

  it("is inert with no position", () => {
    expect(
      isTrailingStopHit(5, context({ positionQuantity: 0, highWaterPrice: rupeesToPrice(120) })),
    ).toBe(false);
  });
});

describe("planActions", () => {
  it("proposes nothing unless the strategy is active", () => {
    const rules = [
      rule({ conditions: [condition("PRICE_ABOVE", rupeesToPrice(90))], actions: [action("BUY", 100)] }),
    ];
    for (const status of ["DRAFT", "PAUSED", "COMPLETED", "CANCELLED"] as const) {
      expect(planActions(strategy(rules, status), context({ price: rupeesToPrice(100) }))).toHaveLength(0);
    }
  });

  it("resolves the specification's worked example in order", () => {
    // ENTRY ₹100 BUY 100 / TARGET ₹102 SELL 50 / TARGET ₹105 SELL 50 / STOP ₹97 SELL ALL
    const rules = [
      rule({ id: "entry", kind: "ENTRY", order: 0, conditions: [condition("PRICE_ABOVE", rupeesToPrice(99))], actions: [action("BUY", 100)] }),
      rule({ id: "t1", kind: "TARGET", order: 1, conditions: [condition("PRICE_ABOVE", rupeesToPrice(102))], actions: [action("SELL", 50)] }),
      rule({ id: "t2", kind: "TARGET", order: 2, conditions: [condition("PRICE_ABOVE", rupeesToPrice(105))], actions: [action("SELL", 50)] }),
    ];

    // At ₹103 only the entry and the first target qualify.
    const intents = planActions(strategy(rules), context({ price: rupeesToPrice(103) }));
    expect(intents.map((i) => `${i.side}:${i.quantity}`)).toEqual(["BUY:100", "SELL:50"]);
  });

  it("sizes a percentage exit against what is actually held", () => {
    const rules = [
      rule({ id: "x", kind: "TARGET", conditions: [condition("PRICE_ABOVE", rupeesToPrice(90))], actions: [action("SELL_PERCENT", 25)] }),
    ];

    const intents = planActions(
      strategy(rules),
      context({ price: rupeesToPrice(100), positionQuantity: 80 }),
    );
    expect(intents[0]?.quantity).toBe(20);
  });

  it("floors a percentage exit so it can never exceed the holding", () => {
    const rules = [
      rule({ conditions: [condition("PRICE_ABOVE", rupeesToPrice(90))], actions: [action("SELL_PERCENT", 100)] }),
    ];
    const intents = planActions(
      strategy(rules),
      context({ price: rupeesToPrice(100), positionQuantity: 7 }),
    );
    expect(intents[0]?.quantity).toBe(7);
  });

  it("resolves SELL_ALL to the whole position", () => {
    const rules = [
      rule({ kind: "STOP", conditions: [condition("PRICE_BELOW", rupeesToPrice(97))], actions: [action("SELL_ALL")] }),
    ];
    const intents = planActions(
      strategy(rules),
      context({ price: rupeesToPrice(96), positionQuantity: 250 }),
    );
    expect(intents[0]?.quantity).toBe(250);
  });

  it("never proposes selling more than the position will hold", () => {
    // Two rules each selling 60 from a position of 100 — the second must be
    // trimmed away rather than overselling.
    const rules = [
      rule({ id: "a", order: 0, conditions: [condition("PRICE_ABOVE", rupeesToPrice(90))], actions: [action("SELL", 60)] }),
      rule({ id: "b", order: 1, conditions: [condition("PRICE_ABOVE", rupeesToPrice(90))], actions: [action("SELL", 60)] }),
    ];

    const intents = planActions(
      strategy(rules),
      context({ price: rupeesToPrice(100), positionQuantity: 100 }),
    );

    const sold = intents.reduce((total, intent) => total + intent.quantity, 0);
    expect(sold).toBeLessThanOrEqual(100);
    expect(intents).toHaveLength(1);
  });

  it("respects rule order regardless of array order", () => {
    const rules = [
      rule({ id: "second", order: 5, conditions: [condition("PRICE_ABOVE", rupeesToPrice(90))], actions: [action("SELL", 10)] }),
      rule({ id: "first", order: 1, conditions: [condition("PRICE_ABOVE", rupeesToPrice(90))], actions: [action("BUY", 100)] }),
    ];

    const intents = planActions(strategy(rules), context({ price: rupeesToPrice(100) }));
    expect(intents[0]?.ruleId).toBe("first");
    expect(intents[1]?.ruleId).toBe("second");
  });

  it("returns intents, never orders", () => {
    const rules = [
      rule({ conditions: [condition("PRICE_ABOVE", rupeesToPrice(90))], actions: [action("BUY", 10)] }),
    ];
    const [intent] = planActions(strategy(rules), context({ price: rupeesToPrice(100) }));

    // The shape is a proposal: no price, no order id, no account.
    expect(intent).toMatchObject({ side: "BUY", quantity: 10 });
    expect(intent).not.toHaveProperty("orderId");
    expect(intent).not.toHaveProperty("price");
  });
});

describe("validateStrategy", () => {
  it("rejects a strategy with no rules", () => {
    const result = validateStrategy({ rules: [] });
    expect(result.canActivate).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("no-rules");
  });

  it("rejects exits that sell more than the strategy buys", () => {
    const result = validateStrategy({
      rules: [
        rule({ id: "e", actions: [action("BUY", 100)], conditions: [condition("PRICE_ABOVE", 1)] }),
        rule({ id: "t1", actions: [action("SELL", 100)], conditions: [condition("PRICE_ABOVE", 1)] }),
        rule({ id: "t2", actions: [action("SELL", 100)], conditions: [condition("PRICE_ABOVE", 1)] }),
      ],
    });

    expect(result.canActivate).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("oversold");
  });

  it("accepts exits that exactly match the entry", () => {
    const result = validateStrategy({
      rules: [
        rule({ id: "e", kind: "ENTRY", actions: [action("BUY", 100)], conditions: [condition("PRICE_ABOVE", 1)] }),
        rule({ id: "t1", kind: "TARGET", actions: [action("SELL", 50)], conditions: [condition("PRICE_ABOVE", 1)] }),
        rule({ id: "t2", kind: "STOP", actions: [action("SELL", 50)], conditions: [condition("PRICE_BELOW", 1)] }),
      ],
    });
    expect(result.canActivate).toBe(true);
  });

  it("rejects an invalid percentage exit", () => {
    const result = validateStrategy({
      rules: [
        rule({ actions: [action("BUY", 10)], conditions: [condition("PRICE_ABOVE", 1)] }),
        rule({ id: "p", actions: [action("SELL_PERCENT", 150)], conditions: [condition("PRICE_ABOVE", 1)] }),
      ],
    });
    expect(result.issues.map((i) => i.code)).toContain("invalid-percent");
    expect(result.canActivate).toBe(false);
  });

  it("rejects a trailing stop with no trail distance", () => {
    const result = validateStrategy({
      rules: [rule({ kind: "TRAILING_STOP", actions: [action("SELL_ALL")], trailPercent: null })],
    });
    expect(result.issues.map((i) => i.code)).toContain("missing-trail");
  });

  it("warns but does not block when there is no stop loss", () => {
    const result = validateStrategy({
      rules: [
        rule({ kind: "ENTRY", actions: [action("BUY", 10)], conditions: [condition("PRICE_ABOVE", 1)] }),
      ],
    });

    const stopIssue = result.issues.find((i) => i.code === "no-stop");
    expect(stopIssue?.severity).toBe("warning");
    // Unwise is not the same as invalid.
    expect(result.canActivate).toBe(true);
  });

  it("requires a period on indicator conditions", () => {
    const result = validateStrategy({
      rules: [
        rule({
          actions: [action("BUY", 10)],
          conditions: [condition("RSI_ABOVE", 70, null)],
        }),
      ],
    });
    expect(result.issues.map((i) => i.code)).toContain("missing-period");
  });
});

describe("status machine", () => {
  it("allows the documented transitions", () => {
    expect(canTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransition("PAUSED", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "COMPLETED")).toBe(true);
  });

  it("treats finished strategies as immutable", () => {
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    // A completed record must never be reopened and rewritten.
    expect(canTransition("COMPLETED", "ACTIVE")).toBe(false);
    expect(canTransition("CANCELLED", "DRAFT")).toBe(false);
  });

  it("never returns to draft once activated", () => {
    expect(canTransition("ACTIVE", "DRAFT")).toBe(false);
    expect(canTransition("PAUSED", "DRAFT")).toBe(false);
  });

  it("permits editing only before or between runs", () => {
    expect(isEditable("DRAFT")).toBe(true);
    expect(isEditable("PAUSED")).toBe(true);
    expect(isEditable("ACTIVE")).toBe(false);
    expect(isEditable("COMPLETED")).toBe(false);
  });
});
