/**
 * Order placement — the transactional boundary.
 *
 * `trading-engine.ts` decides what *should* happen; this module makes it
 * durable. The critical property is that a fill is atomic: cash, holding,
 * position, order, trade and ledger entry all commit together or none of them
 * do. A crash between debiting cash and creating the holding would otherwise
 * destroy virtual money and leave the account permanently inconsistent.
 *
 * This runs on the server only — it touches Prisma directly.
 */

import { Prisma } from "@prisma/client";

import type {
  Holding,
  OrderSide,
  OrderType,
  PlaceOrderRequest,
  PortfolioSummary,
  TradeSource,
} from "@/domain/trading";
import type { Quote } from "@/domain/market";
import { MAX_TOTAL_DEPOSIT } from "@/domain/constants";
import { bigIntToNumber, numberToBigInt, prisma } from "@/lib/prisma";
import { isMarketOpen } from "@/services/market-data/market-hours";
import { addPaise, notional, type Paise, type PriceE4 } from "@/lib/money";
import {
  applyFill,
  computePortfolio,
  isLimitExecutable,
  validateOrder,
} from "@/services/trading/trading-engine";

export interface PlaceOrderResult {
  readonly ok: boolean;
  readonly orderId: string;
  readonly status: string;
  readonly message: string;
  readonly filledQuantity: number;
  readonly executionPrice: PriceE4 | null;
  readonly realisedPnl: Paise | null;
}

/*
  There is no longer a shared demo account.

  Every caller arrives with an account id resolved from their own session by
  `requireAccount`; account creation lives in `services/auth/session.ts`, next to
  the sign-up flow that is the only thing allowed to trigger it. Removing the
  old `getOrCreateDemoAccount` was the point of the change rather than a side
  effect of it — while it existed, any route could conjure an account without a
  caller, which is exactly the hole that made "you cannot read another user's
  portfolio" unenforceable.
*/

/**
 * Retries allowed when the database aborts a transaction to preserve
 * serializability. Small: a genuine contention storm should surface, not be
 * hidden behind an unbounded retry loop.
 */
const MAX_SERIALIZATION_RETRIES = 4;

/**
 * True for the errors Postgres raises when it cannot serialise two concurrent
 * transactions — Prisma's P2034, and the raw SQLSTATE 40001/40P01 underneath.
 *
 * These are *not* failures. Under Serializable isolation the database is
 * entitled to abort one of two conflicting transactions and expect the
 * application to try again; that is the documented contract of the isolation
 * level, not an exception path.
 */
function isSerializationFailure(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034";
  }
  const message = error instanceof Error ? error.message : "";
  return /40001|40P01|could not serialize|deadlock detected/i.test(message);
}

/** Shown to the user, and the single wording for a closed-market refusal. */
export const MARKET_CLOSED_MESSAGE =
  "Market is closed. Orders can be placed when the market opens at 09:15 IST.";

/**
 * Place an order and, if it can execute, fill it.
 *
 * Everything runs inside one serializable transaction. Two concurrent buys must
 * not both pass the cash check against the same starting balance and overdraw
 * the account, so the account row is re-read *inside* the transaction rather
 * than trusting anything fetched before it.
 *
 * ── Why the retry loop exists ──────────────────────────────────────────────
 *
 * Serializable isolation buys that guarantee by aborting one of two conflicting
 * transactions. Firing six concurrent buys at one account really does produce
 * write conflicts, and without this loop two of them came back as an opaque 500
 * — which on a Buy button is the worst possible answer, because the user cannot
 * tell whether their order went through.
 *
 * Retrying is safe precisely because the aborted transaction wrote nothing: the
 * order, trade, holding, cash and ledger rows commit together or not at all, so
 * a retry re-runs validation against fresh state rather than repeating a
 * half-applied fill. An order that no longer fits is then honestly rejected.
 */
export async function placeOrder(
  accountId: string,
  request: PlaceOrderRequest,
  /** Overridable only so the market gate can be tested at a chosen moment. */
  now: Date = new Date(),
): Promise<PlaceOrderResult> {
  /*
    The market-hours gate, at the one place every live order passes through.

    Both live pathways — `POST /api/orders` (trade ticket, command palette,
    keyboard) and the strategy runner — call this function, so gating here
    covers a button, a shortcut, a direct `fetch`, a curl and an automated
    strategy with a single check. Disabling the buttons would have covered only
    the first of those.

    Refused *before* the transaction opens, so nothing is written: no order row,
    no trade, no holding, no cash movement, no ledger entry. That also keeps an
    active strategy from filling the order history with a rejected row on every
    evaluation cycle while the market is shut.

    Returned as a typed rejection rather than thrown. Every other refusal in
    this engine is a value — `validateOrder` returns them so the caller can show
    the reason — and throwing here would surface as an opaque 500 rather than
    the message the user needs to read.

    `isMarketOpen` is the shared implementation used by the session badge and
    the price simulator; there is deliberately no second copy of the hours.
  */
  if (!isMarketOpen(now)) {
    return {
      ok: false,
      // No row was written, so there is no id to report.
      orderId: "",
      status: "REJECTED",
      message: MARKET_CLOSED_MESSAGE,
      filledQuantity: 0,
      executionPrice: null,
      realisedPnl: null,
    };
  }

  return withSerializationRetry(() => attemptOrder(accountId, request));
}

/**
 * Run a serializable transaction, retrying if the database aborts it.
 *
 * Shared by order placement and deposits, which have the same requirement:
 * re-read the account inside the transaction, and be prepared for Postgres to
 * refuse one of two conflicting writers. Duplicating the loop per money path
 * would guarantee they eventually drift.
 *
 * Retrying is only safe because an aborted transaction wrote nothing at all —
 * the caller's whole unit of work commits or none of it does — so a retry
 * re-runs its checks against fresh state rather than repeating a partial write.
 */
async function withSerializationRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isSerializationFailure(error)) throw error;
      lastError = error;

      // Back off with jitter so retries do not re-collide in lockstep.
      const delay = 15 * 2 ** attempt + Math.random() * 25;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

async function attemptOrder(
  accountId: string,
  request: PlaceOrderRequest,
): Promise<PlaceOrderResult> {
  const source: TradeSource = request.source ?? "MANUAL";

  return prisma.$transaction(
    async (tx) => {
      const account = await tx.account.findUniqueOrThrow({
        where: { id: accountId },
        select: { id: true, cashBalance: true, realisedPnl: true },
      });

      const holdingRows = await tx.holding.findMany({ where: { accountId } });
      const holdings: Holding[] = holdingRows.map(toHolding);

      const state = {
        cashBalance: bigIntToNumber(account.cashBalance) as Paise,
        holdings,
      };

      const validation = validateOrder(request, state);

      // --- rejected: still recorded, so the user can see why ---------------
      if (!validation.ok) {
        const rejected = await tx.order.create({
          data: {
            accountId,
            instrumentId: request.instrumentId,
            symbol: request.symbol,
            side: request.side,
            type: request.type,
            status: "REJECTED",
            // Clamped at zero. A rejected order is still recorded so the user
            // can see why, but a negative share count is not a fact worth
            // preserving — the reason for the rejection is, and that is in
            // `statusReason`.
            quantity: Math.max(
              0,
              Math.trunc(Number.isFinite(request.quantity) ? request.quantity : 0),
            ),
            limitPrice: request.limitPrice === null ? null : numberToBigInt(request.limitPrice),
            statusReason: validation.message,
          },
          select: { id: true },
        });

        return {
          ok: false,
          orderId: rejected.id,
          status: "REJECTED",
          message: validation.message,
          filledQuantity: 0,
          executionPrice: null,
          realisedPnl: null,
        };
      }

      // --- a limit order away from the market rests as PENDING -------------
      if (
        request.type === "LIMIT" &&
        request.limitPrice !== null &&
        request.marketPrice !== null &&
        !isLimitExecutable(request.side, request.limitPrice, request.marketPrice)
      ) {
        const pending = await tx.order.create({
          data: {
            accountId,
            instrumentId: request.instrumentId,
            symbol: request.symbol,
            side: request.side,
            type: "LIMIT",
            status: "PENDING",
            quantity: request.quantity,
            limitPrice: numberToBigInt(request.limitPrice),
            statusReason: "Waiting for the market to reach the limit price",
          },
          select: { id: true },
        });

        return {
          ok: true,
          orderId: pending.id,
          status: "PENDING",
          message: "Order accepted and resting until the limit price is reached.",
          filledQuantity: 0,
          executionPrice: null,
          realisedPnl: null,
        };
      }

      // --- fill -------------------------------------------------------------
      const { executionPrice } = validation;
      const existing = holdings.find((h) => h.instrumentId === request.instrumentId) ?? null;

      const fill = applyFill(
        existing,
        state.cashBalance,
        request.side,
        request.quantity,
        executionPrice,
      );

      const order = await tx.order.create({
        data: {
          accountId,
          instrumentId: request.instrumentId,
          symbol: request.symbol,
          side: request.side,
          type: request.type,
          status: "FILLED",
          quantity: request.quantity,
          filledQuantity: request.quantity,
          limitPrice: request.limitPrice === null ? null : numberToBigInt(request.limitPrice),
          averageFillPrice: numberToBigInt(executionPrice),
          filledAt: new Date(),
        },
        select: { id: true },
      });

      const position = await upsertPosition(tx, accountId, request, executionPrice, fill.realisedPnl);

      const trade = await tx.trade.create({
        data: {
          accountId,
          orderId: order.id,
          positionId: position.id,
          instrumentId: request.instrumentId,
          symbol: request.symbol,
          side: request.side,
          quantity: request.quantity,
          price: numberToBigInt(executionPrice),
          value: numberToBigInt(fill.value),
          realisedPnl: numberToBigInt(fill.realisedPnl),
          source,
        },
        select: { id: true },
      });

      // Holding
      if (fill.holding === null) {
        await tx.holding.deleteMany({
          where: { accountId, instrumentId: request.instrumentId },
        });
      } else {
        await tx.holding.upsert({
          where: {
            accountId_instrumentId: { accountId, instrumentId: request.instrumentId },
          },
          create: {
            accountId,
            instrumentId: request.instrumentId,
            symbol: request.symbol,
            quantity: fill.holding.quantity,
            averagePrice: numberToBigInt(fill.holding.averagePrice),
            investedValue: numberToBigInt(fill.holding.investedValue),
          },
          update: {
            quantity: fill.holding.quantity,
            averagePrice: numberToBigInt(fill.holding.averagePrice),
            investedValue: numberToBigInt(fill.holding.investedValue),
          },
        });
      }

      // Cash and booked P&L
      const updated = await tx.account.update({
        where: { id: accountId },
        data: {
          cashBalance: numberToBigInt(fill.cashBalance),
          realisedPnl: { increment: numberToBigInt(fill.realisedPnl) },
        },
        select: { cashBalance: true },
      });

      await tx.transaction.create({
        data: {
          accountId,
          type: request.side,
          amount: numberToBigInt(fill.cashDelta),
          balanceAfter: updated.cashBalance,
          tradeId: trade.id,
          description: `${request.side === "BUY" ? "Bought" : "Sold"} ${request.quantity} ${request.symbol}`,
        },
      });

      return {
        ok: true,
        orderId: order.id,
        status: "FILLED",
        message: `${request.side === "BUY" ? "Bought" : "Sold"} ${request.quantity} ${request.symbol}.`,
        filledQuantity: request.quantity,
        executionPrice,
        realisedPnl: fill.realisedPnl,
      };
    },
    {
      // Prevents two concurrent orders from both passing the cash check against
      // the same balance.
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15_000,
    },
  );
}

/** Open a position, add to it, or reduce and possibly close it. */
async function upsertPosition(
  tx: Prisma.TransactionClient,
  accountId: string,
  request: PlaceOrderRequest,
  executionPrice: PriceE4,
  realisedPnl: Paise,
): Promise<{ id: string }> {
  const open = await tx.position.findFirst({
    where: { accountId, instrumentId: request.instrumentId, status: "OPEN" },
  });

  if (request.side === "BUY") {
    if (!open) {
      return tx.position.create({
        data: {
          accountId,
          instrumentId: request.instrumentId,
          symbol: request.symbol,
          quantity: request.quantity,
          totalBought: request.quantity,
          averageEntryPrice: numberToBigInt(executionPrice),
        },
        select: { id: true },
      });
    }

    // Re-weight the entry price across the enlarged position.
    const previousQuantity = open.quantity;
    const previousCost = notional(bigIntToNumber(open.averageEntryPrice) as PriceE4, previousQuantity);
    const addedCost = notional(executionPrice, request.quantity);
    const nextQuantity = previousQuantity + request.quantity;

    return tx.position.update({
      where: { id: open.id },
      data: {
        quantity: nextQuantity,
        totalBought: open.totalBought + request.quantity,
        averageEntryPrice: numberToBigInt(
          Math.round(((previousCost + addedCost) * 100) / nextQuantity),
        ),
      },
      select: { id: true },
    });
  }

  /*
    Selling without an open position is impossible by construction: validation
    refuses a sell with no holding, and a holding always has a position behind
    it. Reaching here means those two have diverged.

    Previously this wrote a synthetic position with totalSold > totalBought —
    a record of shares sold that were never bought. That is the paper-trading
    equivalent of printing money, and it made the inconsistency permanent and
    invisible instead of loud. Throwing rolls back the whole serializable
    transaction, so the sale simply does not happen.
  */
  if (!open) {
    throw new Error(
      `Data integrity: sell of ${request.quantity} ${request.symbol} with no open position on account ${accountId}.`,
    );
  }

  const remaining = open.quantity - request.quantity;

  return tx.position.update({
    where: { id: open.id },
    data: {
      quantity: remaining,
      totalSold: open.totalSold + request.quantity,
      realisedPnl: { increment: numberToBigInt(realisedPnl) },
      ...(remaining === 0 ? { status: "CLOSED" as const, closedAt: new Date() } : {}),
    },
    select: { id: true },
  });
}

/**
 * Refused because the deposit would push the account's lifetime funding past
 * `MAX_TOTAL_DEPOSIT`. Typed rather than a generic Error so the route can
 * distinguish "this request is invalid" (400) from a genuine server fault.
 */
export class DepositLimitExceeded extends Error {
  constructor(readonly remaining: Paise) {
    super("Deposit would exceed the lifetime funding cap.");
    this.name = "DepositLimitExceeded";
  }
}

/**
 * Add virtual funds to an account.
 *
 * `startingCapital` is reused as the running total of everything ever
 * deposited — not just the sign-up amount — so it is both the deposit-cap
 * ledger and the denominator `computePortfolio` already uses for total
 * return. Spending money back down never lowers it; only a deposit raises it,
 * and only up to `MAX_TOTAL_DEPOSIT`.
 *
 * ── Isolation ──────────────────────────────────────────────────────────────
 *
 * Serializable, with the same retry as `placeOrder`, because re-reading inside
 * a transaction is only meaningful if the read is repeatable. Under Postgres's
 * default Read Committed, two concurrent deposits can both read the same
 * `startingCapital` before either commits, both compute their new total from
 * it, and the second write then lands on top of the first — one deposit's worth
 * of virtual capital added, two charged against the cap, or vice versa.
 *
 * That window did not reproduce under test — the row lock on the update
 * serialised the writers in practice, and the `accounts_starting_capital_within_cap`
 * constraint is a hard backstop against the dangerous direction. It is closed
 * here because a money path should not depend on the timing that happened to
 * hold, and because the whole point of re-reading is defeated without it.
 */
export async function depositFunds(
  accountId: string,
  amount: Paise,
): Promise<{ cashBalance: Paise; startingCapital: Paise }> {
  return withSerializationRetry(() => attemptDeposit(accountId, amount));
}

async function attemptDeposit(
  accountId: string,
  amount: Paise,
): Promise<{ cashBalance: Paise; startingCapital: Paise }> {
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { cashBalance: true, startingCapital: true },
    });

    const totalDeposited = bigIntToNumber(account.startingCapital) as Paise;
    const remaining = (MAX_TOTAL_DEPOSIT - totalDeposited) as Paise;

    if (amount > remaining) throw new DepositLimitExceeded(remaining);

    const nextCash = addPaise(bigIntToNumber(account.cashBalance) as Paise, amount);
    const nextTotal = addPaise(totalDeposited, amount);

    const updated = await tx.account.update({
      where: { id: accountId },
      data: {
        cashBalance: numberToBigInt(nextCash),
        startingCapital: numberToBigInt(nextTotal),
      },
      select: { cashBalance: true, startingCapital: true },
    });

    await tx.transaction.create({
      data: {
        accountId,
        type: "DEPOSIT",
        amount: numberToBigInt(amount),
        balanceAfter: updated.cashBalance,
        description: "Added virtual funds",
      },
    });

    return {
      cashBalance: bigIntToNumber(updated.cashBalance) as Paise,
      startingCapital: bigIntToNumber(updated.startingCapital) as Paise,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 15_000,
  });
}

/** Value the account against the supplied quotes. */
export async function getPortfolio(
  accountId: string,
  quotes: ReadonlyMap<string, Quote>,
): Promise<PortfolioSummary> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { cashBalance: true, startingCapital: true, realisedPnl: true },
  });

  const holdings = await prisma.holding.findMany({ where: { accountId } });

  return computePortfolio(
    bigIntToNumber(account.cashBalance) as Paise,
    bigIntToNumber(account.startingCapital) as Paise,
    bigIntToNumber(account.realisedPnl) as Paise,
    holdings.map(toHolding),
    quotes,
  );
}

export async function getOrders(accountId: string, limit = 100) {
  const orders = await prisma.order.findMany({
    where: { accountId },
    orderBy: { placedAt: "desc" },
    take: limit,
  });

  return orders.map((order) => ({
    id: order.id,
    instrumentId: order.instrumentId,
    symbol: order.symbol,
    side: order.side as OrderSide,
    type: order.type as OrderType,
    status: order.status,
    quantity: order.quantity,
    filledQuantity: order.filledQuantity,
    limitPrice: order.limitPrice === null ? null : bigIntToNumber(order.limitPrice),
    averageFillPrice:
      order.averageFillPrice === null ? null : bigIntToNumber(order.averageFillPrice),
    statusReason: order.statusReason,
    placedAt: order.placedAt.getTime(),
    filledAt: order.filledAt?.getTime() ?? null,
  }));
}

export async function getTrades(accountId: string, limit = 200) {
  const trades = await prisma.trade.findMany({
    where: { accountId },
    orderBy: { executedAt: "desc" },
    take: limit,
  });

  return trades.map((trade) => ({
    id: trade.id,
    orderId: trade.orderId,
    instrumentId: trade.instrumentId,
    symbol: trade.symbol,
    side: trade.side as OrderSide,
    quantity: trade.quantity,
    price: bigIntToNumber(trade.price),
    value: bigIntToNumber(trade.value),
    realisedPnl: bigIntToNumber(trade.realisedPnl),
    source: trade.source,
    executedAt: trade.executedAt.getTime(),
  }));
}

interface HoldingRow {
  id: string;
  instrumentId: string;
  symbol: string;
  quantity: number;
  averagePrice: bigint;
  investedValue: bigint;
}

function toHolding(row: HoldingRow): Holding {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    symbol: row.symbol,
    quantity: row.quantity,
    averagePrice: bigIntToNumber(row.averagePrice) as PriceE4,
    investedValue: bigIntToNumber(row.investedValue) as Paise,
  };
}
