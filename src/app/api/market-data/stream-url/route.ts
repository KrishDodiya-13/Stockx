import { NextResponse } from "next/server";

import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { serverEnv } from "@/config/env";

/**
 * Mints the WebSocket URL for the live feed.
 *
 * This exists so the browser never holds a vendor credential. The client asks
 * this route for a URL on every (re)connect; a real implementation signs a
 * short-lived token here using `serverEnv.marketDataApiKey` and returns a URL
 * that expires on its own.
 *
 * `serverEnv` throws if it is ever reached from a client bundle, so the key
 * cannot leak by accident.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  /*
    Rate limited but not authenticated.

    Requiring a session here would make the live market feed depend on the
    database being configured, which is a coupling the feed does not otherwise
    have. The limit is the proportionate control instead: a legitimate client
    asks for this on connect and reconnect, so a caller hammering it is
    harvesting, not trading.
  */
  const limit = checkRateLimit(rateLimitKey(request, "stream-url"), LIMITS.write);
  if (!limit.allowed) return tooManyRequests(limit);

  const wsUrl = serverEnv.marketDataWsUrl;
  const apiKey = serverEnv.marketDataApiKey;

  if (!wsUrl || !apiKey) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "No live market data provider is configured. Set MARKET_DATA_WS_URL and MARKET_DATA_API_KEY to enable the live feed.",
      },
      { status: 503 },
    );
  }

  // A real vendor integration signs a short-lived token here rather than
  // forwarding the raw key. The key itself must never appear in the response.
  return NextResponse.json({ url: wsUrl });
}
