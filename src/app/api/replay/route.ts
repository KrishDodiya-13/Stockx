import { NextResponse } from "next/server";

import { jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { bigIntToNumber, prisma } from "@/lib/prisma";
import type { PriceE4 } from "@/lib/money";
import { buildRoundTrips, type Fill } from "@/services/replay/replay-engine";

export const dynamic = "force-dynamic";

/**
 * Replayable round trips, reconstructed from the account's fills.
 *
 * Round trips are derived rather than stored: the trade log is the record, and
 * a second stored representation of the same thing would be one more place for
 * the two to disagree.
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
      take: 1_000,
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

    return NextResponse.json(jsonSafe({ trips: buildRoundTrips(fills) }));
  } catch (error) {
    return serverError(error);
  }
}
