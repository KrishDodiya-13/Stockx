import { describe, expect, it } from "vitest";

import {
  bollingerBands,
  ema,
  macd,
  rsi,
  seriesExtent,
  sma,
} from "@/services/indicators/indicators";

/**
 * These are checked against hand-computed values rather than a snapshot, so a
 * regression shows up as a wrong number rather than as an updated snapshot.
 */
describe("sma", () => {
  it("averages over the window", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("leaves insufficient look-back as null, never 0", () => {
    const result = sma([10, 20], 5);
    expect(result).toEqual([null, null]);
    expect(result).not.toContain(0);
  });

  it("returns a series the same length as its input", () => {
    expect(sma([1, 2, 3, 4, 5, 6, 7], 4)).toHaveLength(7);
  });

  it("rejects a non-positive period", () => {
    expect(() => sma([1, 2, 3], 0)).toThrow();
  });
});

describe("ema", () => {
  it("seeds from the SMA of the first window", () => {
    // SMA(1..3) = 2, then EMA with multiplier 2/(3+1) = 0.5
    const result = ema([1, 2, 3, 4, 5], 3);
    expect(result[2]).toBeCloseTo(2);
    expect(result[3]).toBeCloseTo(3); // (4-2)*0.5 + 2
    expect(result[4]).toBeCloseTo(4); // (5-3)*0.5 + 3
  });

  it("returns all nulls when there is not enough data", () => {
    expect(ema([1, 2], 5).every((value) => value === null)).toBe(true);
  });

  it("tracks a constant series to that constant", () => {
    const result = ema(new Array(30).fill(100), 10);
    expect(result[29]).toBeCloseTo(100);
  });
});

describe("rsi", () => {
  it("reports 100 when every move is a gain", () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(rising, 14)[29]).toBeCloseTo(100);
  });

  it("reports 0 when every move is a loss", () => {
    const falling = Array.from({ length: 30 }, (_, i) => 200 - i);
    expect(rsi(falling, 14)[29]).toBeCloseTo(0);
  });

  it("sits at 50 for a flat series rather than dividing by zero", () => {
    const flat = new Array(30).fill(100);
    const value = rsi(flat, 14)[29];
    expect(value).toBe(50);
    expect(Number.isNaN(value as number)).toBe(false);
  });

  it("stays within 0..100 on noisy data", () => {
    const noisy = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 12 + (i % 7));
    for (const value of rsi(noisy, 14)) {
      if (value === null) continue;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it("produces no value before the period has elapsed", () => {
    const result = rsi(Array.from({ length: 30 }, (_, i) => 100 + i), 14);
    expect(result.slice(0, 14).every((value) => value === null)).toBe(true);
    expect(result[14]).not.toBeNull();
  });
});

describe("macd", () => {
  const prices = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 8) * 10 + i * 0.15);

  it("keeps histogram equal to macd minus signal wherever both exist", () => {
    const { macd: line, signal, histogram } = macd(prices);

    for (let i = 0; i < prices.length; i += 1) {
      if (signal[i] === null) continue;
      expect(histogram[i]).toBeCloseTo((line[i] as number) - (signal[i] as number), 9);
    }
  });

  it("starts the signal line no earlier than the macd line", () => {
    const { macd: line, signal } = macd(prices);
    const firstMacd = line.findIndex((v) => v !== null);
    const firstSignal = signal.findIndex((v) => v !== null);

    expect(firstMacd).toBeGreaterThan(0);
    // Seeding the signal from the start of prices would put it before the
    // macd line, which would be wrong.
    expect(firstSignal).toBeGreaterThanOrEqual(firstMacd);
  });

  it("collapses to zero on a flat series", () => {
    const { macd: line, histogram } = macd(new Array(120).fill(100));
    expect(line[119]).toBeCloseTo(0);
    expect(histogram[119]).toBeCloseTo(0);
  });

  it("rejects a fast period that is not shorter than the slow period", () => {
    expect(() => macd(prices, 26, 12)).toThrow();
  });
});

describe("bollingerBands", () => {
  it("collapses the bands onto the mean when there is no variance", () => {
    const { middle, upper, lower } = bollingerBands(new Array(30).fill(50), 20, 2);
    expect(middle[29]).toBeCloseTo(50);
    expect(upper[29]).toBeCloseTo(50);
    expect(lower[29]).toBeCloseTo(50);
  });

  it("keeps upper above middle above lower", () => {
    const prices = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 4) * 8);
    const { middle, upper, lower } = bollingerBands(prices, 20, 2);

    for (let i = 0; i < prices.length; i += 1) {
      if (middle[i] === null) continue;
      expect(upper[i] as number).toBeGreaterThanOrEqual(middle[i] as number);
      expect(middle[i] as number).toBeGreaterThanOrEqual(lower[i] as number);
    }
  });

  it("computes a known standard deviation correctly", () => {
    // Population stddev of 1..5 is sqrt(2) ≈ 1.41421356
    const { middle, upper } = bollingerBands([1, 2, 3, 4, 5], 5, 1);
    expect(middle[4]).toBeCloseTo(3);
    expect((upper[4] as number) - 3).toBeCloseTo(Math.SQRT2, 6);
  });
});

describe("seriesExtent", () => {
  it("ignores nulls when finding the range", () => {
    expect(seriesExtent([null, 5, null, 12, 3])).toEqual({ min: 3, max: 12 });
  });

  it("returns null when nothing is plottable", () => {
    expect(seriesExtent([null, null])).toBeNull();
  });

  it("spans several series at once", () => {
    expect(seriesExtent([1, 2], [null, 90])).toEqual({ min: 1, max: 90 });
  });
});
