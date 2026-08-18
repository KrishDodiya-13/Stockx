import { NextResponse } from "next/server";

import { jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import type { Quote } from "@/domain/market";
import { prisma } from "@/lib/prisma";

import { getPortfolio } from "@/services/trading/order-service";
import { getServerMarketDataService } from "@/services/market-data/server";

export const dynamic = "force-dynamic";

/**
 * The account's full financial state.
 *
 * Valuation happens on the server against server-fetched quotes, so the client
 * never computes a balance. Only the instruments actually held are quoted —
 * pricing the whole universe to value three holdings would be wasteful.
 */
export async function GET() {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;

    const held = await prisma.holding.findMany({
      where: { accountId: accountId },
      select: { instrumentId: true },
    });

    const quotes = new Map<string, Quote>();
    if (held.length > 0) {
      const service = getServerMarketDataService();
      for (const quote of await service.getQuotes(held.map((h) => h.instrumentId))) {
        quotes.set(quote.instrumentId, quote);
      }
    }

    return NextResponse.json(jsonSafe({ portfolio: await getPortfolio(accountId, quotes) }));
  } catch (error) {
    return serverError(error);
  }
}
