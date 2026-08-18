/**
 * Trading domain model.
 *
 * Mirrors the Prisma schema but in application terms: money as branded `Paise`
 * and `PriceE4` rather than BigInt, and no persistence concerns. The repository
 * layer maps between the two.
 */

import type { Paise, PriceE4 } from "@/lib/money";

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";
export type OrderStatus =
  | "PENDING"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED";
export type TradeSource = "MANUAL" | "STRATEGY";
export type PositionStatus = "OPEN" | "CLOSED";
export type TransactionType = "OPENING_BALANCE" | "BUY" | "SELL";

export interface Holding {
  readonly id: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly quantity: number;
  readonly averagePrice: PriceE4;
  readonly investedValue: Paise;
}

export interface Order {
  readonly id: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly status: OrderStatus;
  readonly quantity: number;
  readonly filledQuantity: number;
  readonly limitPrice: PriceE4 | null;
  readonly averageFillPrice: PriceE4 | null;
  readonly statusReason: string | null;
  readonly placedAt: number;
  readonly filledAt: number | null;
}

export interface Trade {
  readonly id: string;
  readonly orderId: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly price: PriceE4;
  readonly value: Paise;
  readonly realisedPnl: Paise;
  readonly source: TradeSource;
  readonly executedAt: number;
}

export interface Transaction {
  readonly id: string;
  readonly type: TransactionType;
  readonly amount: Paise;
  readonly balanceAfter: Paise;
  readonly description: string;
  readonly createdAt: number;
}

/** A holding priced at the current market. */
export interface ValuedHolding extends Holding {
  /** Null when no quote is available — never silently treated as zero. */
  readonly lastPrice: PriceE4 | null;
  readonly currentValue: Paise;
  readonly unrealisedPnl: Paise;
  readonly unrealisedPnlPercent: number;
  /**
   * The day's move on this holding.
   *
   * Null when the instrument has no previous close to measure from. Zero would
   * be indistinguishable from a holding that genuinely has not moved.
   */
  readonly dayChange: Paise | null;
  readonly dayChangePercent: number | null;
}

/**
 * The complete financial state of an account at one instant.
 *
 * Every figure here comes from `computePortfolio`; no screen recomputes any of
 * them, so two pages cannot disagree about the same account.
 */
export interface PortfolioSummary {
  readonly cashBalance: Paise;
  readonly startingCapital: Paise;
  /** Cost basis of open holdings. */
  readonly investedValue: Paise;
  /** Market value of open holdings. */
  readonly holdingsValue: Paise;
  /** cash + holdingsValue. */
  readonly totalValue: Paise;
  readonly realisedPnl: Paise;
  readonly unrealisedPnl: Paise;
  /** realised + unrealised. */
  readonly totalPnl: Paise;
  readonly totalPnlPercent: number;
  /** Movement of open holdings since their previous close. */
  readonly dayPnl: Paise;
  readonly dayPnlPercent: number;
  readonly holdings: readonly ValuedHolding[];
}

/** The state the engine needs to validate and apply an order. */
export interface AccountState {
  readonly cashBalance: Paise;
  readonly holdings: readonly Holding[];
}

export interface PlaceOrderRequest {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly quantity: number;
  /** Required for LIMIT, ignored for MARKET. */
  readonly limitPrice: PriceE4 | null;
  /** Current market price. Required to fill a market order. */
  readonly marketPrice: PriceE4 | null;
  readonly source?: TradeSource;
}
