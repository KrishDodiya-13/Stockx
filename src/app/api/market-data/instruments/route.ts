import { NextResponse } from "next/server";

import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";

import { getMockProvider } from "@/app/api/market-data/_lib/mock-source";

/**
 * The instrument master.
 *
 * This is static reference data (symbol, name, sector, market cap), not a
 * price — so it's served from `universe.ts` (via the shared mock provider,
 * which just filters that list) regardless of `MARKET_DATA_ADAPTER`. Fetching
 * Upstox's full instrument dump (a multi-megabyte gzipped JSON file per
 * exchange) isn't worth it for the fixed universe this app tracks.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Rate limited as cheap protection against scraping the instrument master.
  // Read-tier, since a legitimate client fetches this on most page loads.
  const rate = checkRateLimit(rateLimitKey(request, "md-instruments"), LIMITS.read);
  if (!rate.allowed) return tooManyRequests(rate);

  const search = new URL(request.url).searchParams;
  const query = search.get("q");
  const limitParam = search.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const provider = getMockProvider();

  if (query !== null) {
    const instruments = await provider.searchInstruments(query, limit);
    return NextResponse.json(instruments);
  }

  const instruments = await provider.listInstruments();
  return NextResponse.json(instruments);
}
