import { NextResponse } from "next/server";

import { getMockProvider } from "@/app/api/market-data/_lib/mock-source";
import { serverEnv } from "@/config/env";
import type { MarketPhase, MarketStatus } from "@/domain/market";

export const dynamic = "force-dynamic";

/** NSE/BSE cash-market session, in minutes from midnight IST. */
const SESSION_OPEN_MIN = 9 * 60 + 15;
const SESSION_CLOSE_MIN = 15 * 60 + 30;
const PRE_OPEN_MIN = 9 * 60;

/**
 * Upstox has no single "is the market open" endpoint worth calling on every
 * poll, so live mode derives the phase the same way the simulator does — from
 * IST wall-clock time — and just tags it `source: "live"` instead of
 * `"simulated"`.
 */
function liveMarketStatus(): MarketStatus {
  const now = new Date();
  const istMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  const day = (now.getUTCDay() + (now.getUTCHours() * 60 + now.getUTCMinutes() + 330 >= 1440 ? 1 : 0)) % 7;

  let phase: MarketPhase = "closed";
  if (day !== 0 && day !== 6) {
    if (istMinutes >= SESSION_OPEN_MIN && istMinutes < SESSION_CLOSE_MIN) phase = "open";
    else if (istMinutes >= PRE_OPEN_MIN && istMinutes < SESSION_OPEN_MIN) phase = "pre-open";
  }

  return { phase, timestamp: now.getTime(), source: "live" };
}

export async function GET() {
  if (serverEnv.marketDataAdapter !== "live") {
    const status = await getMockProvider().getMarketStatus();
    return NextResponse.json(status);
  }

  return NextResponse.json(liveMarketStatus());
}
