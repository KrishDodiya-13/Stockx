/**
 * Chart geometry.
 *
 * Everything here is pure: viewport arithmetic, scales and hit-testing, with no
 * canvas or DOM. The interaction bugs that make a chart feel cheap — panning
 * past the data, zoom that drifts away from the cursor, a crosshair that snaps
 * to the wrong candle near the edges — are all failures of this maths, so it is
 * separated out where it can be tested directly.
 */

import type { Candle } from "@/domain/market";
import { priceToRupees } from "@/lib/money";

/** Smallest and largest number of candles that may fill the viewport. */
export const MIN_VISIBLE_CANDLES = 12;
export const MAX_VISIBLE_CANDLES = 400;

export interface Viewport {
  /** Index of the first visible candle. May be fractional while panning. */
  readonly offset: number;
  /** How many candles span the plot width. */
  readonly visibleCount: number;
}

export interface PlotArea {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface PriceRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Constrain a viewport to the data.
 *
 * Clamping the count *before* the offset matters: a zoom-out that overshoots
 * the dataset must first be capped, otherwise the offset is clamped against a
 * stale span and the chart lands scrolled away from the end.
 */
export function clampViewport(viewport: Viewport, candleCount: number): Viewport {
  if (candleCount <= 0) return { offset: 0, visibleCount: 0 };

  const visibleCount = Math.min(
    Math.max(Math.round(viewport.visibleCount), MIN_VISIBLE_CANDLES),
    Math.min(MAX_VISIBLE_CANDLES, candleCount),
  );

  const maxOffset = Math.max(0, candleCount - visibleCount);
  const offset = Math.min(Math.max(viewport.offset, 0), maxOffset);

  return { offset, visibleCount };
}

/** A viewport showing the most recent `count` candles. */
export function viewportAtEnd(candleCount: number, count: number): Viewport {
  return clampViewport({ offset: candleCount - count, visibleCount: count }, candleCount);
}

/** True when the viewport is pinned to the newest candle. */
export function isAtRightEdge(viewport: Viewport, candleCount: number): boolean {
  return Math.round(viewport.offset + viewport.visibleCount) >= candleCount;
}

/**
 * Zoom about a fixed horizontal position.
 *
 * `anchorRatio` is where the cursor sits across the plot (0 = left, 1 = right).
 * Holding the candle under the cursor still is what makes wheel-zoom feel
 * attached to the data rather than to the viewport.
 */
export function zoomViewport(
  viewport: Viewport,
  candleCount: number,
  factor: number,
  anchorRatio: number,
): Viewport {
  return zoomToCount(viewport, candleCount, viewport.visibleCount * factor, anchorRatio);
}

/**
 * The permitted span, as a continuous range.
 *
 * Separate from `clampViewport` because that rounds, and a zoom that
 * accumulates needs to clamp *before* rounding — otherwise a run of small
 * increments is repeatedly rounded back to where it started and the zoom
 * appears stuck.
 */
export function clampVisibleCount(count: number, candleCount: number): number {
  const upper = Math.min(MAX_VISIBLE_CANDLES, Math.max(candleCount, MIN_VISIBLE_CANDLES));
  return Math.min(Math.max(count, MIN_VISIBLE_CANDLES), upper);
}

/**
 * Zoom to an exact span, holding the candle under `anchorRatio` in place.
 *
 * Takes a target count rather than a multiplier so a caller can carry a
 * *fractional* span between events. Wheel zoom needs that: with a small
 * per-event step, rounding at every event quantises the change away — at a
 * 12-candle span a 2% step rounds straight back to 12 and the chart never
 * moves. Accumulating the fraction and rounding only for display keeps small
 * movements meaningful.
 */
export function zoomToCount(
  viewport: Viewport,
  candleCount: number,
  targetCount: number,
  anchorRatio: number,
): Viewport {
  const ratio = Math.min(Math.max(anchorRatio, 0), 1);
  const anchorIndex = viewport.offset + viewport.visibleCount * ratio;
  const clampedCount = clampVisibleCount(targetCount, candleCount);

  return clampViewport(
    { offset: anchorIndex - clampedCount * ratio, visibleCount: clampedCount },
    candleCount,
  );
}

/**
 * Convert a wheel event's delta into pixels.
 *
 * `deltaY` is only meaningful alongside `deltaMode`: a trackpad reports pixels,
 * a mouse wheel usually reports lines, and some configurations report pages.
 * Reading `deltaY` raw — as the previous zoom did — makes one mouse notch and
 * one trackpad twitch look identical, which is why a small gesture zoomed as
 * hard as a deliberate one.
 *
 * The result is clamped so a single outsized event (some mice emit several
 * hundred pixels per notch) cannot produce a jump.
 */
export function wheelDeltaToPixels(deltaY: number, deltaMode: number, maxStep = 60): number {
  const LINE_PX = 16;
  const PAGE_PX = 400;

  const pixels =
    deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY;

  return Math.min(Math.max(pixels, -maxStep), maxStep);
}

/** Pan by a pixel delta. Dragging right moves the chart back in time. */
export function panViewport(
  viewport: Viewport,
  candleCount: number,
  deltaPx: number,
  plotWidth: number,
): Viewport {
  if (plotWidth <= 0) return viewport;

  const candlesPerPixel = viewport.visibleCount / plotWidth;
  return clampViewport(
    { offset: viewport.offset - deltaPx * candlesPerPixel, visibleCount: viewport.visibleCount },
    candleCount,
  );
}

/** The candles currently in view, plus the index they start at. */
export function visibleSlice(
  candles: readonly Candle[],
  viewport: Viewport,
): { candles: readonly Candle[]; startIndex: number } {
  const startIndex = Math.max(0, Math.floor(viewport.offset));
  const endIndex = Math.min(candles.length, Math.ceil(viewport.offset + viewport.visibleCount));
  return { candles: candles.slice(startIndex, endIndex), startIndex };
}

/**
 * Price range for the visible candles, with headroom.
 *
 * Padding is proportional, and a flat series falls back to a fixed spread so a
 * perfectly horizontal price does not collapse the scale to zero height.
 */
export function priceRangeFor(
  candles: readonly Candle[],
  paddingRatio = 0.08,
): PriceRange | null {
  if (candles.length === 0) return null;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const candle of candles) {
    const low = priceToRupees(candle.low);
    const high = priceToRupees(candle.high);
    if (low < min) min = low;
    if (high > max) max = high;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  const span = max - min;
  const padding = span === 0 ? Math.max(max * 0.01, 0.5) : span * paddingRatio;

  return { min: min - padding, max: max + padding };
}

/** Widen a range so extra series (e.g. Bollinger bands) stay on screen. */
export function extendRange(range: PriceRange, values: readonly (number | null)[]): PriceRange {
  let { min, max } = range;

  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return { min, max };
}

/** Candle index → x pixel, at the centre of its slot. */
export function indexToX(index: number, viewport: Viewport, plot: PlotArea): number {
  const slot = plot.width / viewport.visibleCount;
  return plot.left + (index - viewport.offset) * slot + slot / 2;
}

/** x pixel → candle index. Fractional; round for a specific candle. */
export function xToIndex(x: number, viewport: Viewport, plot: PlotArea): number {
  const slot = plot.width / viewport.visibleCount;
  if (slot === 0) return viewport.offset;
  return viewport.offset + (x - plot.left - slot / 2) / slot;
}

/** Price → y pixel. Inverted, since canvas y grows downward. */
export function priceToY(price: number, range: PriceRange, plot: PlotArea): number {
  const span = range.max - range.min;
  if (span === 0) return plot.top + plot.height / 2;
  return plot.top + (1 - (price - range.min) / span) * plot.height;
}

/** y pixel → price. */
export function yToPrice(y: number, range: PriceRange, plot: PlotArea): number {
  const span = range.max - range.min;
  return range.min + (1 - (y - plot.top) / plot.height) * span;
}

/** Pixel width of one candle body, leaving a gap between slots. */
export function candleWidth(viewport: Viewport, plot: PlotArea): number {
  const slot = plot.width / viewport.visibleCount;
  // Never thinner than a hairline, or dense views render nothing at all.
  return Math.max(1, Math.min(slot * 0.68, 22));
}

/**
 * Nearest candle to a pointer position, or null if the pointer is outside the
 * data. Clamped to the visible range so the crosshair cannot latch onto a
 * candle scrolled off-screen.
 */
export function candleAtX(
  x: number,
  candles: readonly Candle[],
  viewport: Viewport,
  plot: PlotArea,
): { index: number; candle: Candle } | null {
  if (candles.length === 0) return null;
  if (x < plot.left || x > plot.left + plot.width) return null;

  const raw = Math.round(xToIndex(x, viewport, plot));
  const lastVisible = Math.min(
    candles.length - 1,
    Math.ceil(viewport.offset + viewport.visibleCount) - 1,
  );
  const firstVisible = Math.max(0, Math.floor(viewport.offset));

  const index = Math.min(Math.max(raw, firstVisible), lastVisible);
  const candle = candles[index];

  return candle ? { index, candle } : null;
}

/**
 * "Nice" axis ticks — steps of 1, 2, 2.5 or 5 × a power of ten, so labels read
 * as round numbers instead of arbitrary fractions of the range.
 */
export function niceTicks(range: PriceRange, target = 5): number[] {
  const span = range.max - range.min;
  if (span <= 0 || !Number.isFinite(span)) return [];

  const rough = span / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;

  const step =
    (normalised >= 5 ? 5 : normalised >= 2.5 ? 2.5 : normalised >= 2 ? 2 : 1) * magnitude;

  const ticks: number[] = [];
  const first = Math.ceil(range.min / step) * step;

  for (let value = first; value <= range.max; value += step) {
    // Re-round to kill float drift from repeated addition.
    ticks.push(Number(value.toFixed(10)));
  }

  return ticks;
}
