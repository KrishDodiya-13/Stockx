/**
 * Time Machine session engine.
 *
 * Pure state machine for a historical trading session: a simulation clock, a
 * progressively revealed candle series, a session-local portfolio, and the
 * closing report. No clock of its own, no I/O — the caller drives it forward.
 *
 * ── Future data ────────────────────────────────────────────────────────────
 *
 * The session holds *only* the bars it has revealed. `revealed` grows one bar
 * at a time as the clock advances, and every consumer — the chart, the price
 * readout, the trading panel, any strategy running inside the session — reads
 * from that array. Nothing in this module can see a bar it has not reached,
 * because unrevealed bars are not in the structure at all.
 *
 * The server supplies bars clamped to the session clock, so future candles do
 * not reach the browser either. What that cannot prevent is a determined user
 * querying the ordinary historical price API by hand — that data is public
 * within the app, and this is not a cheat-proof exam. The guarantee is that a
 * session never *acts* on data it has not reached.
 *
 * ── The account ────────────────────────────────────────────────────────────
 *
 * A session trades a sandbox, not the real paper account. Historical trades
 * mixed into a live balance would make both meaningless. Fills reuse
 * `applyFill`, so the cost-basis and P&L maths are the same everywhere.
 */

import type { Candle } from "@/domain/market";
import type { Holding } from "@/domain/trading";
import {
  addPaise,
  notional,
  percentChange,
  priceToRupees,
  subPaise,
  ZERO_PAISE,
  type Paise,
  type PriceE4,
} from "@/lib/money";
import { applyFill } from "@/services/trading/trading-engine";

export type SessionStatus = "idle" | "running" | "paused" | "finished";

export type PlaybackSpeed = 1 | 2 | 3 | 5 | 10;

/**
 * The order they appear in the transport. `tickInterval` derives the real
 * cadence from the multiplier, so adding one here is all a new speed needs —
 * there is a single playback loop and it reads this value.
 */
export const SPEEDS: readonly PlaybackSpeed[] = [1, 2, 3, 5, 10];

export interface SessionTrade {
  readonly time: number;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: PriceE4;
  /** Booked P&L, for sells. Zero on a buy. */
  readonly realisedPnl: Paise;
}

export interface SessionState {
  readonly status: SessionStatus;
  /** Bars revealed so far, oldest first. Never contains a future bar. */
  readonly revealed: readonly Candle[];
  /** Index of the next bar to reveal. Equals `total` when finished. */
  readonly cursor: number;
  /** Total bars in the session. Known up front; their *values* are not. */
  readonly total: number;
  readonly speed: PlaybackSpeed;

  readonly startingCapital: Paise;
  readonly cash: Paise;
  readonly holding: Holding | null;
  readonly realisedPnl: Paise;

  readonly trades: readonly SessionTrade[];
  /** Session equity at each revealed bar, for the report's curve. */
  readonly equityCurve: readonly { time: number; equity: Paise }[];
}

export function createSession(
  startingCapital: Paise,
  total: number,
  speed: PlaybackSpeed = 1,
): SessionState {
  return {
    status: "idle",
    revealed: [],
    cursor: 0,
    total,
    speed,
    startingCapital,
    cash: startingCapital,
    holding: null,
    realisedPnl: ZERO_PAISE,
    trades: [],
    equityCurve: [],
  };
}

/** The bar the session is currently standing on, or null before it starts. */
export function currentCandle(state: SessionState): Candle | null {
  return state.revealed[state.revealed.length - 1] ?? null;
}

export function currentPrice(state: SessionState): PriceE4 | null {
  return currentCandle(state)?.close ?? null;
}

/** Cash plus the position marked at the latest revealed close. */
export function sessionEquity(state: SessionState): Paise {
  const price = currentPrice(state);
  if (state.holding === null || price === null) return state.cash;
  return addPaise(state.cash, notional(price, state.holding.quantity));
}

/**
 * Reveal the next bar.
 *
 * The single place the session learns anything new. A caller that has not been
 * handed the bar cannot advance, which is what keeps the reveal honest: the
 * engine never reaches into a fuller series to find the next value.
 */
export function revealNext(state: SessionState, candle: Candle): SessionState {
  if (state.cursor >= state.total) return { ...state, status: "finished" };

  const revealed = [...state.revealed, candle];
  const cursor = state.cursor + 1;

  const equity =
    state.holding === null
      ? state.cash
      : addPaise(state.cash, notional(candle.close, state.holding.quantity));

  return {
    ...state,
    revealed,
    cursor,
    status: cursor >= state.total ? "finished" : state.status,
    equityCurve: [...state.equityCurve, { time: candle.time, equity }],
  };
}

export type OrderRejection =
  | "no-price"
  | "invalid-quantity"
  | "insufficient-funds"
  | "insufficient-shares"
  | "session-finished";

export interface OrderOutcome {
  readonly ok: boolean;
  readonly state: SessionState;
  readonly rejection: OrderRejection | null;
  readonly message: string | null;
}

/**
 * Place a market order at the current revealed price.
 *
 * Fills at the close of the bar the session is standing on — never at a later
 * bar, which is the only price a participant at that moment could have got.
 */
export function placeSessionOrder(
  state: SessionState,
  side: "BUY" | "SELL",
  quantity: number,
): OrderOutcome {
  const price = currentPrice(state);

  if (price === null) {
    return reject(state, "no-price", "The session has not reached a price yet.");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return reject(state, "invalid-quantity", "Quantity must be a whole number above zero.");
  }

  if (side === "BUY") {
    if (notional(price, quantity) > state.cash) {
      return reject(state, "insufficient-funds", "That order costs more than the session's cash.");
    }
  } else {
    const owned = state.holding?.quantity ?? 0;
    if (owned === 0) return reject(state, "insufficient-shares", "Nothing is held to sell.");
    if (quantity > owned) {
      return reject(
        state,
        "insufficient-shares",
        `Only ${owned.toLocaleString("en-IN")} shares are held.`,
      );
    }
  }

  const fill = applyFill(state.holding, state.cash, side, quantity, price);
  const candle = currentCandle(state)!;

  return {
    ok: true,
    rejection: null,
    message: null,
    state: {
      ...state,
      cash: fill.cashBalance,
      holding: fill.holding,
      realisedPnl: addPaise(state.realisedPnl, fill.realisedPnl),
      trades: [
        ...state.trades,
        {
          time: candle.time,
          side,
          quantity,
          price,
          realisedPnl: fill.realisedPnl,
        },
      ],
    },
  };
}

function reject(
  state: SessionState,
  rejection: OrderRejection,
  message: string,
): OrderOutcome {
  return { ok: false, state, rejection, message };
}

// --- report ----------------------------------------------------------------

export interface SessionReport {
  readonly startingCapital: Paise;
  readonly endingCapital: Paise;
  readonly totalReturn: Paise;
  readonly totalReturnPercent: number;

  /** Buy-and-hold over the same window, as a percent. */
  readonly benchmarkReturnPercent: number;
  /** Session return minus benchmark return, in percentage points. */
  readonly outperformancePercent: number;

  readonly maxDrawdown: Paise;
  readonly maxDrawdownPercent: number;

  readonly tradeCount: number;
  readonly winCount: number;
  readonly lossCount: number;
  readonly winRate: number;

  readonly barsElapsed: number;
}

/**
 * Close out the session and measure it.
 *
 * Any open position is marked at the final revealed close rather than being
 * force-sold: the session ended, it did not liquidate, and pretending otherwise
 * would book a trade the user never made.
 *
 * The benchmark is buy-and-hold of the same instrument across the same window —
 * the only comparison that isolates the user's decisions from the market's
 * direction. Outperformance is a difference in percentage points, not a ratio.
 */
export function buildReport(state: SessionState): SessionReport {
  const endingCapital = sessionEquity(state);
  const totalReturn = subPaise(endingCapital, state.startingCapital);

  const first = state.revealed[0];
  const last = state.revealed[state.revealed.length - 1];

  const benchmarkReturnPercent =
    first && last
      ? percentChange(priceToRupees(first.close), priceToRupees(last.close))
      : 0;

  const totalReturnPercent =
    state.startingCapital === 0 ? 0 : (totalReturn / state.startingCapital) * 100;

  // Peak-to-trough on session equity, not from the starting value.
  let peak = state.startingCapital;
  let maxDrawdown: Paise = ZERO_PAISE;
  let maxDrawdownPercent = 0;

  for (const point of state.equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const drawdown = subPaise(peak, point.equity);
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = peak === 0 ? 0 : -(drawdown / peak) * 100;
    }
  }

  // Only sells realise anything, so only they can win or lose.
  const closing = state.trades.filter((trade) => trade.side === "SELL");
  const wins = closing.filter((trade) => trade.realisedPnl > 0).length;
  const losses = closing.filter((trade) => trade.realisedPnl < 0).length;

  return {
    startingCapital: state.startingCapital,
    endingCapital,
    totalReturn,
    totalReturnPercent,
    benchmarkReturnPercent,
    outperformancePercent: totalReturnPercent - benchmarkReturnPercent,
    maxDrawdown,
    maxDrawdownPercent,
    tradeCount: state.trades.length,
    winCount: wins,
    lossCount: losses,
    winRate: closing.length === 0 ? 0 : (wins / closing.length) * 100,
    barsElapsed: state.revealed.length,
  };
}

/**
 * Real milliseconds between bar reveals at a given speed.
 *
 * 1× advances one bar per second, which reads as deliberate rather than
 * hurried; 10× is fast enough to cross a session quickly without the chart
 * becoming a blur.
 */
export function tickInterval(speed: PlaybackSpeed): number {
  return Math.round(1000 / speed);
}
