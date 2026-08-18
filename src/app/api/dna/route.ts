import { NextResponse } from "next/server";

import { jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { bigIntToNumber, prisma } from "@/lib/prisma";
import type { PriceE4 } from "@/lib/money";
import { analyseTrades, generateInsights, type InstrumentMeta } from "@/services/dna/dna-engine";
import { INSTRUMENTS } from "@/services/market-data";
import { buildRoundTrips, type Fill } from "@/services/replay/replay-engine";

export const dynamic = "force-dynamic";

/**
 * The trader's DNA profile.
 *
 * Built from the same round-trip reconstruction the replay feature uses, so the
 * two can never characterise the same trade differently.
 *
 * The analysis is descriptive only — it reports what already happened and
 * withholds any figure that rests on too small a sample.
 */
export async function GET() {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;

    const rows = await prisma.trade.findMany({
      where: { accountId: accountId },
      orderBy: { executedAt: "asc" },
      take: 2_000,
    });

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

    const instruments = new Map<string, InstrumentMeta>(
      INSTRUMENTS.map((instrument) => [
        instrument.id,
        { symbol: instrument.symbol, sector: instrument.sector },
      ]),
    );

    const profile = analyseTrades(buildRoundTrips(fills), instruments);

    return NextResponse.json(jsonSafe({ profile, insights: generateInsights(profile) }));
  } catch (error) {
    return serverError(error);
  }
}
