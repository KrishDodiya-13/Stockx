/**
 * Backtesting engine.
 *
 * Replays a strategy bar by bar over historical candles and reports what it
 * would have done. Pure and deterministic: same candles and same strategy give
 * the same result every time, with no clock, no database and no randomness.
 *
 * ── No future data ─────────────────────────────────────────────────────────
 *
 * The defining constraint. At bar `i` the engine may use candles 0…i and
 * nothing beyond. Two properties keep that true:
 *
 *  1. Every indicator used here is *causal* — SMA, EMA, Wilder's RSI, MACD and
 *     Bollinger Bands each depend only on values at or before the index they
 *     are read at. Computing them once over the whole series and reading index
 *     `i` is therefore mathematically identical to computing them over the
 *     prefix 0…i. `backtest-engine.test.ts` asserts that equivalence directly,
 *     so the property is proven rather than assumed.
 *
 *  2. The replay loop never reads `candles[i + 1]` or later. Fills happen at
 *     the close of the bar on which the condition became true — never at a
 *     later bar's price, and never at the bar's high or low, which would
 *     assume a perfect fill at the extreme.
 *
 * ── Honesty about fills ────────────────────────────────────────────────────
 *
 * Orders fill at the closing price of the triggering bar, in full, with no
 * commission, no slippage and no consideration of whether the market could
 * absorb the size. A real fill can only be worse. Results are labelled a
 * historical simulation everywhere they are shown, and are not a prediction.
 */

import type { Candle } from "@/domain/market";
import type { MarketContext, Strategy } from "@/domain/strategy";
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
import {
  bollingerBands,
  macd as computeMacd,
  rsi as computeRsi,
  sma,
} from "@/services/indicators/indicators";
import { applyFill } from "@/services/trading/trading-engine";
import { planActions } from "@/services/strategy/strategy-engine";
import { nextHighWater } from "@/services/strategy/runner-core";

export interface BacktestRequest {
  readonly strategy: Strategy;
  readonly candles: readonly Candle[];
  readonly initialCapital: Paise;
}

/** One completed round trip. */
export interface BacktestTrade {
  readonly entryTime: number;
  readonly exitTime: number;
  readonly entryPrice: PriceE4;
  readonly exitPrice: PriceE4;
  readonly quantity: number;
  readonly pnl: Paise;
  readonly pnlPercent: number;
  readonly exitReason: string;
  /** Bars held. */
  readonly barsHeld: number;
}

/** A fill, for chart markers. */
export interface BacktestFill {
  readonly time: number;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: PriceE4;
  readonly reason: string;
}

export interface EquityPoint {
  readonly time: number;
  /** Cash plus position marked at this bar's close. */
  readonly equity: Paise;
  /** Peak-to-trough decline from the running high, as a negative percent. */
  readonly drawdownPercent: number;
}

export interface BacktestResult {
  readonly initialCapital: Paise;
  readonly finalEquity: Paise;
  readonly totalReturn: Paise;
  readonly totalReturnPercent: number;

  readonly tradeCount: number;
  readonly winCount: number;
  readonly lossCount: number;
  /** Wins ÷ closed trades, as a percent. 0 when nothing closed. */
  readonly winRate: number;

  /**
   * Gross profit ÷ gross loss. `null` when there were no losing trades — an
   * infinite profit factor is not a number worth printing, and reporting it as
   * a huge value would flatter the result.
   */
  readonly profitFactor: number | null;

  readonly maxDrawdown: Paise;
  readonly maxDrawdownPercent: number;

  readonly averageTrade: Paise;
  readonly bestTrade: BacktestTrade | null;
  readonly worstTrade: BacktestTrade | null;
  readonly averageBarsHeld: number;

  readonly trades: readonly BacktestTrade[];
  readonly fills: readonly BacktestFill[];
  readonly equityCurve: readonly EquityPoint[];

  /** Set when the run could not proceed. */
  readonly error: string | null;
}

/** Minimum bars before indicators are considered warmed up. */
const WARMUP_BARS = 50;

export function runBacktest(request: BacktestRequest): BacktestResult {
  const { strategy, candles, initialCapital } = request;

  if (candles.length < 2) {
    return emptyResult(initialCapital, "Not enough historical data for this range.");
  }

  const closes = candles.map((candle) => priceToRupees(candle.close));

  // Causal indicators — see the note at the top of this file, and the
  // equivalence test that proves reading index `i` leaks nothing.
  const rsiSeries = computeRsi(closes, 14);
  const macdSeries = computeMacd(closes);
  const maSeries = sma(closes, 50);
  const bands = bollingerBands(closes, 20, 2);

  let cash = initialCapital;
  let holding: Holding | null = null;
  let highWater: PriceE4 | null = null;
  const firedRuleIds = new Set<string>();

  const fills: BacktestFill[] = [];
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  /*
    Open-position bookkeeping for building round trips.

    `openRealised` accumulates the realised P&L that `applyFill` reports on each
    sell. Deriving the round trip's profit any other way — say, final proceeds
    minus total cost — is wrong the moment a position is exited in parts: the
    last sale's proceeds cover only the shares it sold, while the cost covers
    all of them. Accumulating per-fill realised P&L reuses the same
    proportional cost-basis maths the live trading engine uses.
  */
  let openEntryTime = 0;
  let openEntryBar = 0;
  let openEntryPrice: PriceE4 = 0 as PriceE4;
  let openCost: Paise = ZERO_PAISE;
  let openRealised: Paise = ZERO_PAISE;
  let openQuantity = 0;

  let peakEquity = initialCapital;
  let maxDrawdown: Paise = ZERO_PAISE;
  let maxDrawdownPercent = 0;

  // Backtests always evaluate as if the strategy were running.
  const activeStrategy: Strategy = { ...strategy, status: "ACTIVE" };

  // Set when a round trip closes, so the strategy re-arms on the *next* bar.
  let rearmPending = false;

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i]!;
    // The only price the engine may see at this bar. Never candle[i+1].
    const price = candle.close;
    const previousClose = i > 0 ? candles[i - 1]!.close : candle.open;

    /*
      Re-arm the strategy after a completed round trip.

      A backtest measures a *strategy* over a period, not one instance of it.
      Without this, every rule stays fired after its first use and the run can
      only ever produce a single trade — which makes trade count, win rate,
      profit factor and average trade meaningless, since they all describe a
      population of trades.

      Re-arming is deferred to the next bar rather than applied immediately:
      exiting and re-entering within the same bar, at the same closing price,
      is not something a real participant could do, and it would let a
      permissive entry rule loop endlessly on one bar.

      This is backtest-only. Live execution keeps its one-shot semantics, where
      a completed strategy stops and must be re-activated deliberately.
    */
    if (rearmPending) {
      firedRuleIds.clear();
      rearmPending = false;
    }

    const positionQuantity = holding?.quantity ?? 0;
    highWater = nextHighWater(highWater, price, positionQuantity);

    // Indicators stay null until warmed up, so a rule cannot fire on a value
    // derived from too little history.
    const warm = i >= WARMUP_BARS;

    const unrealised =
      holding === null ? ZERO_PAISE : subPaise(notional(price, holding.quantity), holding.investedValue);

    const context: MarketContext = {
      instrumentId: strategy.instrumentId,
      price,
      previousClose,
      volume: candle.volume,
      changePercent: percentChange(priceToRupees(previousClose), priceToRupees(price)),
      rsi: warm ? (rsiSeries[i] ?? null) : null,
      macd: warm ? (macdSeries.macd[i] ?? null) : null,
      macdSignal: warm ? (macdSeries.signal[i] ?? null) : null,
      previousMacd: warm ? (macdSeries.macd[i - 1] ?? null) : null,
      previousMacdSignal: warm ? (macdSeries.signal[i - 1] ?? null) : null,
      movingAverage: warm ? (maSeries[i] ?? null) : null,
      bollingerUpper: warm ? (bands.upper[i] ?? null) : null,
      bollingerLower: warm ? (bands.lower[i] ?? null) : null,
      positionPnlPercent:
        holding === null || holding.investedValue === 0
          ? null
          : (unrealised / holding.investedValue) * 100,
      portfolioPnlPercent: percentChange(
        initialCapital,
        addPaise(cash, holding === null ? ZERO_PAISE : notional(price, holding.quantity)),
      ),
      positionQuantity,
      availableCash: cash,
      highWaterPrice: highWater,
    };

    for (const intent of planActions(activeStrategy, context, firedRuleIds)) {
      // Affordability is checked here rather than assumed: a backtest that
      // spends money the account does not have is worthless.
      if (intent.side === "BUY" && notional(price, intent.quantity) > cash) {
        firedRuleIds.add(intent.ruleId);
        continue;
      }
      if (intent.side === "SELL" && intent.quantity > (holding?.quantity ?? 0)) continue;

      firedRuleIds.add(intent.ruleId);

      const wasFlat = (holding?.quantity ?? 0) === 0;
      const fill = applyFill(holding, cash, intent.side, intent.quantity, price);

      if (intent.side === "BUY" && wasFlat) {
        openEntryTime = candle.time;
        openEntryBar = i;
        openEntryPrice = price;
        openCost = fill.value;
        openRealised = ZERO_PAISE;
        openQuantity = intent.quantity;
      } else if (intent.side === "BUY") {
        openCost = addPaise(openCost, fill.value);
        openQuantity += intent.quantity;
      } else {
        openRealised = addPaise(openRealised, fill.realisedPnl);
      }

      cash = fill.cashBalance;
      const previousQuantity = holding?.quantity ?? 0;
      holding = fill.holding;

      fills.push({
        time: candle.time,
        side: intent.side,
        quantity: intent.quantity,
        price,
        reason: intent.reason,
      });

      // A round trip closes when the position goes flat.
      if (intent.side === "SELL" && previousQuantity > 0 && (holding?.quantity ?? 0) === 0) {
        trades.push({
          entryTime: openEntryTime,
          exitTime: candle.time,
          entryPrice: openEntryPrice,
          exitPrice: price,
          // The whole round trip, not just the sale that closed it.
          quantity: openQuantity,
          pnl: openRealised,
          pnlPercent: openCost === 0 ? 0 : (openRealised / openCost) * 100,
          exitReason: intent.reason,
          barsHeld: i - openEntryBar,
        });

        openCost = ZERO_PAISE;
        openRealised = ZERO_PAISE;
        openQuantity = 0;
        highWater = null;
        // The strategy may look for its next setup from the following bar.
        rearmPending = true;
      }
    }

    // --- mark to market ---------------------------------------------------
    const positionValue =
      holding === null ? ZERO_PAISE : notional(price, holding.quantity);
    const equity = addPaise(cash, positionValue);

    if (equity > peakEquity) peakEquity = equity;

    const drawdown = subPaise(peakEquity, equity);
    const drawdownPercent = peakEquity === 0 ? 0 : -(drawdown / peakEquity) * 100;

    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = drawdownPercent;
    }

    equityCurve.push({ time: candle.time, equity, drawdownPercent });
  }

  // --- statistics ---------------------------------------------------------
  const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? initialCapital;
  const totalReturn = subPaise(finalEquity, initialCapital);

  const wins = trades.filter((trade) => trade.pnl > 0);
  const losses = trades.filter((trade) => trade.pnl < 0);

  const grossProfit = wins.reduce((total, trade) => total + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((total, trade) => total + trade.pnl, 0));

  const totalPnl = trades.reduce((total, trade) => total + trade.pnl, 0);

  return {
    initialCapital,
    finalEquity,
    totalReturn,
    totalReturnPercent: initialCapital === 0 ? 0 : (totalReturn / initialCapital) * 100,

    tradeCount: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: trades.length === 0 ? 0 : (wins.length / trades.length) * 100,

    // Null rather than Infinity when nothing lost — see the field's comment.
    profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss,

    maxDrawdown,
    maxDrawdownPercent,

    averageTrade: (trades.length === 0 ? 0 : Math.round(totalPnl / trades.length)) as Paise,
    bestTrade: pickTrade(trades, "best"),
    worstTrade: pickTrade(trades, "worst"),
    averageBarsHeld:
      trades.length === 0
        ? 0
        : trades.reduce((total, trade) => total + trade.barsHeld, 0) / trades.length,

    trades,
    fills,
    equityCurve,
    error: null,
  };
}

function pickTrade(
  trades: readonly BacktestTrade[],
  which: "best" | "worst",
): BacktestTrade | null {
  if (trades.length === 0) return null;

  return trades.reduce((chosen, trade) =>
    which === "best"
      ? trade.pnl > chosen.pnl
        ? trade
        : chosen
      : trade.pnl < chosen.pnl
        ? trade
        : chosen,
  );
}

function emptyResult(initialCapital: Paise, error: string): BacktestResult {
  return {
    initialCapital,
    finalEquity: initialCapital,
    totalReturn: ZERO_PAISE,
    totalReturnPercent: 0,
    tradeCount: 0,
    winCount: 0,
    lossCount: 0,
    winRate: 0,
    profitFactor: null,
    maxDrawdown: ZERO_PAISE,
    maxDrawdownPercent: 0,
    averageTrade: ZERO_PAISE,
    bestTrade: null,
    worstTrade: null,
    averageBarsHeld: 0,
    trades: [],
    fills: [],
    equityCurve: [],
    error,
  };
}
