/**
 * The strategy execution engine.
 *
 * One pass — `runStrategyCycle()` — evaluates every ACTIVE strategy against
 * current market data and routes any triggered rules through the *existing*
 * paper trading engine. It places no orders of its own: `placeOrder` performs
 * the same cash and holding validation it does for a manual ticket, so an
 * automated order can never do something a human order could not.
 *
 * ── Duplicate execution ────────────────────────────────────────────────────
 *
 * The central hazard. A target rule stays true on every tick once price passes
 * its level, so "is the condition true" cannot decide whether to act. Each rule
 * is *claimed* before its order is placed, with a conditional update:
 *
 *     UPDATE strategy_rules SET firedAt = now() WHERE id = ? AND firedAt IS NULL
 *
 * That is atomic in Postgres. Whichever caller updates a row first gets
 * `count === 1` and proceeds; any concurrent caller gets `0` and stops. Two
 * overlapping runner invocations therefore cannot both execute the same rule,
 * without needing a lock or a singleton worker.
 *
 * ── Where this runs ────────────────────────────────────────────────────────
 *
 * There is no background worker in this deployment, so a cycle happens when
 * something asks for one — currently the browser, while the app is open. This
 * means **strategies do not run when nobody has the app open**, which the UI
 * states plainly rather than implying continuous coverage. Because the claim is
 * atomic, moving to a cron or a dedicated worker later requires no change here.
 */

import type { MarketContext, Strategy } from "@/domain/strategy";
import type { Candle } from "@/domain/market";
import { bigIntToNumber, numberToBigInt, prisma } from "@/lib/prisma";
import { priceToRupees, type Paise, type PriceE4 } from "@/lib/money";
import {
  bollingerBands,
  macd as computeMacd,
  rsi as computeRsi,
  sma,
} from "@/services/indicators/indicators";

import { decideRun } from "@/services/strategy/runner-core";
import { listStrategies } from "@/services/strategy/strategy-repository";
import { getPortfolio, placeOrder } from "@/services/trading/order-service";
import { getServerMarketDataService } from "@/services/market-data/server";

export interface CycleResult {
  readonly evaluated: number;
  readonly executed: number;
  readonly rejected: number;
  readonly completed: number;
  readonly errors: number;
}

/** Bars pulled per instrument, enough to warm up a 50-period indicator. */
const CANDLE_LOOKBACK = 200;
const CANDLE_INTERVAL = "5m" as const;

/**
 * Evaluate and execute every active strategy once.
 *
 * Safe to call concurrently and safe to call often; a pass with nothing to do
 * is cheap and writes only the `lastEvaluatedAt` stamp.
 */
export async function runStrategyCycle(accountId: string): Promise<CycleResult> {
  const result = { evaluated: 0, executed: 0, rejected: 0, completed: 0, errors: 0 };

  const all = await listStrategies(accountId);
  const active = all.filter((strategy) => strategy.status === "ACTIVE");
  if (active.length === 0) return result;

  const service = getServerMarketDataService();

  // Quote every instrument the active set touches, once. Prices are read-only
  // within a cycle, so one fetch is correct — unlike the portfolio below.
  const instrumentIds = [...new Set(active.map((strategy) => strategy.instrumentId))];
  const quotes = new Map(
    (await service.getQuotes(instrumentIds)).map((quote) => [quote.instrumentId, quote]),
  );

  for (const strategy of active) {
    try {
      /*
        The portfolio is re-read for *every* strategy, not once per cycle.

        Cash and holdings change the moment any strategy executes, so a
        cycle-wide snapshot goes stale as soon as the first order fills. A later
        strategy would then size against a balance that no longer exists — and
        because its rule is claimed before the order is placed, the resulting
        rejection would burn the rule permanently. Re-reading is one cheap query
        and removes the whole class of problem.
      */
      const portfolio = await getPortfolio(accountId, new Map());
      await runOne(accountId, strategy, quotes, portfolio, result);
      result.evaluated += 1;
    } catch (error) {
      result.errors += 1;
      console.error(`[strategy-runner] ${strategy.id} failed`, error);
      await log(strategy.id, null, "INFO", `Evaluation failed: ${describe(error)}`);
    }
  }

  return result;
}

async function runOne(
  accountId: string,
  strategy: Strategy,
  quotes: Map<string, Awaited<ReturnType<ReturnType<typeof getServerMarketDataService>["getQuote"]>>>,
  portfolio: Awaited<ReturnType<typeof getPortfolio>>,
  result: { executed: number; rejected: number; completed: number },
): Promise<void> {
  const quote = quotes.get(strategy.instrumentId);

  await prisma.strategy.update({
    where: { id: strategy.id },
    data: { lastEvaluatedAt: new Date() },
  });

  if (!quote) {
    // No price means no decision. Never guess one.
    await log(strategy.id, null, "SKIPPED", "No market price was available for this instrument.");
    return;
  }

  const row = await prisma.strategy.findUniqueOrThrow({
    where: { id: strategy.id },
    select: { highWaterPrice: true },
  });

  const holding = portfolio.holdings.find((h) => h.instrumentId === strategy.instrumentId);
  const positionQuantity = holding?.quantity ?? 0;

  const indicators = await computeIndicators(strategy.instrumentId);

  const context: MarketContext = {
    instrumentId: strategy.instrumentId,
    price: quote.price,
    previousClose: quote.previousClose,
    volume: quote.volume,
    changePercent: quote.changePercent,
    ...indicators,
    positionPnlPercent: holding ? holding.unrealisedPnlPercent : null,
    portfolioPnlPercent: portfolio.totalPnlPercent,
    positionQuantity,
    availableCash: portfolio.cashBalance as Paise,
    highWaterPrice:
      row.highWaterPrice === null ? null : (bigIntToNumber(row.highWaterPrice) as PriceE4),
  };

  // Rules already fired since activation.
  const firedRows = await prisma.strategyRule.findMany({
    where: { strategyId: strategy.id, firedAt: { not: null } },
    select: { id: true },
  });
  const firedRuleIds = new Set(firedRows.map((rule) => rule.id));

  const decision = decideRun(strategy, context, firedRuleIds);

  // Persist the ratcheted high-water mark before acting on it.
  if (decision.highWaterPrice !== context.highWaterPrice) {
    await prisma.strategy.update({
      where: { id: strategy.id },
      data: {
        highWaterPrice:
          decision.highWaterPrice === null ? null : numberToBigInt(decision.highWaterPrice),
      },
    });
  }

  for (const intent of decision.intents) {
    /*
      Claim the rule first.

      Conditional on `firedAt IS NULL`, so exactly one caller can ever win it.
      Claiming *before* placing the order means a crash between the two leaves
      the rule marked as fired and un-executed — a missed trade, which is
      recoverable and visible in the log. The opposite order would risk placing
      the same order twice, which silently corrupts the account.
    */
    const claim = await prisma.strategyRule.updateMany({
      where: { id: intent.ruleId, firedAt: null },
      // fireCount counts *completed* executions, so it is incremented on
      // success below rather than here — a claim that is later released after a
      // refusal must not leave a phantom count behind.
      data: { firedAt: new Date() },
    });

    if (claim.count === 0) continue; // Another pass already took this rule.

    if (intent.quantity <= 0) {
      // Unreachable today — `planActions` drops zero-quantity intents — but if
      // that ever changes, release the claim rather than burning the rule.
      await prisma.strategyRule.update({
        where: { id: intent.ruleId },
        data: { firedAt: null },
      });
      await log(strategy.id, intent.ruleId, "SKIPPED", `${intent.reason} — no quantity to trade.`);
      continue;
    }

    const order = await placeOrder(accountId, {
      instrumentId: strategy.instrumentId,
      symbol: strategy.symbol,
      side: intent.side,
      type: "MARKET",
      quantity: intent.quantity,
      limitPrice: null,
      marketPrice: quote.price,
      source: "STRATEGY",
    });

    if (order.ok && order.status === "FILLED") {
      result.executed += 1;
      await prisma.strategyRule.update({
        where: { id: intent.ruleId },
        data: { fireCount: { increment: 1 } },
      });
      await log(
        strategy.id,
        intent.ruleId,
        "EXECUTED",
        `${intent.reason} → ${intent.side} ${intent.quantity} ${strategy.symbol}`,
        {
          side: intent.side,
          quantity: intent.quantity,
          price: order.executionPrice,
          orderId: order.orderId,
        },
      );
    } else {
      result.rejected += 1;

      /*
        Release the claim.

        The rule fired but did not do its job, and the reason may be temporary —
        cash freed by a later exit, or a position that has since been rebuilt.
        Leaving `firedAt` set would burn the rule permanently: a target that
        should eventually sell would be skipped forever after one transient
        refusal. Clearing it lets the next cycle re-claim and retry, and the
        claim itself is still atomic, so this cannot cause double execution.
      */
      await prisma.strategyRule.update({
        where: { id: intent.ruleId },
        data: { firedAt: null },
      });

      const detail = `${intent.reason} → order refused: ${order.message}`;

      // Only log a repeat refusal once. A rule blocked by insufficient cash
      // would otherwise write an identical entry every few seconds and bury
      // everything else in the log.
      const previous = await prisma.strategyExecution.findFirst({
        where: { strategyId: strategy.id, ruleId: intent.ruleId },
        orderBy: { createdAt: "desc" },
        select: { outcome: true, detail: true },
      });

      if (previous?.outcome !== "REJECTED" || previous.detail !== detail) {
        await log(strategy.id, intent.ruleId, "REJECTED", detail, {
          side: intent.side,
          quantity: intent.quantity,
          // A refusal raised before the transaction wrote nothing, so there is
          // no order to reference.
          orderId: order.orderId || undefined,
        });
      }
    }
  }

  if (decision.shouldComplete) {
    await prisma.strategy.update({
      where: { id: strategy.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    result.completed += 1;
    await log(strategy.id, null, "INFO", decision.completionReason ?? "Strategy completed.");
  }
}

/**
 * Indicator values for the current bar and the one before it.
 *
 * The previous bar is needed because a MACD *cross* is a transition, not a
 * state — without it the engine cannot tell a fresh cross from a condition
 * that has been true for an hour.
 */
async function computeIndicators(instrumentId: string): Promise<
  Pick<
    MarketContext,
    | "rsi"
    | "macd"
    | "macdSignal"
    | "previousMacd"
    | "previousMacdSignal"
    | "movingAverage"
    | "bollingerUpper"
    | "bollingerLower"
  >
> {
  const empty = {
    rsi: null,
    macd: null,
    macdSignal: null,
    previousMacd: null,
    previousMacdSignal: null,
    movingAverage: null,
    bollingerUpper: null,
    bollingerLower: null,
  };

  try {
    const service = getServerMarketDataService();
    const to = Date.now();
    const candles: readonly Candle[] = await service.getCandles({
      instrumentId,
      interval: CANDLE_INTERVAL,
      from: to - CANDLE_LOOKBACK * 5 * 60_000,
      to,
    });

    if (candles.length < 30) return empty;

    const closes = candles.map((candle) => priceToRupees(candle.close));
    const last = closes.length - 1;

    const rsiSeries = computeRsi(closes, 14);
    const macdSeries = computeMacd(closes);
    const maSeries = sma(closes, 50);
    const bands = bollingerBands(closes, 20, 2);

    return {
      rsi: rsiSeries[last] ?? null,
      macd: macdSeries.macd[last] ?? null,
      macdSignal: macdSeries.signal[last] ?? null,
      previousMacd: macdSeries.macd[last - 1] ?? null,
      previousMacdSignal: macdSeries.signal[last - 1] ?? null,
      movingAverage: maSeries[last] ?? null,
      bollingerUpper: bands.upper[last] ?? null,
      bollingerLower: bands.lower[last] ?? null,
    };
  } catch (error) {
    // An indicator failure must not stop price-based rules from evaluating.
    console.error(`[strategy-runner] indicators failed for ${instrumentId}`, error);
    return empty;
  }
}

/** Reset per-activation state. Called when a strategy is (re)activated. */
export async function resetStrategyRunState(strategyId: string): Promise<void> {
  await prisma.$transaction([
    prisma.strategyRule.updateMany({
      where: { strategyId },
      data: { firedAt: null },
    }),
    prisma.strategy.update({
      where: { id: strategyId },
      data: { highWaterPrice: null },
    }),
  ]);
}

async function log(
  strategyId: string,
  ruleId: string | null,
  outcome: "EXECUTED" | "REJECTED" | "SKIPPED" | "INFO",
  detail: string,
  extra: {
    side?: "BUY" | "SELL";
    quantity?: number;
    price?: PriceE4 | null;
    orderId?: string;
  } = {},
): Promise<void> {
  try {
    await prisma.strategyExecution.create({
      data: {
        strategyId,
        ruleId,
        outcome,
        detail,
        side: extra.side,
        quantity: extra.quantity,
        price: extra.price === null || extra.price === undefined ? null : numberToBigInt(extra.price),
        orderId: extra.orderId,
      },
    });
  } catch (error) {
    // Logging must never break execution.
    console.error("[strategy-runner] failed to write execution log", error);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function getExecutions(accountId: string, limit = 100) {
  const rows = await prisma.strategyExecution.findMany({
    where: { strategy: { accountId } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { strategy: { select: { name: true, symbol: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    strategyId: row.strategyId,
    strategyName: row.strategy.name,
    symbol: row.strategy.symbol,
    ruleId: row.ruleId,
    outcome: row.outcome,
    side: row.side,
    quantity: row.quantity,
    price: row.price === null ? null : bigIntToNumber(row.price),
    orderId: row.orderId,
    detail: row.detail,
    createdAt: row.createdAt.getTime(),
  }));
}
