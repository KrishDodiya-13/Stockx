/**
 * The day's change, computed in exactly one place.
 *
 * ── Why this module exists ─────────────────────────────────────────────────
 *
 * Five call sites were each deriving the day's move from a previous close, and
 * three of them independently decided what to do when the vendor had not sent
 * one. Two chose the last traded price and one chose zero — all three of which
 * produce the same output, `0.00%`, and none of which is a fact about the
 * market. With every provider funnelled through here, "we were not told" has a
 * single representation (null) and cannot be laundered into a number by
 * whichever call site happens to be handling the quote.
 *
 *   changePercent = ((price - previousClose) / previousClose) * 100
 *
 * That is the only formula. It is never applied to a previous *rendered* price
 * or to the previous tick — an intraday tick-to-tick delta is not the day's
 * change, and using one would make the figure depend on when the page happened
 * to be opened.
 */

import { percentChange, priceToRupees, type PriceE4 } from "@/lib/money";

export interface DayChange {
  /** The base, or null when the provider did not supply one. */
  readonly previousClose: PriceE4 | null;
  /** Absolute move per share since that close. */
  readonly change: PriceE4 | null;
  /** The same move as a percentage. Null, never 0, when unknown. */
  readonly changePercent: number | null;
}

/** Every field unknown. Rendered as "--". */
const UNKNOWN: DayChange = { previousClose: null, change: null, changePercent: null };

/**
 * Derive the day's change from a live price and a previous close.
 *
 * Returns all-null unless *both* inputs are usable. A zero or negative
 * previous close is treated as absent rather than divided by: it would yield
 * Infinity or a nonsense percentage, and either would be rendered as though it
 * were a real move.
 */
export function dayChange(
  price: PriceE4 | null | undefined,
  previousClose: PriceE4 | null | undefined,
): DayChange {
  if (price === null || price === undefined || !Number.isFinite(price) || price <= 0) {
    return UNKNOWN;
  }
  if (
    previousClose === null ||
    previousClose === undefined ||
    !Number.isFinite(previousClose) ||
    previousClose <= 0
  ) {
    return UNKNOWN;
  }

  return {
    previousClose,
    change: (price - previousClose) as PriceE4,
    // Percent is computed in rupees, not in the integer price scale, so it
    // matches what the rest of the app means by a percentage move.
    changePercent: percentChange(priceToRupees(previousClose), priceToRupees(price)),
  };
}
