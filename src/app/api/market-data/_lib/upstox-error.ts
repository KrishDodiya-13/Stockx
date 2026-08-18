import { NextResponse } from "next/server";

import { UpstoxAuthError, UpstoxRequestError } from "@/services/market-data/providers/upstox/client";

/**
 * Maps an error thrown by the Upstox client into the JSON error shape every
 * market-data route returns, so a caller (or the live provider's polling
 * loop) can tell "Upstox session expired" apart from "Upstox is unreachable"
 * apart from "something else went wrong here".
 */
export function handleUpstoxError(error: unknown, context: string): NextResponse {
  if (error instanceof UpstoxAuthError) {
    // A token that was never set and one that has expired look identical from
    // the outside and need opposite fixes, so they get separate codes.
    return NextResponse.json(
      error.configured
        ? {
            error: "upstox_auth_expired",
            message: "Upstox session expired — visit /api/market-data/upstox/login again.",
          }
        : {
            error: "upstox_not_configured",
            message:
              "No Upstox access token configured. Set UPSTOX_ACCESS_TOKEN in .env, or run MARKET_DATA_ADAPTER=mock to use the simulator.",
          },
      { status: 401 },
    );
  }

  if (error instanceof UpstoxRequestError) {
    console.error(`[market-data/${context}] upstox request failed`, error);
    return NextResponse.json({ error: "upstream_error", message: error.message }, { status: 502 });
  }

  console.error(`[market-data/${context}] unexpected error`, error);
  return NextResponse.json(
    { error: "server_error", message: "Could not fetch market data." },
    { status: 500 },
  );
}
