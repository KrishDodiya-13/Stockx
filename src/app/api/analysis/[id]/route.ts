import { NextResponse } from "next/server";

import { jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import type { CandleInterval } from "@/domain/market";
import { bigIntToNumber, prisma } from "@/lib/prisma";
import type { Paise, PriceE4 } from "@/lib/money";
import { createAnalysisProvider } from "@/services/analysis/llm-provider";
import { extractFacts } from "@/services/analysis/trade-analysis";

import {
  buildRoundTrips,
  buildTimeline,
  replayWindow,
  type Fill,
} from "@/services/replay/replay-engine";
import { getServerMarketDataService } from "@/services/market-data/server";

export const dynamic = "force-dynamic";

function chooseInterval(spanMs: number): CandleInterval {
  const perBar = spanMs / 120;
  if (perBar <= 90_000) return "1m";
  if (perBar <= 420_000) return "5m";
  if (perBar <= 1_500_000) return "15m";
  if (perBar <= 5_400_000) return "1h";
  return "1d";
}

/**
 * A review of one completed trade.
 *
 * Facts are computed server-side from the trade record and the surrounding
 * candles; the provider only describes them. The provider is chosen here — a
 * model when a key is configured, the deterministic local reviewer otherwise —
 * and the response names which produced it, so the reader always knows.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const { id } = await context.params;
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;

    const [rows, accountRow] = await Promise.all([
      prisma.trade.findMany({
        where: { accountId: accountId },
        orderBy: { executedAt: "asc" },
        take: 1_000,
      }),
      prisma.account.findUniqueOrThrow({
        where: { id: accountId },
        select: { startingCapital: true },
      }),
    ]);

    const fills: Fill[] = rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      instrumentId: row.instrumentId,
      symbol: row.symbol,
      side: row.side as "BUY" | "SELL",
      quantity: row.quantity,
      price: bigIntToNumber(row.price) as PriceE4,
      realisedPnl: bigIntToNumber(row.realisedPnl) as never,
      source: row.source,
      executedAt: row.executedAt.getTime(),
    }));

    // Accept a trip id or any fill id within one, matching the replay route.
    const trips = buildRoundTrips(fills);
    const trip =
      trips.find((candidate) => candidate.id === id) ??
      trips.find((candidate) => candidate.fills.some((entry) => entry.id === id));

    if (!trip) {
      return NextResponse.json(
        { error: "not_found", message: "That trade could not be found." },
        { status: 404 },
      );
    }

    if (trip.status !== "CLOSED") {
      return NextResponse.json(
        {
          error: "not_closed",
          message: "This position is still open. A review is produced once a trade is complete.",
        },
        { status: 409 },
      );
    }

    const window = replayWindow(trip);
    const candles = await getServerMarketDataService().getCandles({
      instrumentId: trip.instrumentId,
      interval: chooseInterval(window.to - window.from),
      from: window.from,
      to: window.to,
    });

    const frames = buildTimeline(trip, candles);
    const facts = extractFacts(trip, frames, bigIntToNumber(accountRow.startingCapital) as Paise);

    const provider = createAnalysisProvider();
    const review = await provider.analyse(facts);

    return NextResponse.json(jsonSafe({ review, facts, provider: provider.name }));
  } catch (error) {
    return serverError(error);
  }
}
