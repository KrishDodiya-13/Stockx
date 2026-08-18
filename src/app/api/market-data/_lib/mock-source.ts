import { MockMarketDataProvider } from "@/services/market-data/providers/mock-provider";

/**
 * Shared server-side mock provider.
 *
 * Used by the market-data route handlers whenever `MARKET_DATA_ADAPTER` is
 * not `"live"` — including as the instrument-master source even in live mode,
 * since the instrument list itself is static reference data, not a price.
 * `streaming` defaults to off on the server (no `window`), so this never
 * starts a timer.
 */
let instance: MockMarketDataProvider | null = null;

export function getMockProvider(): MockMarketDataProvider {
  instance ??= new MockMarketDataProvider();
  return instance;
}
