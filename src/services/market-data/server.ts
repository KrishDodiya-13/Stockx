import "server-only";

import { getMockProvider } from "@/app/api/market-data/_lib/mock-source";
import { serverEnv } from "@/config/env";
import { MarketDataService } from "@/services/market-data/market-data-service";
import { UpstoxServerProvider } from "@/services/market-data/providers/upstox/server-provider";
import type { MarketDataProvider } from "@/services/market-data/types";

/**
 * Market-data composition root for the server.
 *
 * ── Why this is separate from `index.ts` ───────────────────────────────────
 *
 * `index.ts` composes the provider for the *browser*, and browser code cannot
 * import anything that touches a credential. Route handlers, however, run in
 * Node and must not fetch this app's own API routes to price something — a
 * relative URL has no origin on the server, so the request throws before it is
 * sent.
 *
 * Keeping the two roots apart means each side gets the provider that actually
 * works where it runs, and `server-only` makes it a build error to confuse
 * them.
 *
 * Server code should import `getServerMarketDataService()` from here.
 * Client components keep importing `getMarketDataService()` from `index.ts`.
 */

function createServerProvider(): MarketDataProvider {
  if (serverEnv.marketDataAdapter === "live") {
    return new UpstoxServerProvider();
  }
  /*
    The same simulator instance the market-data routes serve from, so a page
    that renders on the server and the same page after hydration agree about
    what the simulated market is doing.
  */
  return getMockProvider();
}

let instance: MarketDataService | null = null;

/** Process-wide singleton for route handlers and server-side services. */
export function getServerMarketDataService(): MarketDataService {
  instance ??= new MarketDataService(createServerProvider());
  return instance;
}
