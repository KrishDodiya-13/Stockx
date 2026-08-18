import { NextResponse } from "next/server";

import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";

import { getMockProvider } from "@/app/api/market-data/_lib/mock-source";
import { handleUpstoxError } from "@/app/api/market-data/_lib/upstox-error";
import { serverEnv } from "@/config/env";
import type { CandleInterval } from "@/domain/market";
import { fetchCandles } from "@/services/market-data/providers/upstox/client";

export const dynamic = "force-dynamic";

const INTERVALS: readonly CandleInterval[] = ["1m", "5m", "15m", "1h", "1d"];

function isCandleInterval(value: string | null): value is CandleInterval {
  return INTERVALS.includes(value as CandleInterval);
}

export async function GET(request: Request) {
  /*
    Rate limited: this route proxies an upstream vendor call made with this
    app's own credential, so an unauthenticated caller could otherwise burn the
    account's quota. Read-tier, because a legitimate client polls it.
  */
  const limit = checkRateLimit(rateLimitKey(request, "md-candles"), LIMITS.read);
  if (!limit.allowed) return tooManyRequests(limit);

  const search = new URL(request.url).searchParams;
  const id = search.get("id");
  const interval = search.get("interval");
  const fromParam = search.get("from");
  const toParam = search.get("to");
  const from = fromParam === null ? NaN : Number(fromParam);
  const to = toParam === null ? NaN : Number(toParam);

  if (!id || !isCandleInterval(interval) || !Number.isFinite(from) || !Number.isFinite(to)) {
    return NextResponse.json(
      {
        error: "bad_request",
        message: "`id`, `interval` (1m|5m|15m|1h|1d), `from` and `to` (epoch ms) are required.",
      },
      { status: 400 },
    );
  }

  if (serverEnv.marketDataAdapter !== "live") {
    const candles = await getMockProvider().getCandles({ instrumentId: id, interval, from, to });
    return NextResponse.json(candles);
  }

  try {
    const candles = await fetchCandles(id, interval, from, to);
    return NextResponse.json(candles);
  } catch (error) {
    return handleUpstoxError(error, "candles");
  }
}
