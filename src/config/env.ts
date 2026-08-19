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
  /**
   * Google OAuth client id, from the Google Cloud Console.
   *
   * Not a secret in the strict sense — it is sent to the browser as part of the
   * authorise redirect — but it is read here rather than exposed as a
   * NEXT_PUBLIC_ variable so the client id and its secret stay together, and so
   * the "is Google sign-in available" question has one answer computed on the
   * server.
   */
  get googleClientId(): string | undefined {
    assertServer();
    return sanitiseToken(process.env.GOOGLE_CLIENT_ID);
  },
  /** Google OAuth client secret. Never leaves the server. */
  get googleClientSecret(): string | undefined {
    assertServer();
    return sanitiseToken(process.env.GOOGLE_CLIENT_SECRET);
  },
  /**
   * Resend API key, for transactional email (currently password resets only).
   *
   * Optional. Without it no email is sent and the password-reset route still
   * returns its usual generic response — the flow degrades to "no mail
   * arrives", not to an error that would tell a stranger whether an address is
   * registered.
   */
  get resendApiKey(): string | undefined {
    assertServer();
    return sanitiseToken(process.env.RESEND_API_KEY);
  },
  /**
   * The From address for transactional email, e.g.
   * `STOCKX <no-reply@yourdomain.com>`. Its domain must be verified with the
   * email provider or every send is rejected.
   */
  get emailFrom(): string | undefined {
    assertServer();
    return process.env.EMAIL_FROM?.trim() || undefined;
  },
  /**
   * The app's own public origin, used to build absolute links in email.
   *
   * A reset link cannot be a relative path, and it must not be built from the
   * request's `Host` header: that header is attacker-controlled, and trusting
   * it is how a reset email ends up pointing at someone else's server with a
   * live token attached. So the origin is configuration, never input.
   *
   * Falls back to Vercel's own deployment URL, then to localhost for
   * development.
   */
  get appUrl(): string {
    assertServer();

    const configured = process.env.APP_URL?.trim();
    if (configured) return configured.replace(/\/+$/, "");

    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

    return "http://localhost:3000";
  },
} as const;
