import { describe, expect, it } from "vitest";

import { rupeesToPaise, rupeesToPrice } from "@/lib/money";
import { calculateRisk, maxQuantityForRisk } from "@/services/risk/risk-calculator";

const CAPITAL = rupeesToPaise(1_000_000);

describe("risk calculator", () => {
  it("matches the worked example from the specification", () => {
    // Entry ₹100, quantity 1000, target ₹110, stop ₹95
    // → max loss ₹5,000, potential profit ₹10,000, risk/reward 1:2
    const profile = calculateRisk({
      entryPrice: rupeesToPrice(100),
      quantity: 1000,
      capital: CAPITAL,
      targetPrice: rupeesToPrice(110),
      stopPrice: rupeesToPrice(95),
    });

    expect(profile.maxLoss).toBe(rupeesToPaise(5_000));
    expect(profile.potentialProfit).toBe(rupeesToPaise(10_000));
    expect(profile.riskRewardRatio).toBe(2);
    expect(profile.capitalExposure).toBe(rupeesToPaise(100_000));
    expect(profile.exposurePercent).toBeCloseTo(10);
  });

  it("blocks a position costing more than available capital", () => {
    const profile = calculateRisk({
      entryPrice: rupeesToPrice(100),
      quantity: 20_000, // ₹20,00,000 against ₹10,00,000
      capital: CAPITAL,
      targetPrice: rupeesToPrice(110),
      stopPrice: rupeesToPrice(95),
    });

    expect(profile.isViable).toBe(false);
    expect(profile.warnings.map((w) => w.code)).toContain("exceeds-capital");
  });

  it("blocks a stop that does not limit a loss", () => {
    const profile = calculateRisk({
      entryPrice: rupeesToPrice(100),
      quantity: 100,
      capital: CAPITAL,
      targetPrice: rupeesToPrice(110),
      stopPrice: rupeesToPrice(105),
    });

    expect(profile.isViable).toBe(false);
    expect(profile.warnings.map((w) => w.code)).toContain("stop-above-entry");
  });

  it("warns, but does not block, when no stop is set", () => {
    const profile = calculateRisk({
      entryPrice: rupeesToPrice(100),
      quantity: 100,
      capital: CAPITAL,
      targetPrice: rupeesToPrice(110),
      stopPrice: null,
    });

    expect(profile.maxLoss).toBe(0);
    expect(profile.riskRewardRatio).toBeNull();
    expect(profile.warnings.map((w) => w.code)).toContain("no-stop-loss");
    expect(profile.isViable).toBe(true);
  });

  it("treats a zero quantity as not viable", () => {
    const profile = calculateRisk({
      entryPrice: rupeesToPrice(100),
      quantity: 0,
      capital: CAPITAL,
      targetPrice: rupeesToPrice(110),
      stopPrice: rupeesToPrice(95),
    });

    expect(profile.capitalExposure).toBe(0);
    expect(profile.isViable).toBe(false);
  });

  it("sizes a position so the stop-out cost stays within the risk budget", () => {
    const entry = rupeesToPrice(100);
    const stop = rupeesToPrice(95);

    // 1% of ₹10,00,000 = ₹10,000 budget; ₹5 risk per share → 2,000 shares.
    const quantity = maxQuantityForRisk(entry, stop, CAPITAL, 1);
    expect(quantity).toBe(2_000);

    const profile = calculateRisk({
      entryPrice: entry,
      quantity,
      capital: CAPITAL,
      targetPrice: null,
      stopPrice: stop,
    });
    expect(profile.maxLossPercent).toBeLessThanOrEqual(1);
  });

  it("never sizes beyond what the capital can buy", () => {
    // A very tight stop implies a huge risk-based size; capital must cap it.
    const quantity = maxQuantityForRisk(
      rupeesToPrice(100),
      rupeesToPrice(99.99),
      CAPITAL,
      100,
    );
    expect(quantity).toBeLessThanOrEqual(10_000);
  });

  it("returns zero size when the stop is not below the entry", () => {
    expect(maxQuantityForRisk(rupeesToPrice(100), rupeesToPrice(100), CAPITAL, 1)).toBe(0);
  });
});
