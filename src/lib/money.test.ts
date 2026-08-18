import { describe, expect, it } from "vitest";

import {
  averagePrice,
  notional,
  paiseToRupees,
  percentChange,
  roundHalfAwayFromZero,
  rupeesToPaise,
  rupeesToPrice,
  subPaise,
  sumPaise,
  type Paise,
} from "@/lib/money";

/**
 * Regression guard for the financial calculation engine.
 *
 * Everything downstream — portfolio value, P&L, risk — is built on these, so a
 * silent change here would be wrong everywhere at once.
 */
describe("money engine", () => {
  it("keeps rupee amounts exact where floats would drift", () => {
    // 0.1 + 0.2 !== 0.3 in float. In integer paise it is exact.
    const total = sumPaise([rupeesToPaise(0.1), rupeesToPaise(0.2)]);
    expect(total).toBe(rupeesToPaise(0.3));
    expect(paiseToRupees(total)).toBe(0.3);
  });

  it("does not accumulate error over many operations", () => {
    let total = 0 as Paise;
    for (let i = 0; i < 10_000; i += 1) total = sumPaise([total, rupeesToPaise(0.01)]);
    // A float loop over 0.01 lands near 99.99999999. This must be exact.
    expect(paiseToRupees(total)).toBe(100);
  });

  it("rounds symmetrically about zero, so gains and losses round alike", () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    // Math.round(-2.5) is -2, which would bias losses upward.
    expect(roundHalfAwayFromZero(-2.5)).not.toBe(Math.round(-2.5));
  });

  it("computes notional value exactly", () => {
    expect(notional(rupeesToPrice(100), 1_000)).toBe(rupeesToPaise(100_000));
    expect(notional(rupeesToPrice(1418.6), 7)).toBe(rupeesToPaise(9930.2));
  });

  it("rejects fractional share quantities", () => {
    expect(() => notional(rupeesToPrice(100), 1.5)).toThrow();
  });

  it("round-trips average cost through notional", () => {
    const price = rupeesToPrice(1234.56);
    const quantity = 37;
    expect(averagePrice(notional(price, quantity), quantity)).toBe(price);
  });

  it("returns zero average for an empty position instead of NaN", () => {
    expect(averagePrice(rupeesToPaise(0), 0)).toBe(0);
    expect(Number.isNaN(averagePrice(rupeesToPaise(500), 0))).toBe(false);
  });

  it("treats a zero base as no change rather than an infinite one", () => {
    expect(percentChange(0, 100)).toBe(0);
    expect(Number.isFinite(percentChange(0, 100))).toBe(true);
  });

  it("signs a loss correctly", () => {
    expect(subPaise(rupeesToPaise(95_000), rupeesToPaise(100_000))).toBe(rupeesToPaise(-5_000));
  });

  it("refuses a negative price", () => {
    expect(() => rupeesToPrice(-1)).toThrow();
  });
});
