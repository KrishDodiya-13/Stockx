import { describe, expect, it } from "vitest";

import {
  downsample,
  extentOf,
  monotoneControlPoints,
  nearestIndex,
  paddedRange,
  windowSeries,
  type EquityPoint,
  type SeriesPoint,
} from "@/components/portfolio/equity-series";

/**
 * The performance chart's arithmetic.
 *
 * The property under test throughout is that the chart cannot show a number
 * the account did not have. Every value the series emits must be traceable to
 * a recorded point or to the live account value — never to an interpolation,
 * an average, or a filler value invented to make a sparse range look busy.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A fixed "now" so no test depends on the hour it runs at. */
const NOW = Date.UTC(2026, 7, 18, 6, 0, 0);

function point(daysAgo: number, value: number): EquityPoint {
  return { time: NOW - daysAgo * DAY, value };
}

function carried(series: readonly SeriesPoint[]): readonly SeriesPoint[] {
  return series.filter((entry) => entry.carried);
}

describe("windowSeries", () => {
  const history: EquityPoint[] = [
    point(120, 1_000_000),
    point(60, 1_050_000),
    point(10, 1_020_000),
    point(2, 1_090_000),
  ];

  it("has nothing to draw without history", () => {
    expect(windowSeries([], { from: NOW - DAY, to: NOW, liveValue: 5 })).toEqual([]);
  });

  it("keeps every recorded point inside the window", () => {
    const series = windowSeries(history, { from: NOW - 30 * DAY, to: NOW, liveValue: null });
    const recorded = series.filter((entry) => !entry.carried);

    expect(recorded.map((entry) => entry.value)).toEqual([1_020_000, 1_090_000]);
  });

  it("excludes points older than the window, except as the opening anchor", () => {
    const series = windowSeries(history, { from: NOW - 30 * DAY, to: NOW, liveValue: null });

    // The 60-day-old point is out of range, but its *value* opens the window:
    // that is what the account was worth when the window began.
    expect(series[0]).toEqual({ time: NOW - 30 * DAY, value: 1_050_000, carried: true });
  });

  it("draws a flat line for a window with no trades in it, at the value already held", () => {
    // A quiet day on an active account is a real answer, not an empty state.
    const series = windowSeries(history, { from: NOW - HOUR, to: NOW, liveValue: null });

    expect(series).toHaveLength(2);
    expect(series.every((entry) => entry.value === 1_090_000)).toBe(true);
    expect(carried(series)).toHaveLength(2);
  });

  it("terminates on the live account value so the curve matches the hero figure", () => {
    const series = windowSeries(history, { from: NOW - 30 * DAY, to: NOW, liveValue: 1_111_111 });
    const last = series[series.length - 1]!;

    expect(last).toEqual({ time: NOW, value: 1_111_111, carried: true });
  });

  it("carries the last recorded value when there is no live value", () => {
    const series = windowSeries(history, { from: NOW - 30 * DAY, to: NOW, liveValue: null });
    const last = series[series.length - 1]!;

    expect(last.value).toBe(1_090_000);
    expect(last.carried).toBe(true);
  });

  it("marks only the anchors as carried — recorded points are never mislabelled", () => {
    const series = windowSeries(history, { from: NOW - 30 * DAY, to: NOW, liveValue: 1_100_000 });

    expect(carried(series)).toHaveLength(2);
    expect(series[0]!.carried).toBe(true);
    expect(series[series.length - 1]!.carried).toBe(true);
  });

  it("opens on the first real point when the window predates the account", () => {
    const series = windowSeries(history, { from: NOW - 365 * DAY, to: NOW, liveValue: null });

    // No anchor is invented before the account existed.
    expect(series[0]).toEqual({ time: NOW - 120 * DAY, value: 1_000_000, carried: false });
  });

  it("does not duplicate the final point when it already sits at the window end", () => {
    const single: EquityPoint[] = [point(120, 900), { time: NOW, value: 1_000 }];
    const series = windowSeries(single, { from: NOW - DAY, to: NOW, liveValue: 1_000 });

    expect(series.filter((entry) => entry.time === NOW)).toHaveLength(1);
  });

  it("never invents a value between two recorded points", () => {
    const series = windowSeries(history, { from: NOW - 365 * DAY, to: NOW, liveValue: null });
    const recorded = new Set(history.map((entry) => entry.value));

    for (const entry of series) expect(recorded.has(entry.value), String(entry.value)).toBe(true);
  });
});

describe("downsample", () => {
  const many: SeriesPoint[] = Array.from({ length: 5_000 }, (_, index) => ({
    time: NOW - (5_000 - index) * 1_000,
    value: 1_000_000 + Math.round(Math.sin(index / 40) * 50_000),
    carried: false,
  }));

  it("leaves a short series alone", () => {
    const short = many.slice(0, 20);
    expect(downsample(short, 700)).toBe(short);
  });

  it("caps the point count at the budget it was given", () => {
    expect(downsample(many, 700).length).toBeLessThanOrEqual(700);
    expect(downsample(many, 40).length).toBeLessThanOrEqual(40);
  });

  it("keeps the ends, so the curve still starts and finishes where it should", () => {
    const reduced = downsample(many, 700);

    expect(reduced[0]).toBe(many[0]);
    expect(reduced[reduced.length - 1]).toBe(many[many.length - 1]);
  });

  it("preserves the extremes — a drawdown must not be sampled away", () => {
    const spiked = [...many];
    spiked[2_500] = { time: many[2_500]!.time, value: 1, carried: false };

    const reduced = downsample(spiked, 700);
    expect(reduced.some((entry) => entry.value === 1)).toBe(true);
  });

  it("stays in chronological order", () => {
    const reduced = downsample(many, 700);
    for (let i = 1; i < reduced.length; i += 1) {
      expect(reduced[i]!.time).toBeGreaterThanOrEqual(reduced[i - 1]!.time);
    }
  });

  it("emits only points that were in the input", () => {
    const reduced = downsample(many, 700);
    const original = new Set<SeriesPoint>(many);
    for (const entry of reduced) expect(original.has(entry)).toBe(true);
  });
});

describe("extentOf", () => {
  it("is null for an empty series", () => {
    expect(extentOf([])).toBeNull();
  });

  it("reports the value bounds and the first and last times", () => {
    const series: SeriesPoint[] = [
      { time: 10, value: 5, carried: false },
      { time: 20, value: 1, carried: false },
      { time: 30, value: 9, carried: false },
    ];

    expect(extentOf(series)).toEqual({ minTime: 10, maxTime: 30, minValue: 1, maxValue: 9 });
  });
});

describe("paddedRange", () => {
  it("pads a normal range symmetrically", () => {
    const range = paddedRange(100, 200, 0.1);
    expect(range).toEqual({ min: 90, max: 210 });
  });

  it("gives a flat series a non-zero span, so the scale cannot divide by zero", () => {
    const range = paddedRange(1_000, 1_000);
    expect(range.max).toBeGreaterThan(range.min);
  });

  it("still spans something when the level itself is zero", () => {
    const range = paddedRange(0, 0);
    expect(range.max).toBeGreaterThan(range.min);
  });
});

describe("nearestIndex", () => {
  const series: SeriesPoint[] = [0, 100, 200, 300].map((time) => ({
    time,
    value: time,
    carried: false,
  }));

  it("finds an exact hit", () => {
    expect(nearestIndex(series, 200)).toBe(2);
  });

  it("rounds to the closer neighbour", () => {
    expect(nearestIndex(series, 149)).toBe(1);
    expect(nearestIndex(series, 151)).toBe(2);
  });

  it("clamps beyond either end rather than running off the array", () => {
    expect(nearestIndex(series, -5_000)).toBe(0);
    expect(nearestIndex(series, 5_000)).toBe(3);
  });

  it("has no answer for an empty series", () => {
    expect(nearestIndex([], 10)).toBe(-1);
  });
});

describe("monotoneControlPoints", () => {
  /** Sample a cubic Bézier segment at t. */
  function bezier(p0: number, c1: number, c2: number, p1: number, t: number): number {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p1;
  }

  it("stays flat between two equal values — no invented dip or bulge", () => {
    const xs = [0, 10, 20];
    const ys = [5, 5, 5];
    const { c1x, c1y, c2x, c2y } = monotoneControlPoints(xs, ys);

    for (let t = 0; t <= 1; t += 0.1) {
      expect(bezier(ys[0]!, c1y[0]!, c2y[0]!, ys[1]!, t)).toBeCloseTo(5, 9);
    }
    expect(c1x[0]).toBeGreaterThan(xs[0]!);
    expect(c2x[0]).toBeLessThan(xs[1]!);
  });

  it("never overshoots the values on either side of a segment", () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [10, 90, 20, 95, 15];
    const { c1x, c1y, c2x, c2y } = monotoneControlPoints(xs, ys);

    for (let i = 0; i < xs.length - 1; i += 1) {
      const low = Math.min(ys[i]!, ys[i + 1]!);
      const high = Math.max(ys[i]!, ys[i + 1]!);

      for (let t = 0; t <= 1.0001; t += 0.05) {
        const y = bezier(ys[i]!, c1y[i]!, c2y[i]!, ys[i + 1]!, t);
        expect(y).toBeGreaterThanOrEqual(low - 1e-6);
        expect(y).toBeLessThanOrEqual(high + 1e-6);
      }
      expect(c1x[i]).toBeGreaterThanOrEqual(xs[i]!);
      expect(c2x[i]).toBeLessThanOrEqual(xs[i + 1]!);
    }
  });

  it("produces one control pair per segment", () => {
    const { c1x, c2x } = monotoneControlPoints([0, 1, 2], [1, 2, 3]);
    expect(c1x).toHaveLength(2);
    expect(c2x).toHaveLength(2);
  });

  it("survives repeated timestamps without producing NaN", () => {
    // Two trades in the same millisecond is not hypothetical.
    const { c1y, c2y } = monotoneControlPoints([0, 0, 1], [10, 20, 30]);
    for (const value of [...c1y, ...c2y]) expect(Number.isFinite(value)).toBe(true);
  });
});
