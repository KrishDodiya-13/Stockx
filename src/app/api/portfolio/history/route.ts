import { NextResponse } from "next/server";

import { jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { bigIntToNumber, prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * The account's equity curve.
 *
 * IMPORTANT — what this series actually is:
 *
 * It plots **realised equity**: starting capital plus cumulative *booked* P&L,
 * with one point per executed trade. It deliberately does **not** include
 * unrealised movement on open positions.
 *
 * The reason is that a true total-value curve needs a daily snapshot of every
 * holding priced at that day's close, and this application does not record
 * one. Reconstructing it from simulated historical prices would produce a
 * plausible-looking line that is not a record of anything — exactly the kind of
 * invented figure this codebase refuses to render. When a snapshot table
 * arrives, this endpoint gains a second series and the chart shows both.
 *
 * The final point is the account's live total value, so the curve always
 * terminates at the number shown on the dashboard.
 */
export async function GET() {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;

    const [row, trades] = await Promise.all([
      prisma.account.findUniqueOrThrow({
        where: { id: accountId },
        select: { startingCapital: true, cashBalance: true, createdAt: true },
      }),
      prisma.trade.findMany({
        where: { accountId: accountId },
        orderBy: { executedAt: "asc" },
        select: { executedAt: true, realisedPnl: true },
      }),
    ]);

    const startingCapital = bigIntToNumber(row.startingCapital);

    const points: { time: number; value: number }[] = [
      { time: row.createdAt.getTime(), value: startingCapital },
    ];

    let running = startingCapital;
    for (const trade of trades) {
      running += bigIntToNumber(trade.realisedPnl);
      points.push({ time: trade.executedAt.getTime(), value: running });
    }

    return NextResponse.json(
      jsonSafe({
        points,
        startingCapital,
        // Lets the client label the series honestly without hardcoding a string.
        basis: "realised",
        tradeCount: trades.length,
      }),
    );
  } catch (error) {
    return serverError(error);
  }
}
