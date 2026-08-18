/**
 * Equity-curve series maths.
 *
 * Pure: no canvas, no DOM, no React. The performance chart's honesty lives
 * here — every value this module emits is either a point the server actually
 * recorded, or the *carry-forward* of one. Nothing is interpolated between two
 * different values and nothing is invented to fill an empty window, because a
 * plausible-looking line that is not a record of anything is exactly what this
 * codebase refuses to draw.
 */

/** A recorded equity point. `value` is in paise, `time` epoch milliseconds. */
export interface EquityPoint {
  readonly time: number;
  readonly value: number;
}

export type EquityRange = "1D" | "1W" | "1M" | "3M" | "1Y";

export const EQUITY_RANGES: readonly EquityRange[] = ["1D", "1W", "1M", "3M", "1Y"];

const DAY = 86_400_000;

export const RANGE_WINDOW_MS: Record<EquityRange, number> = {
  "1D": DAY,
  "1W": 7 * DAY,
  "1M": 30 * DAY,
  "3M": 91 * DAY,
  "1Y": 365 * DAY,
};

/**
 * A point as the chart will draw it.
 *
 * `carried` marks the two synthetic ends — the window's left edge and "now".
 * They hold the value of the nearest real point on their side, so the line has
 * something to start and finish on without claiming a trade happened there.
 * The tooltip reads this flag and labels those points differently.
 */
export interface SeriesPoint extends EquityPoint {
  readonly carried: boolean;
}

export interface WindowOptions {
  /** Window start, epoch ms. */
  readonly from: number;
  /** Window end — normally "now". */
  readonly to: number;
  /**
   * The account's live total value, in paise. Appended as the closing point so
   * the curve terminates on the figure the hero shows. Null when unknown, in
   * which case the last recorded value is carried instead.
   */
  readonly liveValue: number | null;
}

/**
 * The points that fall inside a window, with both ends anchored.
 *
 * Returns fewer than two points only when there is genuinely nothing to draw.
 */
export function windowSeries(
  points: readonly EquityPoint[],
  { from, to, liveValue }: WindowOptions,
): readonly SeriesPoint[] {
  if (points.length === 0) return [];

  const series: SeriesPoint[] = [];

  /*
    The last point recorded *before* the window opens. Without it a range with
    no trades in it (a quiet week on a months-old account) would have no line
    at all, when the truthful answer is a flat one at the equity the account
    already had.
  */
  let preceding: EquityPoint | null = null;
  for (const point of points) {
    if (point.time < from) preceding = point;
    else break;
  }

  if (preceding) series.push({ time: from, value: preceding.value, carried: true });

  for (const point of points) {
    if (point.time < from || point.time > to) continue;
    series.push({ time: point.time, value: point.value, carried: false });
  }

  if (series.length === 0) return [];

  const lastRecorded = series[series.length - 1]!;
  const closing = liveValue ?? lastRecorded.value;

  // Only add a closing point if it says something the last one does not.
  if (to > lastRecorded.time || closing !== lastRecorded.value) {
    series.push({ time: Math.max(to, lastRecorded.time), value: closing, carried: true });
  }

  return series.length >= 2 ? series : [];
}

/**
 * Cap the point count without flattening the shape.
 *
 * Straight stride sampling drops the extremes, so a drawdown can vanish from
 * the picture entirely. This keeps the first and last points and, per bucket,
 * both the highest and the lowest — the two that define the envelope — in
 * chronological order.
 */
export function downsample(
  series: readonly SeriesPoint[],
  maxPoints: number,
): readonly SeriesPoint[] {
  if (series.length <= maxPoints || maxPoints < 4) return series;

  // Two of the budget are spent on the first and last points, and each bucket
  // can contribute two, so the cap holds exactly rather than approximately.
  const buckets = Math.floor((maxPoints - 2) / 2);
  const size = series.length / buckets;
  const kept: SeriesPoint[] = [series[0]!];

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.max(1, Math.floor(bucket * size));
    const end = Math.min(series.length - 1, Math.floor((bucket + 1) * size));
    if (start >= end) continue;

    let lowest = series[start]!;
    let highest = series[start]!;
    for (let i = start; i < end; i += 1) {
      const point = series[i]!;
      if (point.value < lowest.value) lowest = point;
      if (point.value > highest.value) highest = point;
    }

    const [first, second] = lowest.time <= highest.time ? [lowest, highest] : [highest, lowest];

    if (first !== kept[kept.length - 1]) kept.push(first);
    if (second !== first) kept.push(second);
  }

  kept.push(series[series.length - 1]!);
  return kept;
}

export interface SeriesExtent {
  readonly minTime: number;
  readonly maxTime: number;
  readonly minValue: number;
  readonly maxValue: number;
}

export function extentOf(series: readonly SeriesPoint[]): SeriesExtent | null {
  if (series.length === 0) return null;

  let minValue = Infinity;
  let maxValue = -Infinity;
  for (const point of series) {
    if (point.value < minValue) minValue = point.value;
    if (point.value > maxValue) maxValue = point.value;
  }

  return {
    minTime: series[0]!.time,
    maxTime: series[series.length - 1]!.time,
    minValue,
    maxValue,
  };
}

/**
 * Pad a flat or near-flat range so the line does not sit on the frame.
 *
 * A perfectly flat equity curve — an account that has booked nothing — has a
 * zero span, which would divide by zero in the scale. Padding by a fraction of
 * the level centres it instead.
 */
export function paddedRange(
  minValue: number,
  maxValue: number,
  padRatio = 0.12,
): { min: number; max: number } {
  const span = maxValue - minValue;

  if (span <= 0) {
    const level = Math.abs(maxValue);
    const pad = level > 0 ? level * 0.02 : 1;
    return { min: minValue - pad, max: maxValue + pad };
  }

  const pad = span * padRatio;
  return { min: minValue - pad, max: maxValue + pad };
}

/**
 * Index of the point nearest a time, by binary search.
 *
 * Used by the crosshair on every pointer move, so it must not be a scan: a
 * year of trades is thousands of points and a linear search per mousemove is
 * how a chart starts feeling heavy.
 */
export function nearestIndex(series: readonly SeriesPoint[], time: number): number {
  if (series.length === 0) return -1;

  let low = 0;
  let high = series.length - 1;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (series[mid]!.time < time) low = mid + 1;
    else high = mid;
  }

  const after = series[low]!;
  const before = series[Math.max(0, low - 1)]!;
  return Math.abs(after.time - time) < Math.abs(time - before.time) ? low : Math.max(0, low - 1);
}

/**
 * Monotone cubic control points for a smooth line that cannot overshoot.
 *
 * A plain Catmull-Rom curve looks smoother but invents movement: between two
 * equal values it bulges, so a flat stretch of equity would appear to dip and
 * recover. Monotone interpolation is the version of "smooth" that stays true
 * to the data — the curve is flat where the data is flat and never travels
 * outside the values on either side of it.
 */
export function monotoneControlPoints(
  xs: readonly number[],
  ys: readonly number[],
): { c1x: number[]; c1y: number[]; c2x: number[]; c2y: number[] } {
  const n = xs.length;
  const slopes: number[] = [];
  const tangents: number[] = new Array<number>(n).fill(0);

  for (let i = 0; i < n - 1; i += 1) {
    const dx = xs[i + 1]! - xs[i]!;
    slopes.push(dx === 0 ? 0 : (ys[i + 1]! - ys[i]!) / dx);
  }

  tangents[0] = slopes[0] ?? 0;
  tangents[n - 1] = slopes[n - 2] ?? 0;

  for (let i = 1; i < n - 1; i += 1) {
    const previous = slopes[i - 1]!;
    const next = slopes[i]!;
    // A sign change is a local extremum: a zero tangent is what stops the
    // curve from sailing past the point it should turn at.
    tangents[i] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }

  for (let i = 0; i < n - 1; i += 1) {
    const slope = slopes[i]!;
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    // Fritsch–Carlson limiter: keeps each tangent inside the circle of radius
    // 3 about the segment slope, which is the condition for no overshoot.
    const alpha = tangents[i]! / slope;
    const beta = tangents[i + 1]! / slope;
    const magnitude = Math.hypot(alpha, beta);
    if (magnitude > 3) {
      tangents[i] = (3 / magnitude) * alpha * slope;
      tangents[i + 1] = (3 / magnitude) * beta * slope;
    }
  }

  const c1x: number[] = [];
  const c1y: number[] = [];
  const c2x: number[] = [];
  const c2y: number[] = [];

  for (let i = 0; i < n - 1; i += 1) {
    const dx = (xs[i + 1]! - xs[i]!) / 3;
    c1x.push(xs[i]! + dx);
    c1y.push(ys[i]! + tangents[i]! * dx);
    c2x.push(xs[i + 1]! - dx);
    c2y.push(ys[i + 1]! - tangents[i + 1]! * dx);
  }

  return { c1x, c1y, c2x, c2y };
}
