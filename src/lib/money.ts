/**
 * Money primitives.
 *
 * Every monetary amount in this application is an integer number of paise
 * (1 rupee = 100 paise) carried as the branded type `Paise`. Rupee floats are
 * only ever produced at the display boundary. This removes the accumulated
 * float drift that otherwise makes portfolio value, invested value and P&L
 * disagree with each other after enough trades.
 *
 * Prices, however, are quoted per-share and multiplied by quantity, so a
 * price is stored at higher precision (`PriceE4`: 1/10,000 of a rupee) to keep
 * average-cost arithmetic exact enough for large quantities.
 */

declare const paiseBrand: unique symbol;
declare const priceBrand: unique symbol;

/** An integer amount of paise. 100 paise = ₹1. */
export type Paise = number & { readonly [paiseBrand]: true };

/** A per-share price in 1/10,000 rupee units. ₹100.25 -> 1_002_500. */
export type PriceE4 = number & { readonly [priceBrand]: true };

export const PAISE_PER_RUPEE = 100;
export const PRICE_SCALE = 10_000;

export const ZERO_PAISE = 0 as Paise;

// --- construction ----------------------------------------------------------

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number, received ${value}`);
  }
}

/** Build paise from a rupee amount. Rounds half-away-from-zero to the paisa. */
export function rupeesToPaise(rupees: number): Paise {
  assertFinite(rupees, "rupees");
  return roundHalfAwayFromZero(rupees * PAISE_PER_RUPEE) as Paise;
}

/** Build paise from an already-integral paise value. */
export function paise(value: number): Paise {
  assertFinite(value, "paise");
  return Math.trunc(value) as Paise;
}

/** Rupee float for display only — never feed this back into arithmetic. */
export function paiseToRupees(value: Paise): number {
  return value / PAISE_PER_RUPEE;
}

/** Build a price from a rupee-denominated quote. */
export function rupeesToPrice(rupees: number): PriceE4 {
  assertFinite(rupees, "price");
  if (rupees < 0) {
    throw new RangeError(`Price cannot be negative, received ${rupees}`);
  }
  return roundHalfAwayFromZero(rupees * PRICE_SCALE) as PriceE4;
}

/** Rupee float for display only. */
export function priceToRupees(value: PriceE4): number {
  return value / PRICE_SCALE;
}

export const ZERO_PRICE = 0 as PriceE4;

// --- arithmetic ------------------------------------------------------------

export function addPaise(a: Paise, b: Paise): Paise {
  return (a + b) as Paise;
}

export function subPaise(a: Paise, b: Paise): Paise {
  return (a - b) as Paise;
}

export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0;
  for (const value of values) total += value;
  return total as Paise;
}

export function negPaise(a: Paise): Paise {
  return -a as Paise;
}

export function absPaise(a: Paise): Paise {
  return Math.abs(a) as Paise;
}

export function comparePaise(a: Paise, b: Paise): number {
  return a - b;
}

export function addPrice(a: PriceE4, b: PriceE4): PriceE4 {
  return (a + b) as PriceE4;
}

export function subPrice(a: PriceE4, b: PriceE4): PriceE4 {
  return (a - b) as PriceE4;
}

/**
 * Notional value of `quantity` shares at `price`, rounded to the nearest paisa.
 * This is the single place share-count × price happens.
 */
export function notional(price: PriceE4, quantity: number): Paise {
  assertFinite(quantity, "quantity");
  if (!Number.isInteger(quantity)) {
    throw new RangeError(`Quantity must be a whole number of shares, received ${quantity}`);
  }
  // price is in 1e-4 rupees; divide by 100 to land on paise.
  return roundHalfAwayFromZero((price * quantity) / (PRICE_SCALE / PAISE_PER_RUPEE)) as Paise;
}

/**
 * Average cost per share implied by a total cost and a share count.
 * Returns ZERO_PRICE for an empty position rather than NaN.
 */
export function averagePrice(totalCost: Paise, quantity: number): PriceE4 {
  if (quantity === 0) return ZERO_PRICE;
  return roundHalfAwayFromZero((totalCost * (PRICE_SCALE / PAISE_PER_RUPEE)) / quantity) as PriceE4;
}

/** Scale an amount by a ratio (e.g. a 0.25 partial exit). */
export function scalePaise(value: Paise, ratio: number): Paise {
  assertFinite(ratio, "ratio");
  return roundHalfAwayFromZero(value * ratio) as Paise;
}

// --- percentages -----------------------------------------------------------

/**
 * Percentage change from `from` to `to`, as a plain number (12.5 === 12.5%).
 * Returns 0 when the base is zero — an undefined change is not a 100% move.
 */
export function percentChange(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / Math.abs(from)) * 100;
}

/** Apply a percentage move to a price. `+2` on ₹100 -> ₹102. */
export function applyPercent(price: PriceE4, percent: number): PriceE4 {
  assertFinite(percent, "percent");
  const next = roundHalfAwayFromZero(price * (1 + percent / 100));
  return Math.max(0, next) as PriceE4;
}

// --- rounding --------------------------------------------------------------

/**
 * `Math.round` rounds -0.5 to -0 (toward +∞), which makes losses and gains
 * round asymmetrically. Financial rounding must be symmetric about zero.
 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}
