/**
 * Technical indicator engine.
 *
 * Pure functions over closing prices, kept away from any chart or component so
 * the strategy engine and the backtester can call exactly the same maths the
 * chart draws. A second implementation anywhere would let a strategy fire on an
 * RSI the user never saw.
 *
 * Conventions:
 *  - Input is a plain `number[]` of prices in rupees. Indicators are ratios and
 *    averages, so they do not need the integer-paise treatment money does.
 *  - Output arrays are always the same length as the input. Positions with
 *    insufficient look-back are `null`, never 0 and never silently dropped —
 *    a 0 would plot as a real value and imply a signal that does not exist.
 */

export type Series = readonly (number | null)[];

/** Simple moving average. */
export function sma(values: readonly number[], period: number): Series {
  if (period <= 0) throw new RangeError(`SMA period must be positive, received ${period}`);

  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i += 1) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }

  return out;
}

/**
 * Exponential moving average.
 *
 * Seeded with the SMA of the first `period` values — the conventional seeding,
 * and the reason the first `period - 1` slots are null rather than ramping up
 * from the first price.
 */
export function ema(values: readonly number[], period: number): Series {
  if (period <= 0) throw new RangeError(`EMA period must be positive, received ${period}`);

  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;

  const multiplier = 2 / (period + 1);

  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i]!;
  let previous = seed / period;
  out[period - 1] = previous;

  for (let i = period; i < values.length; i += 1) {
    previous = (values[i]! - previous) * multiplier + previous;
    out[i] = previous;
  }

  return out;
}

/**
 * Relative Strength Index, using Wilder's smoothing.
 *
 * Wilder's original method, not a simple average of gains and losses — the two
 * diverge quickly and the smoothed version is what every platform plots.
 */
export function rsi(values: readonly number[], period = 14): Series {
  if (period <= 0) throw new RangeError(`RSI period must be positive, received ${period}`);

  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= period; i += 1) {
    const delta = values[i]! - values[i - 1]!;
    if (delta >= 0) gainSum += delta;
    else lossSum -= delta;
  }

  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;
  out[period] = toRsi(averageGain, averageLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i]! - values[i - 1]!;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    out[i] = toRsi(averageGain, averageLoss);
  }

  return out;
}

function toRsi(averageGain: number, averageLoss: number): number {
  // No losses across the window means maximum strength; guard the divide.
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  readonly macd: Series;
  readonly signal: Series;
  /** macd − signal. The bars in the MACD pane. */
  readonly histogram: Series;
}

/**
 * MACD.
 *
 * The signal line is an EMA *of the MACD line*, which only exists from the slow
 * period onward — so the signal EMA is seeded from that offset rather than from
 * the start of the price series, which would shift it earlier than it belongs.
 */
export function macd(
  values: readonly number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult {
  if (fastPeriod >= slowPeriod) {
    throw new RangeError("MACD fast period must be shorter than the slow period");
  }

  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);

  const macdLine: (number | null)[] = values.map((_, i) => {
    const f = fast[i];
    const s = slow[i];
    return f === null || f === undefined || s === null || s === undefined ? null : f - s;
  });

  const firstIndex = macdLine.findIndex((value) => value !== null);
  const signalLine: (number | null)[] = new Array(values.length).fill(null);
  const histogram: (number | null)[] = new Array(values.length).fill(null);

  if (firstIndex >= 0) {
    const dense = macdLine.slice(firstIndex) as number[];
    const signalDense = ema(dense, signalPeriod);

    for (let i = 0; i < signalDense.length; i += 1) {
      const value = signalDense[i];
      if (value === null || value === undefined) continue;
      const target = firstIndex + i;
      signalLine[target] = value;
      histogram[target] = (macdLine[target] as number) - value;
    }
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

export interface BollingerResult {
  readonly middle: Series;
  readonly upper: Series;
  readonly lower: Series;
}

/**
 * Bollinger Bands.
 *
 * Uses the population standard deviation over the window, which is the standard
 * definition — the sample form (n−1) produces visibly wider bands.
 */
export function bollingerBands(
  values: readonly number[],
  period = 20,
  deviations = 2,
): BollingerResult {
  const middle = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);

  for (let i = 0; i < values.length; i += 1) {
    const mean = middle[i];
    if (mean === null || mean === undefined) continue;

    let squaredSum = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const delta = values[j]! - mean;
      squaredSum += delta * delta;
    }

    const stdDev = Math.sqrt(squaredSum / period);
    upper[i] = mean + stdDev * deviations;
    lower[i] = mean - stdDev * deviations;
  }

  return { middle, upper, lower };
}

/** Highest and lowest non-null values in a set of series, for pane scaling. */
export function seriesExtent(...series: Series[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let found = false;

  for (const list of series) {
    for (const value of list) {
      if (value === null || value === undefined || !Number.isFinite(value)) continue;
      found = true;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  return found ? { min, max } : null;
}
