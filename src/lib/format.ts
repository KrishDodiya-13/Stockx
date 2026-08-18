/**
 * Display formatting. Formatting lives here so every screen renders the same
 * number the same way; components never hand-roll `toFixed`.
 */

import { type Paise, type PriceE4, paiseToRupees, priceToRupees } from "@/lib/money";

const INR = "en-IN";

const currencyFormatter = new Intl.NumberFormat(INR, {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyWholeFormatter = new Intl.NumberFormat(INR, {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat(INR, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat(INR, {
  notation: "compact",
  maximumFractionDigits: 2,
});

export interface CurrencyOptions {
  /** Drop the paise when the amount is large enough that they are noise. */
  whole?: boolean;
  /** Force a leading + on positive values (for deltas). */
  signed?: boolean;
}

export function formatCurrency(value: Paise, options: CurrencyOptions = {}): string {
  const rupees = paiseToRupees(value);
  const formatter = options.whole ? currencyWholeFormatter : currencyFormatter;
  const text = formatter.format(Math.abs(rupees));
  const sign = value < 0 ? "-" : options.signed && value > 0 ? "+" : "";
  return `${sign}${text}`;
}

/** A price. Null — a figure the feed did not carry — prints as "--". */
export function formatPrice(value: PriceE4 | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return `₹${decimalFormatter.format(priceToRupees(value))}`;
}

/** Indian-notation compact form: 10,00,000 -> "₹10L". */
export function formatCompactCurrency(value: Paise): string {
  const rupees = paiseToRupees(value);
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";

  if (abs >= 10_000_000) return `${sign}₹${trim(abs / 10_000_000)}Cr`;
  if (abs >= 100_000) return `${sign}₹${trim(abs / 100_000)}L`;
  if (abs >= 1_000) return `${sign}₹${trim(abs / 1_000)}K`;
  return `${sign}₹${trim(abs)}`;
}

function trim(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
}

/**
 * The placeholder for a figure the market data does not carry.
 *
 * One string, used everywhere, so a missing value looks the same wherever it
 * surfaces — and so nobody is tempted to render 0 instead. "Not known" and
 * "unchanged" must never be typeset identically.
 */
export const NO_VALUE = "--";

/**
 * A percentage, to two decimal places, with the sign printed.
 *
 * Accepts null so that an unknown change can be passed straight through rather
 * than being coalesced to 0 by the caller — which is exactly the mistake that
 * had every stock in the instruments table showing 0.00%.
 */
export function formatPercent(
  value: number | null | undefined,
  options: { signed?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;

  const sign = value < 0 ? "-" : options.signed && value > 0 ? "+" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat(INR, { maximumFractionDigits: 0 }).format(value);
}

/**
 * Traded volume, or an em dash when there is none to show.
 *
 * The live feed runs in Upstox's LTPC mode, which carries price and previous
 * close but no cumulative volume. Rendering that absence as a literal "0" reads
 * as "nothing has traded today", which for a large-cap during market hours is
 * simply false. A dash says "not reported" — which is the truth.
 */
export function formatVolume(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return compactFormatter.format(value);
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(INR, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(INR, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
}

/** Direction of a change, used to pick colour tokens consistently. */
export type Direction = "up" | "down" | "flat";

export function directionOf(change: number | null | undefined): Direction {
  // Unknown is not "up" and not "down"; it takes the neutral colour, and the
  // figure beside it says "--" rather than a number.
  if (change === null || change === undefined || !Number.isFinite(change)) return "flat";
  if (change > 0) return "up";
  if (change < 0) return "down";
  return "flat";
}
