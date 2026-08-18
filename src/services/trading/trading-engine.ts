/**
 * The paper trading engine.
 *
 * Pure functions only: no database, no clock, no randomness. Everything the
 * engine needs is passed in, and everything it decides is returned. This is
 * what makes the money rules testable in isolation, and it is the single place
 * where an order becomes a fill, a fill becomes a holding, and a sale becomes
 * realised P&L.
 *
 * Two rules the whole engine is built to guarantee:
 *
 *  1. Cash and holdings only ever change together, through `applyFill`. There
 *     is no path that debits cash without creating a holding, or removes shares
 *     without crediting cash.
 *
 *  2. Money is integer paise throughout. Average cost is the one place rounding
 *     can accumulate, so `investedValue` is carried explicitly rather than
 *     recomputed as quantity × averagePrice on each read.
 */

import type {
  AccountState,
  Holding,
  OrderSide,
  PlaceOrderRequest,
  PortfolioSummary,
  ValuedHolding,
} from "@/domain/trading";
import type { Quote } from "@/domain/market";
import {
  addPaise,
  averagePrice as averagePriceOf,
  notional,
  percentChange,
  priceToRupees,
  subPaise,
  ZERO_PAISE,
  ZERO_PRICE,
  type Paise,
  type PriceE4,
} from "@/lib/money";

// --- validation ------------------------------------------------------------

export type RejectionCode =
  | "invalid-quantity"
  | "invalid-price"
  | "missing-limit-price"
  | "no-market-price"
  | "insufficient-funds"
  | "insufficient-shares"
  | "unknown-instrument"
  /**
   * The exchange is shut. Raised by `placeOrder`, not by `validateOrder` —
   * validation is a pure function of the order and the account, and reading a
   * clock inside it would make every one of its tests depend on the hour they
   * happen to run at.
   */
  | "market-closed";

export interface ValidationFailure {
  readonly ok: false;
  readonly code: RejectionCode;
  readonly message: string;
}

export interface ValidationSuccess {
  readonly ok: true;
  /** The price the order would execute at right now. */
  readonly executionPrice: PriceE4;
  /** Cash cost (BUY) or proceeds (SELL). */
  readonly value: Paise;
}

export type ValidationResult = ValidationFailure | ValidationSuccess;

/** Largest single order the engine will accept, as a sanity bound. */
const MAX_QUANTITY = 10_000_000;

/**
 * Decide whether an order may be accepted, and at what price.
 *
 * Rejections are typed rather than thrown so the caller can persist the reason
 * on the order record — a rejected order is a real event a user should be able
 * to see in their history, not an exception that vanishes.
 */
export function validateOrder(
  request: PlaceOrderRequest,
  account: AccountState,
): ValidationResult {
  const { quantity, side, type, limitPrice, marketPrice } = request;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return fail("invalid-quantity", "Quantity must be a whole number of shares above zero.");
  }

  if (quantity > MAX_QUANTITY) {
    return fail("invalid-quantity", `Quantity may not exceed ${MAX_QUANTITY.toLocaleString("en-IN")} shares.`);
  }

  if (type === "LIMIT") {
    if (limitPrice === null || limitPrice === undefined) {
      return fail("missing-limit-price", "A limit order requires a limit price.");
    }
    if (limitPrice <= 0) {
      return fail("invalid-price", "Limit price must be above zero.");
    }
  }

  if (marketPrice === null || marketPrice === undefined || marketPrice <= 0) {
    return fail(
      "no-market-price",
      "No market price is available for this instrument, so the order cannot be priced.",
    );
  }

  /*
    Fill price.

    A limit price is a *bound*, not the price. A marketable limit fills at the
    market and the limit simply caps how far the fill may go against you:

      BUY  → min(market, limit)   never pay more than the limit
      SELL → max(market, limit)   never accept less than the limit

    This previously used the limit price directly, described as the
    "conservative" choice. It is not conservative, it is wrong in both
    directions, and badly so at the extremes: a buy limit of ₹9,99,999 against a
    ₹4,000 market filled at ₹9,99,999 — a 250× overpayment — and a sell limit of
    ₹1 would have handed the shares away for nothing. Verified against a live
    order before and after this change.

    The same expression is also the right reserve for an order that is *not*
    marketable and will rest: for a resting buy the market is above the limit,
    so `min` yields the limit — exactly the worst case the user is committing
    to, which is what the cash check below should be measured against.
  */
  const executionPrice: PriceE4 =
    type === "LIMIT"
      ? side === "BUY"
        ? (Math.min(marketPrice, limitPrice as PriceE4) as PriceE4)
        : (Math.max(marketPrice, limitPrice as PriceE4) as PriceE4)
      : marketPrice;
  const value = notional(executionPrice, quantity);

  if (side === "BUY") {
    if (value > account.cashBalance) {
      return fail(
        "insufficient-funds",
        "This order costs more than the available virtual cash.",
      );
    }
  } else {
    const holding = account.holdings.find((h) => h.instrumentId === request.instrumentId);
    const owned = holding?.quantity ?? 0;

    if (owned <= 0) {
      return fail("insufficient-shares", "You do not hold any shares of this instrument.");
    }
    if (quantity > owned) {
      return fail(
        "insufficient-shares",
        `You hold ${owned.toLocaleString("en-IN")} shares; this order would sell more than you own.`,
      );
    }
  }

  return { ok: true, executionPrice, value };
}

function fail(code: RejectionCode, message: string): ValidationFailure {
  return { ok: false, code, message };
}

/**
 * Whether a limit order can execute against the current market.
 *
 * A buy limit fills at or below its price; a sell limit at or above. When this
 * is false the order rests as PENDING rather than being rejected.
 */
export function isLimitExecutable(
  side: OrderSide,
  limitPrice: PriceE4,
  marketPrice: PriceE4,
): boolean {
  return side === "BUY" ? marketPrice <= limitPrice : marketPrice >= limitPrice;
}

// --- applying a fill -------------------------------------------------------

export interface FillResult {
  /** The holding after the fill, or null when the position is fully closed. */
  readonly holding: Holding | null;
  readonly cashBalance: Paise;
  /** Signed cash movement: negative for a buy. */
  readonly cashDelta: Paise;
  /** Booked P&L from this fill. Always zero for a buy. */
  readonly realisedPnl: Paise;
  readonly value: Paise;
}

/**
 * Apply an executed fill to a holding and a cash balance.
 *
 * Buy: cash falls by the cost, quantity rises, and average price is
 * re-weighted. Sell: cash rises by the proceeds, quantity falls, and the
 * **average price is left unchanged** — selling part of a position does not
 * alter what the remaining shares cost. Getting that wrong silently corrupts
 * every later P&L figure, so it is asserted in the tests.
 */
export function applyFill(
  holding: Holding | null,
  cashBalance: Paise,
  side: OrderSide,
  quantity: number,
  price: PriceE4,
): FillResult {
  const value = notional(price, quantity);

  if (side === "BUY") {
    const previousQuantity = holding?.quantity ?? 0;
    const previousInvested = holding?.investedValue ?? ZERO_PAISE;

    const nextQuantity = previousQuantity + quantity;
    const nextInvested = addPaise(previousInvested, value);

    return {
      holding: {
        id: holding?.id ?? "",
        instrumentId: holding?.instrumentId ?? "",
        symbol: holding?.symbol ?? "",
        quantity: nextQuantity,
        averagePrice: averagePriceOf(nextInvested, nextQuantity),
        investedValue: nextInvested,
      },
      cashBalance: subPaise(cashBalance, value),
      cashDelta: (-value) as Paise,
      realisedPnl: ZERO_PAISE,
      value,
    };
  }

  // --- sell ---------------------------------------------------------------
  if (!holding || holding.quantity < quantity) {
    throw new Error("applyFill was called with a sell larger than the holding");
  }

  /*
    Cost of the shares being sold, at the position's average price. Taking the
    proportional slice of `investedValue` — rather than quantity × averagePrice
    — keeps the remaining invested value exact and prevents a rounding residue
    from being left behind when a position is fully closed.
  */
  const costOfSold =
    quantity === holding.quantity
      ? holding.investedValue
      : (Math.round((holding.investedValue * quantity) / holding.quantity) as Paise);

  const realisedPnl = subPaise(value, costOfSold);
  const remainingQuantity = holding.quantity - quantity;
  const remainingInvested = subPaise(holding.investedValue, costOfSold);

  return {
    holding:
      remainingQuantity === 0
        ? null
        : {
            ...holding,
            quantity: remainingQuantity,
            // Unchanged by design — see the doc comment above.
            averagePrice: holding.averagePrice,
            investedValue: remainingInvested,
          },
    cashBalance: addPaise(cashBalance, value),
    cashDelta: value,
    realisedPnl,
    value,
  };
}

// --- portfolio valuation ---------------------------------------------------

/**
 * Value an account against live quotes.
 *
 * A holding with no quote contributes its cost basis to total value and zero
 * unrealised P&L, rather than being dropped or valued at zero — losing a quote
 * must not make the portfolio appear to have lost money.
 */
export function computePortfolio(
  cashBalance: Paise,
  startingCapital: Paise,
  realisedPnl: Paise,
  holdings: readonly Holding[],
  quotes: ReadonlyMap<string, Quote>,
): PortfolioSummary {
  const valued: ValuedHolding[] = [];

  let investedValue = ZERO_PAISE;
  let holdingsValue = ZERO_PAISE;
  let unrealisedPnl = ZERO_PAISE;
  let dayPnl = ZERO_PAISE;

  for (const holding of holdings) {
    const quote = quotes.get(holding.instrumentId) ?? null;
    const lastPrice = quote?.price ?? null;

    const currentValue =
      lastPrice === null ? holding.investedValue : notional(lastPrice, holding.quantity);

    const holdingUnrealised =
      lastPrice === null ? ZERO_PAISE : subPaise(currentValue, holding.investedValue);

    /*
      The day's move on this holding needs a previous close to measure from.
      Without one — an instrument the feed has not given a close for — this
      holding contributes nothing to day P&L rather than contributing a move
      measured against its own current price, which is always exactly zero and
      therefore indistinguishable from a genuinely flat position.
    */
    const previousClose = quote?.previousClose ?? null;
    const previousValue = previousClose === null ? null : notional(previousClose, holding.quantity);
    const holdingDayChange =
      previousValue === null ? null : subPaise(currentValue, previousValue);

    investedValue = addPaise(investedValue, holding.investedValue);
    holdingsValue = addPaise(holdingsValue, currentValue);
    unrealisedPnl = addPaise(unrealisedPnl, holdingUnrealised);
    // Unknown day moves are left out of the total rather than added as zero.
    if (holdingDayChange !== null) dayPnl = addPaise(dayPnl, holdingDayChange);

    valued.push({
      ...holding,
      lastPrice,
      currentValue,
      unrealisedPnl: holdingUnrealised,
      unrealisedPnlPercent:
        holding.investedValue === 0
          ? 0
          : (holdingUnrealised / holding.investedValue) * 100,
      dayChange: holdingDayChange,
      dayChangePercent:
        holdingDayChange === null || previousValue === null || previousValue === 0
          ? null
          : (holdingDayChange / previousValue) * 100,
    });
  }

  const totalValue = addPaise(cashBalance, holdingsValue);
  const totalPnl = addPaise(realisedPnl, unrealisedPnl);

  return {
    cashBalance,
    startingCapital,
    investedValue,
    holdingsValue,
    totalValue,
    realisedPnl,
    unrealisedPnl,
    totalPnl,
    // Measured against what the account was funded with, which is the only
    // meaningful denominator for a paper account.
    totalPnlPercent: startingCapital === 0 ? 0 : (totalPnl / startingCapital) * 100,
    dayPnl,
    dayPnlPercent:
      totalValue - dayPnl === 0 ? 0 : (dayPnl / (totalValue - dayPnl)) * 100,
    holdings: valued.sort((a, b) => b.currentValue - a.currentValue),
  };
}

/** Highest quantity of an instrument the cash balance can buy at a price. */
export function maxBuyQuantity(cashBalance: Paise, price: PriceE4): number {
  if (price <= 0) return 0;
  const perShare = notional(price, 1);
  if (perShare <= 0) return 0;
  return Math.floor(cashBalance / perShare);
}

/** Unrealised P&L for a single holding at a price. */
export function unrealisedPnlFor(holding: Holding, price: PriceE4 | null): Paise {
  if (price === null) return ZERO_PAISE;
  return subPaise(notional(price, holding.quantity), holding.investedValue);
}

export { ZERO_PRICE, priceToRupees, percentChange };
