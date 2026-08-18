import { describe, expect, it } from "vitest";

import { validateStrategy } from "@/services/strategy/strategy-engine";
import {
  canConvertToStrategy,
  simulationToStrategy,
  type SimulationInput,
} from "@/services/risk/simulation-to-strategy";
import { rupeesToPrice } from "@/lib/money";

function simulation(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return {
    name: "Test plan",
    instrumentId: "NSE:RELIANCE",
    symbol: "RELIANCE",
    entryPrice: rupeesToPrice(100),
    quantity: 1000,
    targetPrice: rupeesToPrice(110),
    stopPrice: rupeesToPrice(95),
    ...overrides,
  };
}

describe("simulationToStrategy", () => {
  it("produces entry, target and stop in execution order", () => {
    const draft = simulationToStrategy(simulation());
    expect(draft.rules.map((rule) => rule.kind)).toEqual(["ENTRY", "TARGET", "STOP"]);
  });

  it("carries the entry price and quantity through", () => {
    const draft = simulationToStrategy(simulation());
    const entry = draft.rules[0]!;

    expect(entry.conditions[0]).toMatchObject({
      type: "PRICE_REACHES",
      value: rupeesToPrice(100),
    });
    expect(entry.actions[0]).toMatchObject({ type: "BUY", quantity: 1000 });
  });

  it("closes the whole position at the target and at the stop", () => {
    const draft = simulationToStrategy(simulation());
    expect(draft.rules[1]!.actions[0]).toMatchObject({ type: "SELL_ALL" });
    expect(draft.rules[2]!.actions[0]).toMatchObject({ type: "SELL_ALL" });
  });

  it("omits the target when none was set", () => {
    const draft = simulationToStrategy(simulation({ targetPrice: null }));
    expect(draft.rules.map((rule) => rule.kind)).toEqual(["ENTRY", "STOP"]);
  });

  it("omits the stop when none was set", () => {
    const draft = simulationToStrategy(simulation({ stopPrice: null }));
    expect(draft.rules.map((rule) => rule.kind)).toEqual(["ENTRY", "TARGET"]);
  });

  it("falls back to a sensible name when none was given", () => {
    expect(simulationToStrategy(simulation({ name: "   " })).name).toBe("RELIANCE plan");
  });

  it("orders the stop after the target", () => {
    // Reversed, the stop would close the position before the target could ever
    // be evaluated by the top-to-bottom runner.
    const draft = simulationToStrategy(simulation());
    const targetIndex = draft.rules.findIndex((rule) => rule.kind === "TARGET");
    const stopIndex = draft.rules.findIndex((rule) => rule.kind === "STOP");
    expect(targetIndex).toBeLessThan(stopIndex);
  });

  it("produces a strategy the validator accepts", () => {
    // The whole point of the conversion: what comes out must be activatable.
    const draft = simulationToStrategy(simulation());

    const asRules = draft.rules.map((rule, index) => ({
      id: `r${index}`,
      kind: rule.kind,
      order: index,
      operator: rule.operator,
      trailPercent: rule.trailPercent,
      enabled: rule.enabled,
      conditions: rule.conditions.map((condition, i) => ({ id: `c${i}`, ...condition })),
      actions: rule.actions.map((action, i) => ({ id: `a${i}`, ...action })),
    }));

    const validation = validateStrategy({ rules: asRules });
    expect(validation.canActivate).toBe(true);
    expect(validation.issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  it("still validates when only an entry is present", () => {
    const draft = simulationToStrategy(simulation({ targetPrice: null, stopPrice: null }));

    const asRules = draft.rules.map((rule, index) => ({
      id: `r${index}`,
      kind: rule.kind,
      order: index,
      operator: rule.operator,
      trailPercent: rule.trailPercent,
      enabled: rule.enabled,
      conditions: rule.conditions.map((condition, i) => ({ id: `c${i}`, ...condition })),
      actions: rule.actions.map((action, i) => ({ id: `a${i}`, ...action })),
    }));

    const validation = validateStrategy({ rules: asRules });
    // Activatable, but warned about the missing stop.
    expect(validation.canActivate).toBe(true);
    expect(validation.issues.map((issue) => issue.code)).toContain("no-stop");
  });
});

describe("canConvertToStrategy", () => {
  it("requires an entry price and a quantity", () => {
    expect(canConvertToStrategy({ entryPrice: rupeesToPrice(100), quantity: 10 })).toBe(true);
    expect(canConvertToStrategy({ entryPrice: null, quantity: 10 })).toBe(false);
    expect(canConvertToStrategy({ entryPrice: rupeesToPrice(100), quantity: 0 })).toBe(false);
  });
});
