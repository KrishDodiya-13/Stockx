import { describe, expect, it } from "vitest";

import { dayChange } from "@/domain/day-change";
import { formatPercent } from "@/lib/format";
import { rupeesToPrice, type PriceE4 } from "@/lib/money";

/**
 * The day's change.
 *
 * One rule, stated once: `((price - previousClose) / previousClose) * 100`,
 * and null whenever either side of it is missing. The tests below are mostly
 * about the second half — every regression in this area has been a fallback
 * that turned "not known" into a number, and every one of them rendered as
 * 0.00%.
 */

const price = (rupees: number): PriceE4 => rupeesToPrice(rupees);

describe("dayChange", () => {
  it("matches the worked example: 150 against 145 is +3.45%", () => {
    const result = dayChange(price(150), price(145));

    expect(result.changePercent).toBeCloseTo(3.4483, 4);
    expect(formatPercent(result.changePercent, { signed: true })).toBe("+3.45%");
  });

  it("keeps a rise positive and a fall negative", () => {
    expect(dayChange(price(1402.35), price(1390.1)).change).toBeGreaterThan(0);
    expect(dayChange(price(1380), price(1400)).change).toBeLessThan(0);

    expect(formatPercent(dayChange(price(1023.5), price(1000)).changePercent, { signed: true })).toBe(
      "+2.35%",
    );
    expect(formatPercent(dayChange(price(985.8), price(1000)).changePercent, { signed: true })).toBe(
      "-1.42%",
    );
  });

  it("computes the absolute move per share exactly", () => {
    const result = dayChange(price(729), price(723));
    expect(result.change).toBe(rupeesToPrice(6));
  });

  it("reports a genuinely unchanged instrument as 0.00%, not as unknown", () => {
    // The distinction runs both ways: a real flat print is a fact and must be
    // shown as one.
    const result = dayChange(price(1000), price(1000));

    expect(result.changePercent).toBe(0);
    expect(formatPercent(result.changePercent, { signed: true })).toBe("0.00%");
  });

  it("is unknown, not zero, when the previous close is missing", () => {
    for (const missing of [null, undefined]) {
      const result = dayChange(price(900), missing);

      expect(result.previousClose).toBeNull();
      expect(result.change).toBeNull();
      expect(result.changePercent).toBeNull();
    }
  });

  it("treats a zero or negative previous close as missing rather than dividing by it", () => {
    // Dividing would give Infinity or a nonsense percentage, and both would be
    // rendered as though they had been measured.
    for (const bad of [0, -10]) {
      expect(dayChange(price(900), bad as PriceE4).changePercent).toBeNull();
    }
  });

  it("is unknown when the price itself is missing or not a price", () => {
    expect(dayChange(null, price(100)).changePercent).toBeNull();
    expect(dayChange(undefined, price(100)).changePercent).toBeNull();
    expect(dayChange(0 as PriceE4, price(100)).changePercent).toBeNull();
    expect(dayChange(Number.NaN as PriceE4, price(100)).changePercent).toBeNull();
  });

  it("renders every unknown as the same placeholder", () => {
    expect(formatPercent(dayChange(price(900), null).changePercent, { signed: true })).toBe("--");
  });

  it("survives sub-rupee closes without losing precision", () => {
    // Vodafone Idea trades in single rupees; a percentage there is dominated
    // by the paise, so the integer scale has to carry them.
    const result = dayChange(price(7.42), price(7.15));
    expect(result.changePercent).toBeCloseTo(3.7762, 3);
  });
});
