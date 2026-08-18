/**
 * Route builders.
 *
 * Centralised so a URL shape changes in one place. Phase 2 linked symbols to
 * `/stocks?symbol=…`; Phase 3 gives each instrument its own page, and every
 * caller moved by changing this function rather than six call sites.
 */

/** The detail page for one instrument. */
export function stockRoute(symbol: string): string {
  return `/stocks/${encodeURIComponent(symbol)}`;
}

/** The instrument browser, optionally pre-filtered. */
export function stocksRoute(query?: string): string {
  return query ? `/stocks?symbol=${encodeURIComponent(query)}` : "/stocks";
}
