import { describe, expect, it } from "vitest";

import {
  MAX_VISIBLE_CANDLES,
  MIN_VISIBLE_CANDLES,
  candleAtX,
  clampViewport,
  clampVisibleCount,
  extendRange,
  indexToX,
  isAtRightEdge,
  niceTicks,
  panViewport,
  priceRangeFor,
  priceToY,
  wheelDeltaToPixels,
  zoomToCount,
  viewportAtEnd,
  xToIndex,
  yToPrice,
  zoomViewport,
  type PlotArea,
} from "@/components/chart/chart-math";
import type { Candle } from "@/domain/market";
import { rupeesToPrice } from "@/lib/money";

const PLOT: PlotArea = { left: 0, top: 0, width: 800, height: 400 };

function makeCandles(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: i * 60_000,
    open: rupeesToPrice(100 + i),
    high: rupeesToPrice(102 + i),
    low: rupeesToPrice(99 + i),
    close: rupeesToPrice(101 + i),
    volume: 1000 + i,
  }));
}

describe("clampViewport", () => {
  it("never pans past the end of the data", () => {
    const result = clampViewport({ offset: 9_999, visibleCount: 50 }, 200);
    expect(result.offset).toBe(150);
    expect(result.offset + result.visibleCount).toBe(200);
  });

  it("never pans before the start", () => {
    expect(clampViewport({ offset: -50, visibleCount: 30 }, 200).offset).toBe(0);
  });

  it("enforces the zoom limits", () => {
    expect(clampViewport({ offset: 0, visibleCount: 1 }, 500).visibleCount).toBe(
      MIN_VISIBLE_CANDLES,
    );
    expect(clampViewport({ offset: 0, visibleCount: 10_000 }, 5_000).visibleCount).toBe(
      MAX_VISIBLE_CANDLES,
    );
  });

  it("never asks for more candles than exist", () => {
    const result = clampViewport({ offset: 0, visibleCount: 300 }, 40);
    expect(result.visibleCount).toBe(40);
    expect(result.offset).toBe(0);
  });

  it("handles an empty dataset without producing NaN", () => {
    const result = clampViewport({ offset: 5, visibleCount: 50 }, 0);
    expect(result).toEqual({ offset: 0, visibleCount: 0 });
  });
});

describe("zoomViewport", () => {
  it("keeps the candle under the cursor fixed when zooming in", () => {
    const candleCount = 500;
    const viewport = { offset: 100, visibleCount: 100 };
    const anchorRatio = 0.5;

    const anchorBefore = viewport.offset + viewport.visibleCount * anchorRatio;
    const zoomed = zoomViewport(viewport, candleCount, 0.5, anchorRatio);
    const anchorAfter = zoomed.offset + zoomed.visibleCount * anchorRatio;

    // Rounding to whole candles allows at most half a candle of drift.
    expect(Math.abs(anchorAfter - anchorBefore)).toBeLessThanOrEqual(1);
  });

  it("holds the left edge when zooming about the left edge", () => {
    const zoomed = zoomViewport({ offset: 200, visibleCount: 100 }, 1_000, 0.5, 0);
    expect(zoomed.offset).toBe(200);
  });

  it("respects zoom limits regardless of factor", () => {
    const tiny = zoomViewport({ offset: 0, visibleCount: 50 }, 1_000, 0.001, 0.5);
    expect(tiny.visibleCount).toBe(MIN_VISIBLE_CANDLES);

    const huge = zoomViewport({ offset: 0, visibleCount: 50 }, 1_000, 1_000, 0.5);
    expect(huge.visibleCount).toBe(MAX_VISIBLE_CANDLES);
  });

  it("stays within the data after zooming out at the right edge", () => {
    const candleCount = 300;
    const zoomed = zoomViewport({ offset: 280, visibleCount: 20 }, candleCount, 4, 1);
    expect(zoomed.offset).toBeGreaterThanOrEqual(0);
    expect(zoomed.offset + zoomed.visibleCount).toBeLessThanOrEqual(candleCount);
  });
});

describe("panViewport", () => {
  it("moves back in time when dragged right", () => {
    const panned = panViewport({ offset: 100, visibleCount: 50 }, 500, 80, PLOT.width);
    expect(panned.offset).toBeLessThan(100);
  });

  it("cannot be dragged past either edge", () => {
    expect(panViewport({ offset: 0, visibleCount: 50 }, 500, 5_000, PLOT.width).offset).toBe(0);

    const right = panViewport({ offset: 450, visibleCount: 50 }, 500, -5_000, PLOT.width);
    expect(right.offset).toBe(450);
  });

  it("is a no-op with zero plot width instead of dividing by zero", () => {
    const viewport = { offset: 10, visibleCount: 50 };
    expect(panViewport(viewport, 500, 40, 0)).toEqual(viewport);
  });
});

describe("scales", () => {
  it("round-trips index through x", () => {
    const viewport = { offset: 20, visibleCount: 60 };
    const x = indexToX(35, viewport, PLOT);
    expect(xToIndex(x, viewport, PLOT)).toBeCloseTo(35, 6);
  });

  it("round-trips price through y", () => {
    const range = { min: 90, max: 130 };
    const y = priceToY(112.5, range, PLOT);
    expect(yToPrice(y, range, PLOT)).toBeCloseTo(112.5, 6);
  });

  it("puts the maximum at the top and the minimum at the bottom", () => {
    const range = { min: 90, max: 130 };
    expect(priceToY(130, range, PLOT)).toBeCloseTo(PLOT.top);
    expect(priceToY(90, range, PLOT)).toBeCloseTo(PLOT.top + PLOT.height);
  });

  it("centres a zero-span range rather than dividing by zero", () => {
    const y = priceToY(100, { min: 100, max: 100 }, PLOT);
    expect(y).toBe(PLOT.top + PLOT.height / 2);
    expect(Number.isNaN(y)).toBe(false);
  });
});

describe("priceRangeFor", () => {
  it("covers every high and low in view", () => {
    const range = priceRangeFor(makeCandles(30))!;
    expect(range.min).toBeLessThanOrEqual(99);
    expect(range.max).toBeGreaterThanOrEqual(131);
  });

  it("gives a flat series a non-zero span", () => {
    const flat: Candle[] = Array.from({ length: 5 }, (_, i) => ({
      time: i,
      open: rupeesToPrice(100),
      high: rupeesToPrice(100),
      low: rupeesToPrice(100),
      close: rupeesToPrice(100),
      volume: 1,
    }));

    const range = priceRangeFor(flat)!;
    expect(range.max).toBeGreaterThan(range.min);
  });

  it("returns null for no candles", () => {
    expect(priceRangeFor([])).toBeNull();
  });

  it("widens to fit extra series", () => {
    const extended = extendRange({ min: 100, max: 110 }, [null, 95, 130]);
    expect(extended).toEqual({ min: 95, max: 130 });
  });
});

describe("candleAtX", () => {
  const candles = makeCandles(200);
  const viewport = { offset: 50, visibleCount: 50 };

  it("finds the candle under the pointer", () => {
    const x = indexToX(70, viewport, PLOT);
    expect(candleAtX(x, candles, viewport, PLOT)?.index).toBe(70);
  });

  it("returns null outside the plot", () => {
    expect(candleAtX(-20, candles, viewport, PLOT)).toBeNull();
    expect(candleAtX(PLOT.width + 40, candles, viewport, PLOT)).toBeNull();
  });

  it("never selects a candle scrolled off-screen", () => {
    for (let x = PLOT.left; x <= PLOT.left + PLOT.width; x += 7) {
      const hit = candleAtX(x, candles, viewport, PLOT);
      if (!hit) continue;
      expect(hit.index).toBeGreaterThanOrEqual(50);
      expect(hit.index).toBeLessThanOrEqual(99);
    }
  });

  it("returns null when there are no candles", () => {
    expect(candleAtX(100, [], viewport, PLOT)).toBeNull();
  });
});

describe("viewportAtEnd", () => {
  it("pins to the newest candle", () => {
    const viewport = viewportAtEnd(500, 80);
    expect(viewport.offset + viewport.visibleCount).toBe(500);
    expect(isAtRightEdge(viewport, 500)).toBe(true);
  });

  it("is not at the right edge once panned back", () => {
    expect(isAtRightEdge({ offset: 100, visibleCount: 50 }, 500)).toBe(false);
  });
});

describe("niceTicks", () => {
  it("produces round numbers inside the range", () => {
    const ticks = niceTicks({ min: 97.3, max: 132.8 }, 5);
    expect(ticks.length).toBeGreaterThan(2);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(97.3);
      expect(tick).toBeLessThanOrEqual(132.8);
    }
  });

  it("does not accumulate float drift", () => {
    for (const tick of niceTicks({ min: 0, max: 1 }, 10)) {
      expect(tick.toString().replace("-", "").split(".")[1]?.length ?? 0).toBeLessThan(8);
    }
  });

  it("returns nothing for a degenerate range", () => {
    expect(niceTicks({ min: 5, max: 5 })).toEqual([]);
  });
});

/*
  Wheel zoom.

  These exist because the zoom read only the *sign* of `deltaY` and applied a
  fixed 18% step per event. A mouse notch is one event so it felt about right;
  a trackpad fires a stream of small-delta events, so an ordinary two-finger
  swipe compounded to well over 100×. The property that was missing is simply
  that a bigger movement should zoom more than a smaller one.
*/
describe("wheelDeltaToPixels", () => {
  it("passes pixel deltas through, as a trackpad reports them", () => {
    expect(wheelDeltaToPixels(3, 0)).toBe(3);
    expect(wheelDeltaToPixels(-3, 0)).toBe(-3);
  });

  it("scales line deltas, as a mouse wheel reports them", () => {
    // Three lines is the usual notch; raw it would look like a 3px nudge.
    expect(wheelDeltaToPixels(3, 1)).toBe(48);
  });

  it("scales page deltas", () => {
    expect(wheelDeltaToPixels(1, 2)).toBe(60); // clamped down from 400
  });

  it("clamps a single outsized event so it cannot jump", () => {
    expect(wheelDeltaToPixels(4000, 0)).toBe(60);
    expect(wheelDeltaToPixels(-4000, 0)).toBe(-60);
  });

  it("is proportional to the movement — the property the old zoom lacked", () => {
    const small = Math.abs(wheelDeltaToPixels(2, 0));
    const large = Math.abs(wheelDeltaToPixels(40, 0));
    expect(large).toBeGreaterThan(small * 10);
  });

  it("keeps direction", () => {
    expect(wheelDeltaToPixels(10, 0)).toBeGreaterThan(0);
    expect(wheelDeltaToPixels(-10, 0)).toBeLessThan(0);
  });
});

describe("clampVisibleCount", () => {
  it("holds the span within the permitted range", () => {
    expect(clampVisibleCount(1, 500)).toBe(MIN_VISIBLE_CANDLES);
    expect(clampVisibleCount(100_000, 500)).toBe(MAX_VISIBLE_CANDLES);
  });

  it("never asks for more candles than exist", () => {
    expect(clampVisibleCount(300, 80)).toBe(80);
  });

  it("does not round, so a fractional span survives", () => {
    expect(clampVisibleCount(61.4, 500)).toBeCloseTo(61.4);
  });
});

describe("zoomToCount", () => {
  const wide = { offset: 100, visibleCount: 100 };

  it("holds the candle under the cursor in place", () => {
    for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
      const anchorBefore = wide.offset + wide.visibleCount * ratio;
      const next = zoomToCount(wide, 500, 50, ratio);
      const anchorAfter = next.offset + next.visibleCount * ratio;
      expect(Math.abs(anchorAfter - anchorBefore)).toBeLessThanOrEqual(1);
    }
  });

  it("respects both zoom limits", () => {
    expect(zoomToCount(wide, 500, 1, 0.5).visibleCount).toBe(MIN_VISIBLE_CANDLES);
    expect(zoomToCount(wide, 500, 99_999, 0.5).visibleCount).toBe(MAX_VISIBLE_CANDLES);
  });

  it("accumulates small steps instead of rounding them away", () => {
    /*
      The reason the span is carried fractionally. At a 12-candle span a 2%
      step is 0.24 of a candle; rounding every step would return 12 forever and
      the chart would appear stuck at maximum zoom.
    */
    let span = 40;
    for (let i = 0; i < 25; i += 1) span = clampVisibleCount(span * 1.02, 500);

    expect(span).toBeGreaterThan(60);
    expect(zoomToCount(wide, 500, span, 0.5).visibleCount).toBeGreaterThan(60);
  });

  it("is reversible — equal and opposite zoom returns the same span", () => {
    const zoomedIn = clampVisibleCount(90 * Math.exp(-60 * 0.0022), 500);
    const backOut = clampVisibleCount(zoomedIn * Math.exp(60 * 0.0022), 500);
    expect(backOut).toBeCloseTo(90, 6);
  });

  it("makes a burst of small steps equal one large step", () => {
    // What lets a frame coalesce many wheel events without changing the result.
    const together = clampVisibleCount(90 * Math.exp(30 * 0.0022), 500);

    let apart = 90;
    for (let i = 0; i < 30; i += 1) apart = clampVisibleCount(apart * Math.exp(1 * 0.0022), 500);

    expect(apart).toBeCloseTo(together, 6);
  });

  it("gives a mouse notch a controlled step, not a leap", () => {
    const notch = wheelDeltaToPixels(3, 1); // 48px
    const after = clampVisibleCount(90 * Math.exp(notch * 0.0022), 500);
    const change = after / 90;

    expect(change).toBeGreaterThan(1.05);
    expect(change).toBeLessThan(1.2);
  });

  it("gives a trackpad twitch a far smaller step than a notch", () => {
    const twitch = wheelDeltaToPixels(2, 0);
    const notch = wheelDeltaToPixels(3, 1);

    const afterTwitch = 90 * Math.exp(twitch * 0.0022);
    const afterNotch = 90 * Math.exp(notch * 0.0022);

    expect(afterTwitch - 90).toBeLessThan((afterNotch - 90) / 10);
  });

  it("stays within limits across a long gesture in either direction", () => {
    let span = 90;
    for (let i = 0; i < 400; i += 1) span = clampVisibleCount(span * Math.exp(-60 * 0.0022), 500);
    expect(span).toBe(MIN_VISIBLE_CANDLES);

    for (let i = 0; i < 400; i += 1) span = clampVisibleCount(span * Math.exp(60 * 0.0022), 500);
    expect(span).toBe(MAX_VISIBLE_CANDLES);
  });
});
