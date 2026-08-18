import type { CandleInterval } from "@/domain/market";

/** Which overlays and panes the chart is showing. */
export interface IndicatorSettings {
  volume: boolean;
  ma1: boolean;
  ma1Period: number;
  ma2: boolean;
  ma2Period: number;
  bollinger: boolean;
  bollingerPeriod: number;
  rsi: boolean;
  rsiPeriod: number;
  macd: boolean;
}

export const DEFAULT_INDICATORS: IndicatorSettings = {
  volume: true,
  ma1: true,
  ma1Period: 20,
  ma2: true,
  ma2Period: 50,
  bollinger: false,
  bollingerPeriod: 20,
  rsi: false,
  rsiPeriod: 14,
  macd: false,
};

export interface TimeframeOption {
  readonly id: string;
  readonly label: string;
  readonly interval: CandleInterval;
  /** How far back the window reaches, in milliseconds. */
  readonly spanMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Timeframes, each pairing a lookback window with a bar size that yields a
 * readable number of candles — roughly 100–400 rather than 5 or 20,000.
 */
export const TIMEFRAMES: readonly TimeframeOption[] = [
  { id: "1D", label: "1D", interval: "5m", spanMs: DAY },
  { id: "1W", label: "1W", interval: "15m", spanMs: 7 * DAY },
  { id: "1M", label: "1M", interval: "1h", spanMs: 30 * DAY },
  { id: "3M", label: "3M", interval: "1h", spanMs: 90 * DAY },
  { id: "1Y", label: "1Y", interval: "1d", spanMs: 365 * DAY },
  { id: "5Y", label: "5Y", interval: "1d", spanMs: 5 * 365 * DAY },
];

export const DEFAULT_TIMEFRAME = TIMEFRAMES[2]!;
