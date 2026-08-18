import { NextResponse } from "next/server";

import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";

import { getMockProvider } from "@/app/api/market-data/_lib/mock-source";
import { handleUpstoxError } from "@/app/api/market-data/_lib/upstox-error";
import { serverEnv } from "@/config/env";
import type { Quote } from "@/domain/market";
import { fetchQuotes } from "@/services/market-data/providers/upstox/client";
import { tickToQuote, upstoxFeed } from "@/services/market-data/providers/upstox/feed";

/**
 * Server-side quote proxy for the live provider.
 *
 * The browser calls this; this calls Upstox with the credential. Besides
 * hiding the key, a single server-side choke point is where rate limiting,
 * caching and entitlement checks belong.
 *
 * When `MARKET_DATA_ADAPTER` is not `"live"`, this serves the same local
 * simulation the client-side mock provider would — kept here so the live
 * provider's `subscribe()` polling loop gets sensible data in dev even
 * without Upstox configured.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  /*
    Rate limited: this route proxies an upstream vendor call made with this
    app's own credential, so an unauthenticated caller could otherwise burn the
    account's quota. Read-tier, because a legitimate client polls it.
  */
  const limit = checkRateLimit(rateLimitKey(request, "md-quotes"), LIMITS.read);
  if (!limit.allowed) return tooManyRequests(limit);

  const ids = new URL(request.url).searchParams.get("ids");
  if (!ids) {
    return NextResponse.json(
      { error: "bad_request", message: "An `ids` query parameter is required." },
      { status: 400 },
    );
  }

  const instrumentIds = ids
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (serverEnv.marketDataAdapter !== "live") {
    const quotes = await getMockProvider().getQuotes(instrumentIds);
    return NextResponse.json(quotes);
  }

  try {
    /*
      Prefer the websocket feed's cache.

      The feed holds the most recent print for everything it is subscribed to,
      so serving from it is both fresher than a REST round trip and cheaper
      against Upstox's rate limits. It is also what keeps a page that fetches
      quotes and a page that streams them showing the same number.
    */
    // Starts the socket if it is not up; deliberately not awaited, so a
    // slow vendor connect cannot delay this response.
    upstoxFeed.ensure(instrumentIds);

    const fromFeed = new Map<string, Quote>();
    for (const id of instrumentIds) {
      const tick = upstoxFeed.latest(id);
      if (tick) fromFeed.set(id, tickToQuote(tick));
    }

    // Anything the feed has never seen — a closed market on a cold server, an
    // instrument that has not traded yet today — falls back to REST.
    const missing = instrumentIds.filter((id) => !fromFeed.has(id));
    for (const quote of missing.length > 0 ? await fetchQuotes(missing) : []) {
      fromFeed.set(quote.instrumentId, quote);
    }

    // Instruments with neither a tick nor a REST quote are simply absent. No
    // simulated price is substituted in live mode.
    const quotes = instrumentIds
      .map((id) => fromFeed.get(id))
      .filter((quote): quote is Quote => quote !== undefined);

    return NextResponse.json(quotes);
  } catch (error) {
    return handleUpstoxError(error, "quotes");
  }
}
