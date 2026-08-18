import { NextResponse } from "next/server";

import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";

import { getMockProvider } from "@/app/api/market-data/_lib/mock-source";
import { serverEnv } from "@/config/env";

/**
 * Sector performance.
 *
 * Doing this properly means market-cap-weighting every constituent of every
 * sector from live quotes — worth building, but not part of this integration.
 *
 * In live mode it therefore returns nothing rather than the simulator's
 * numbers. `SectorPerformance` carries no `source` field, so a simulated
 * heatmap sitting on a page labelled "Live market data" would have no way to
 * announce itself as invented. An empty heatmap is the honest answer; the rest
 * of the page is unaffected.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Rate limited for consistency with the other market-data routes; this one
  // computes locally and spends no vendor quota.
  const limit = checkRateLimit(rateLimitKey(request, "md-sectors"), LIMITS.read);
  if (!limit.allowed) return tooManyRequests(limit);

  if (serverEnv.marketDataAdapter === "live") return NextResponse.json([]);

  const sectors = await getMockProvider().getSectorPerformance();
  return NextResponse.json(sectors);
}
