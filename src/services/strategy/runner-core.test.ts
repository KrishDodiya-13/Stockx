import { describe, expect, it } from "vitest";

import type { Action, Condition, MarketContext, Rule, Strategy } from "@/domain/strategy";
import { rupeesToPaise, rupeesToPrice } from "@/lib/money";
import { decideRun, evaluateCompletion, nextHighWater } from "@/services/strategy/runner-core";

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

const cond = (type: Condition["type"], value: number): Condition => ({
  id: `c-${type}-${value}`,
  type,
  value,
  period: null,
});

const act = (type: Action["type"], quantity: number | null = null): Action => ({
  id: `a-${type}-${quantity}`,
  type,
  quantity,
});

function rule(id: string, overrides: Partial<Rule> = {}): Rule {
  return {
    id,
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

function strategy(rules: Rule[]): Strategy {
  return {
    id: "s1",
    name: "Test",
    instrumentId: "NSE:RELIANCE",
    symbol: "RELIANCE",
    status: "ACTIVE",
    rules,
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    activatedAt: null,
    completedAt: null,
  };
}

/** The worked example from the specification. */
function workedExample(): Rule[] {
  return [
    rule("entry", { kind: "ENTRY", order: 0, conditions: [cond("PRICE_REACHES", rupeesToPrice(100))], actions: [act("BUY", 100)] }),
    rule("t1", { kind: "TARGET", order: 1, conditions: [cond("PRICE_ABOVE", rupeesToPrice(102))], actions: [act("SELL", 50)] }),
    rule("t2", { kind: "TARGET", order: 2, conditions: [cond("PRICE_ABOVE", rupeesToPrice(105))], actions: [act("SELL", 50)] }),
    rule("stop", { kind: "STOP", order: 3, conditions: [cond("PRICE_BELOW", rupeesToPrice(97))], actions: [act("SELL_ALL")] }),
  ];
}

describe("duplicate execution", () => {
  it("does not re-fire a rule that has already fired", () => {
    const s = strategy(workedExample());

    // Price sits above the first target. Without the fired-set this rule would
    // propose selling 50 shares on every single evaluation.
    const ctx = context({ price: rupeesToPrice(103), positionQuantity: 100 });

    const first = decideRun(s, ctx, new Set(["entry"]));
    expect(first.intents.map((i) => i.ruleId)).toEqual(["t1"]);

    const second = decideRun(s, ctx, new Set(["entry", "t1"]));
    expect(second.intents).toHaveLength(0);
  });

  it("stays inert across many evaluations once everything has fired", () => {
    const s = strategy(workedExample());
    const fired = new Set(["entry", "t1", "t2"]);

    for (let tick = 0; tick < 50; tick += 1) {
      const decision = decideRun(
        s,
        context({ price: rupeesToPrice(110), positionQuantity: 0 }),
        fired,
      );
      expect(decision.intents).toHaveLength(0);
    }
  });

  it("fires each target exactly once as price climbs through them", () => {
    const s = strategy(workedExample());
    const fired = new Set<string>();
    const executed: string[] = [];

    // A rising price path that crosses both targets, sampled repeatedly at
    // each level — the shape that exposes duplicate execution.
    const path = [100, 101, 102.5, 103, 103, 104, 105.5, 106, 106, 107];
    let position = 0;

    for (const price of path) {
      const decision = decideRun(
        s,
        context({
          price: rupeesToPrice(price),
          previousClose: rupeesToPrice(99),
          positionQuantity: position,
        }),
        fired,
      );

      for (const intent of decision.intents) {
        executed.push(`${intent.ruleId}:${intent.side}:${intent.quantity}`);
        fired.add(intent.ruleId);
        position += intent.side === "BUY" ? intent.quantity : -intent.quantity;
      }
    }

    expect(executed).toEqual(["entry:BUY:100", "t1:SELL:50", "t2:SELL:50"]);
    expect(position).toBe(0);
  });
});

describe("stop loss", () => {
  it("closes the whole position when price breaks the stop", () => {
    const s = strategy(workedExample());

    const decision = decideRun(
      s,
      context({ price: rupeesToPrice(96), positionQuantity: 100 }),
      new Set(["entry"]),
    );

    const stop = decision.intents.find((intent) => intent.ruleId === "stop");
    expect(stop).toMatchObject({ side: "SELL", quantity: 100 });
  });

  it("does not fire the stop while price holds above it", () => {
    const decision = decideRun(
      strategy(workedExample()),
      context({ price: rupeesToPrice(98), positionQuantity: 100 }),
      new Set(["entry"]),
    );
    expect(decision.intents.find((i) => i.ruleId === "stop")).toBeUndefined();
  });
});

describe("trailing stop", () => {
  it("ratchets the high-water mark upward only", () => {
    expect(nextHighWater(rupeesToPrice(100), rupeesToPrice(110), 50)).toBe(rupeesToPrice(110));
    // A fall must not drag the mark down with it.
    expect(nextHighWater(rupeesToPrice(110), rupeesToPrice(104), 50)).toBe(rupeesToPrice(110));
  });

  it("clears the mark when the position is flat", () => {
    // A new position must not inherit the previous one's peak.
    expect(nextHighWater(rupeesToPrice(150), rupeesToPrice(100), 0)).toBeNull();
  });

  it("seeds the mark on the first tick of a position", () => {
    expect(nextHighWater(null, rupeesToPrice(100), 10)).toBe(rupeesToPrice(100));
  });

  it("triggers against the updated high-water mark within the same pass", () => {
    const s = strategy([
      rule("trail", { kind: "TRAILING_STOP", order: 0, trailPercent: 5, actions: [act("SELL_ALL")] }),
    ]);

    // High of 120 already recorded; price now 113 → more than 5% below.
    const decision = decideRun(
      s,
      context({
        price: rupeesToPrice(113),
        positionQuantity: 100,
        highWaterPrice: rupeesToPrice(120),
      }),
      new Set(),
    );

    expect(decision.intents[0]).toMatchObject({ side: "SELL", quantity: 100 });
  });

  it("does not trigger when the new high is set on this very tick", () => {
    const s = strategy([
      rule("trail", { kind: "TRAILING_STOP", order: 0, trailPercent: 5, actions: [act("SELL_ALL")] }),
    ]);

    // Price makes a new high — the stop must move up with it, not fire.
    const decision = decideRun(
      s,
      context({
        price: rupeesToPrice(130),
        positionQuantity: 100,
        highWaterPrice: rupeesToPrice(120),
      }),
      new Set(),
    );

    expect(decision.intents).toHaveLength(0);
    expect(decision.highWaterPrice).toBe(rupeesToPrice(130));
  });
});

describe("completion", () => {
  it("completes when every rule has fired and the position is flat", () => {
    const result = evaluateCompletion(
      workedExample(),
      new Set(["entry", "t1", "t2", "stop"]),
      0,
    );
    expect(result.complete).toBe(true);
  });

  it("does not complete while shares are still held", () => {
    // Exits fired but the position is not closed — still live.
    const result = evaluateCompletion(workedExample(), new Set(["entry", "t1", "t2", "stop"]), 25);
    expect(result.complete).toBe(false);
  });

  it("does not complete before entering", () => {
    expect(evaluateCompletion(workedExample(), new Set(), 0).complete).toBe(false);
  });

  it("completes once the position is closed and no entry rule remains", () => {
    // Entry and stop fired, targets never did; position closed by the stop.
    const result = evaluateCompletion(workedExample(), new Set(["entry", "stop"]), 0);
    expect(result.complete).toBe(true);
    expect(result.reason).toMatch(/no entry rule remains/i);
  });

  it("ignores disabled rules when deciding completion", () => {
    const rules = workedExample().map((r) =>
      r.id === "t2" ? { ...r, enabled: false } : r,
    );
    expect(evaluateCompletion(rules, new Set(["entry", "t1", "stop"]), 0).complete).toBe(true);
  });

  it("never completes in the same pass that still has intents", () => {
    const s = strategy(workedExample());
    const decision = decideRun(
      s,
      context({ price: rupeesToPrice(96), positionQuantity: 100 }),
      new Set(["entry", "t1", "t2"]),
    );

    expect(decision.intents.length).toBeGreaterThan(0);
    // The stop is about to sell; completion is decided on the following pass.
    expect(decision.shouldComplete).toBe(false);
  });
});

describe("retry after a refused order", () => {
  /*
    The runner releases a rule's claim when the paper trading engine refuses the
    order, so the rule can be re-attempted. These assert the *decision* side of
    that contract: a released rule is indistinguishable from one that never
    fired, so it must be proposed again while its condition still holds.
  */
  it("re-proposes a rule whose claim was released", () => {
    const s = strategy(workedExample());
    const ctx = context({ price: rupeesToPrice(103), positionQuantity: 100 });

    // First attempt claims t1.
    const fired = new Set(["entry", "t1"]);
    expect(decideRun(s, ctx, fired).intents).toHaveLength(0);

    // The order was refused, so the runner clears the marker.
    fired.delete("t1");

    const retry = decideRun(s, ctx, fired);
    expect(retry.intents.map((i) => i.ruleId)).toEqual(["t1"]);
  });

  it("stops re-proposing once the rule finally succeeds", () => {
    const s = strategy(workedExample());
    const ctx = context({ price: rupeesToPrice(103), positionQuantity: 50 });

    expect(decideRun(s, ctx, new Set(["entry", "t1"])).intents).toHaveLength(0);
  });

  it("does not complete a strategy while a released rule can still fire", () => {
    const s = strategy(workedExample());
    // Everything fired except t1, which was released after a refusal.
    const decision = decideRun(
      s,
      context({ price: rupeesToPrice(103), positionQuantity: 50 }),
      new Set(["entry", "t2", "stop"]),
    );

    expect(decision.shouldComplete).toBe(false);
    expect(decision.intents.map((i) => i.ruleId)).toContain("t1");
  });
});

describe("inactive strategies", () => {
  it("produces no intents when paused", () => {
    const paused = { ...strategy(workedExample()), status: "PAUSED" as const };
    const decision = decideRun(
      paused,
      context({ price: rupeesToPrice(103), positionQuantity: 100 }),
      new Set(["entry"]),
    );
    expect(decision.intents).toHaveLength(0);
  });
});
