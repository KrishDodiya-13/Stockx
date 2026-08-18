import { NextResponse } from "next/server";

import { badRequest, jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { bigIntToNumber, numberToBigInt, prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Saved backtests, newest first. */
export async function GET() {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;
    const rows = await prisma.backtest.findMany({
      where: { accountId: accountId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json(
      jsonSafe({
        backtests: rows.map((row) => ({
          id: row.id,
          name: row.name,
          strategyName: row.strategyName,
          symbol: row.symbol,
          fromTime: bigIntToNumber(row.fromTime),
          toTime: bigIntToNumber(row.toTime),
          interval: row.interval,
          initialCapital: bigIntToNumber(row.initialCapital),
          finalEquity: bigIntToNumber(row.finalEquity),
          totalReturn: bigIntToNumber(row.totalReturn),
          totalReturnPercent: row.totalReturnPercent,
          tradeCount: row.tradeCount,
          winRate: row.winRate,
          profitFactor: row.profitFactor,
          maxDrawdownPercent: row.maxDrawdownPercent,
          createdAt: row.createdAt.getTime(),
        })),
      }),
    );
  } catch (error) {
    return serverError(error);
  }
}

/**
 * Save a completed backtest.
 *
 * Results are stored as run, not recomputed on read: a strategy can be edited
 * after the fact, and a saved record whose numbers silently changed would be
 * worse than no record at all.
 */
export async function POST(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const body = (await request.json()) as Record<string, unknown>;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length === 0) return badRequest("`name` is required.");

    const result = body.result as Record<string, unknown> | undefined;
    if (!result) return badRequest("`result` is required.");

    const strategyId = typeof body.strategyId === "string" ? body.strategyId : null;
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;

    const created = await prisma.backtest.create({
      data: {
        accountId: accountId,
        name,
        strategyId,
        strategyName: typeof body.strategyName === "string" ? body.strategyName : "Unknown",
        instrumentId: typeof body.instrumentId === "string" ? body.instrumentId : "",
        symbol: typeof body.symbol === "string" ? body.symbol : "",
        fromTime: numberToBigInt(Number(body.from)),
        toTime: numberToBigInt(Number(body.to)),
        interval: typeof body.interval === "string" ? body.interval : "1d",

        initialCapital: numberToBigInt(Number(result.initialCapital)),
        finalEquity: numberToBigInt(Number(result.finalEquity)),
        totalReturn: numberToBigInt(Number(result.totalReturn)),
        totalReturnPercent: Number(result.totalReturnPercent),

        tradeCount: Number(result.tradeCount),
        winCount: Number(result.winCount),
        lossCount: Number(result.lossCount),
        winRate: Number(result.winRate),
        profitFactor:
          result.profitFactor === null || result.profitFactor === undefined
            ? null
            : Number(result.profitFactor),

        maxDrawdown: numberToBigInt(Number(result.maxDrawdown)),
        maxDrawdownPercent: Number(result.maxDrawdownPercent),

        averageTrade: numberToBigInt(Number(result.averageTrade)),
        bestTrade:
          result.bestTrade && typeof result.bestTrade === "object"
            ? numberToBigInt(Number((result.bestTrade as { pnl: number }).pnl))
            : null,
        worstTrade:
          result.worstTrade && typeof result.worstTrade === "object"
            ? numberToBigInt(Number((result.worstTrade as { pnl: number }).pnl))
            : null,

        trades: (result.trades ?? []) as never,
      },
      select: { id: true },
    });

    return NextResponse.json(jsonSafe({ id: created.id }), { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
