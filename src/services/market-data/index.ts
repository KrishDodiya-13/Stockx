/**
 * Market-data composition root.
 *
 * The provider choice lives here and nowhere else. Application code imports
 * `getMarketDataService()` and never names a concrete provider.
 */

import { LiveMarketDataProvider } from "@/services/market-data/providers/live-provider";
import { MockMarketDataProvider } from "@/services/market-data/providers/mock-provider";
import { MarketDataService } from "@/services/market-data/market-data-service";
import type { MarketDataProvider } from "@/services/market-data/types";

export { MarketDataService, relativeVolume, VOLUME_SPIKE_THRESHOLD } from "@/services/market-data/market-data-service";
export type { HistoryPoint } from "@/services/market-data/market-data-service";
export { MockMarketDataProvider } from "@/services/market-data/providers/mock-provider";
export { LiveMarketDataProvider } from "@/services/market-data/providers/live-provider";
export { WebSocketClient } from "@/services/market-data/transport/websocket-client";
export type {
  MarketDataProvider,
  MarketDataAdapter,
  CandleRequest,
  Unsubscribe,
} from "@/services/market-data/types";
export * from "@/services/market-data/universe";

/**
 * Chooses the provider for the browser.
 *
 * This runs client-side, so it cannot read `serverEnv` (which throws there by
 * design). The mode flag is the public, non-secret mirror; credentials stay on
 * the server behind `/api/market-data/*`.
 */
function createProvider(): MarketDataProvider {
  if (process.env.NEXT_PUBLIC_MARKET_DATA_MODE === "live") {
    // Reports `offline` until a licensed vendor is wired up — it will never
    // fabricate prices to fill the gap.
    return new LiveMarketDataProvider();
  }
  return new MockMarketDataProvider();
}

let instance: MarketDataService | null = null;

/** Process-wide (or tab-wide) singleton. */
export function getMarketDataService(): MarketDataService {
  instance ??= new MarketDataService(createProvider());
  return instance;
}

/** Fresh, isolated instance — for the Time Machine and backtests. */
export function createMarketDataService(provider?: MarketDataProvider): MarketDataService {
  return new MarketDataService(provider ?? createProvider());
}
