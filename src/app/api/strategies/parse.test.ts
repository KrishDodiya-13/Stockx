import { describe, expect, it } from "vitest";

import { parseStrategyInput } from "@/app/api/strategies/parse";
import { rupeesToPrice } from "@/lib/money";

/**
 * Condition values are bare numbers whose unit depends on the condition type.
 * These cases exist because sending a price in rupees instead of PriceE4 — a
 * 10,000× error — used to be accepted silently, producing a strategy whose
 * every rule fired on the first cycle.
 */

function strategy(conditions: unknown[], actions: unknown[] = [{ type: "SELL_ALL" }]) {
  return {
    name: "Test",
    instrumentId: "NSE:RELIANCE",
    rules: [{ kind: "ENTRY", operator: "AND", conditions, actions }],
  };
}

describe("parseStrategyInput — condition value units", () => {
  it("accepts a price expressed in PriceE4", () => {
    const result = parseStrategyInput(
      strategy([{ type: "PRICE_ABOVE", value: rupeesToPrice(1500) }]),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a price that looks like unconverted rupees", () => {
    // ₹1,500 sent raw is 1500 PriceE4 = ₹0.15 — every rule would fire at once.
    const result = parseStrategyInput(strategy([{ type: "PRICE_ABOVE", value: 1500 }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/rupees/i);
  });

  it("rejects a zero or negative price level", () => {
    for (const value of [0, -1, -rupeesToPrice(100)]) {
      const result = parseStrategyInput(strategy([{ type: "PRICE_BELOW", value }]));
      expect(result.ok).toBe(false);
    }
  });

  it("accepts a price at the ₹1 boundary", () => {
    const result = parseStrategyInput(
      strategy([{ type: "PRICE_ABOVE", value: rupeesToPrice(1) }]),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an implausibly large price", () => {
    const result = parseStrategyInput(
      strategy([{ type: "PRICE_ABOVE", value: 1e15 }]),
    );
    expect(result.ok).toBe(false);
  });

  it("allows a negative percentage, because P&L conditions need one", () => {
    const result = parseStrategyInput(
      strategy([{ type: "POSITION_PNL_BELOW", value: -5 }]),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an absurd percentage", () => {
    const result = parseStrategyInput(
      strategy([{ type: "PERCENT_INCREASE", value: 50_000 }]),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a negative volume", () => {
    const result = parseStrategyInput(strategy([{ type: "VOLUME_ABOVE", value: -1 }]));
    expect(result.ok).toBe(false);
  });

  it("still rejects a non-numeric value", () => {
    const result = parseStrategyInput(
      strategy([{ type: "PRICE_ABOVE", value: "not a number" }]),
    );
    expect(result.ok).toBe(false);
  });

  it("still rejects an unknown condition type", () => {
    const result = parseStrategyInput(strategy([{ type: "PRICE_VIBES", value: 100_000 }]));
    expect(result.ok).toBe(false);
  });

  it("names the offending rule so the message is actionable", () => {
    const result = parseStrategyInput({
      name: "Test",
      instrumentId: "NSE:RELIANCE",
      rules: [
        {
          kind: "ENTRY",
          operator: "AND",
          conditions: [{ type: "PRICE_ABOVE", value: rupeesToPrice(100) }],
          actions: [{ type: "BUY", quantity: 1 }],
        },
        {
          kind: "TARGET",
          operator: "AND",
          conditions: [{ type: "PRICE_ABOVE", value: 102 }],
          actions: [{ type: "SELL_ALL" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Rule 2");
  });
});
