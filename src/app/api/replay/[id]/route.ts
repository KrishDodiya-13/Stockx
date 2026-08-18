import { NextResponse } from "next/server";

import { jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import type { CandleInterval } from "@/domain/market";
import { bigIntToNumber, prisma } from "@/lib/prisma";
import type { PriceE4 } from "@/lib/money";

import {
  buildRoundTrips,
  replayWindow,
  type Fill,
  type ReplayEventKind,
} from "@/services/replay/replay-engine";
import { getServerMarketDataService } from "@/services/market-data/server";

export const dynamic = "force-dynamic";

/** Pick a bar size that renders the window in a readable number of candles. */
function chooseInterval(spanMs: number): CandleInterval {
  const targetBars = 120;
  const perBar = spanMs / targetBars;

  if (perBar <= 90_000) return "1m";
  if (perBar <= 420_000) return "5m";
  if (perBar <= 1_500_000) return "15m";
  if (perBar <= 5_400_000) return "1h";
  return "1d";
}

/**
 * Everything needed to replay one round trip: its fills, the surrounding
 * candles, and any strategy rule that produced a fill.
 *
 * Strategy context is joined by order id, so an automated exit can be shown as
 * the stop or target it actually was rather than as an anonymous sell.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const { id } = await context.params;
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

    /*
      Accept either a round-trip id or any fill id within one.

      Trade history links from an individual fill — often a partial exit — and
      the thing worth replaying is the whole position that fill belonged to,
      not the slice on its own.
    */
    const allTrips = buildRoundTrips(fills);
    const trip =
      allTrips.find((candidate) => candidate.id === id) ??
      allTrips.find((candidate) => candidate.fills.some((entry) => entry.id === id));

    if (!trip) {
      return NextResponse.json(
        { error: "not_found", message: "That trade could not be found." },
        { status: 404 },
      );
    }

    const window = replayWindow(trip);
    const interval = chooseInterval(window.to - window.from);

    const service = getServerMarketDataService();
    const candles = await service.getCandles({
      instrumentId: trip.instrumentId,
      interval,
      from: window.from,
      to: window.to,
    });

    // Strategy rules behind any automated fills in this trip.
    const orderIds = trip.fills.map((fill) => fill.orderId);
    const executions = await prisma.strategyExecution.findMany({
      where: { orderId: { in: orderIds } },
      include: { rule: { select: { kind: true } } },
    });

    const strategyDetail: Record<string, { kind: ReplayEventKind; detail: string }> = {};
    for (const execution of executions) {
      if (!execution.orderId) continue;

      const kind: ReplayEventKind =
        execution.rule?.kind === "STOP" || execution.rule?.kind === "TRAILING_STOP"
          ? "STOP"
          : execution.rule?.kind === "TARGET"
            ? "TARGET"
            : execution.rule?.kind === "ENTRY"
              ? "ENTRY"
              : "PARTIAL_EXIT";

      strategyDetail[execution.orderId] = { kind, detail: execution.detail };
    }

    return NextResponse.json(jsonSafe({ trip, candles, interval, strategyDetail }));
  } catch (error) {
    return serverError(error);
  }
}
