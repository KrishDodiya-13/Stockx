/**
 * Environment access.
 *
 * Rules enforced here:
 *  - Secrets are read through `serverEnv`, which throws if imported from the
 *    browser bundle. Nothing in this object may ever be prefixed NEXT_PUBLIC_.
 *  - `publicEnv` holds only non-sensitive mode flags safe to ship to the client.
 */

export type MarketDataAdapterName = "mock" | "live";
export type MarketDataMode = "simulated" | "live";

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "serverEnv was accessed in the browser. Server secrets must never reach the client bundle.",
    );
  }
}

/*
  Anything that is not explicitly "live" falls back to the simulator. That
  default is deliberate: a typo in this variable must never be what silently
  puts the app into live mode, and "simulated" is accepted alongside "mock"
  because both spellings appear in the docs.
*/
function parseAdapter(value: string | undefined): MarketDataAdapterName {
  return value?.trim().toLowerCase() === "live" ? "live" : "mock";
}

/**
 * An access token, or nothing — never a placeholder.
 *
 * Copying `.env.example` and forgetting to fill this line leaves the literal
 * `<paste your token here>` in the variable. Passed through, that reads as a
 * configured token, so the app reports an expired Upstox *session* on every
 * request — which sends you looking at Upstox rather than at the one line that
 * was never filled in.
 *
 * A real token is an opaque string with no whitespace and no angle brackets,
 * so anything else is treated as absent and the app says plainly that no token
 * is configured.
 */
function sanitiseToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  if (!token) return undefined;
  if (/[\s<>]/.test(token)) return undefined;
  return token;
}

function parseMode(value: string | undefined): MarketDataMode {
  return value?.trim().toLowerCase() === "live" ? "live" : "simulated";
}

/** Safe to read anywhere, including client components. */
export const publicEnv = {
  /**
   * Drives the "SIMULATED DATA" badge in the UI. Simulated data must always be
   * visibly distinguished from real market data.
   */
  marketDataMode: parseMode(process.env.NEXT_PUBLIC_MARKET_DATA_MODE),
} as const;

/** Server-only. Throws if touched from the browser. */
export const serverEnv = {
  get marketDataAdapter(): MarketDataAdapterName {
    assertServer();
    return parseAdapter(process.env.MARKET_DATA_ADAPTER);
  },
  get marketDataApiKey(): string | undefined {
    assertServer();
    return process.env.MARKET_DATA_API_KEY;
  },
  get marketDataApiSecret(): string | undefined {
    assertServer();
    return process.env.MARKET_DATA_API_SECRET;
  },
  get marketDataWsUrl(): string | undefined {
    assertServer();
    return process.env.MARKET_DATA_WS_URL;
  },
  /**
   * Upstox `client_id`. Issued when registering an app at
   * https://developer.upstox.com.
   */
  get upstoxApiKey(): string | undefined {
    assertServer();
    return process.env.UPSTOX_API_KEY;
  },
  /** Upstox `client_secret`, paired with `upstoxApiKey`. */
  get upstoxApiSecret(): string | undefined {
    assertServer();
    return process.env.UPSTOX_API_SECRET;
  },
  /**
   * OAuth redirect URI registered with the Upstox app, e.g.
   * `http://localhost:3000/api/market-data/upstox/callback`.
   */
  get upstoxRedirectUri(): string | undefined {
    assertServer();
    return process.env.UPSTOX_REDIRECT_URI;
  },
  /**
   * A manually pasted access token, for the common personal-project pattern of
   * generating one daily from the Upstox developer console instead of running
   * the OAuth login route every time. Upstox access tokens expire daily
   * (~3:30 AM IST) regardless of how they were obtained. The token-store
   * (populated by `/api/market-data/upstox/login`) is checked first; this is
   * only the fallback.
   */
  get upstoxAccessToken(): string | undefined {
    assertServer();
    return sanitiseToken(process.env.UPSTOX_ACCESS_TOKEN);
  },
  /**
   * Key for the trade-analysis model provider. Optional — without it the
   * deterministic local reviewer is used, which is the full experience rather
   * than a degraded one.
   */
  get analysisApiKey(): string | undefined {
    assertServer();
    return process.env.ANALYSIS_API_KEY;
  },
} as const;
