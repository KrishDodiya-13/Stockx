import { NextResponse } from "next/server";

import { badRequest, jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import type { CandleInterval } from "@/domain/market";
import { rupeesToPaise, type Paise } from "@/lib/money";
import { runBacktest } from "@/services/backtest/backtest-engine";

import { getStrategy } from "@/services/strategy/strategy-repository";
import { getServerMarketDataService } from "@/services/market-data/server";

export const dynamic = "force-dynamic";

const INTERVALS: readonly CandleInterval[] = ["1m", "5m", "15m", "1h", "1d"];

/** Guard against a request that would generate an unusable number of bars. */
const MAX_BARS = 5_000;

/**
 * Run a backtest.
 *
 * Historical candles are fetched server-side for the requested window only —
 * `getCandles` is contractually forbidden from returning anything after `to`,
 * and the live provider re-filters defensively — so the engine cannot be handed
 * data from beyond the period under test.
 *
 * Running does not save. Saving is a separate, explicit action.
 */
export async function POST(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const body = (await request.json()) as Record<string, unknown>;

    const strategyId = typeof body.strategyId === "string" ? body.strategyId : "";
    if (!strategyId) return badRequest("`strategyId` is required.");

    const from = Number(body.from);
    const to = Number(body.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return badRequest("`from` and `to` must be epoch milliseconds.");
    }
    if (to <= from) return badRequest("`to` must be after `from`.");
    if (to > Date.now()) {
      // Backtesting into the future is meaningless, and the clamp keeps the
      // "no future data" guarantee honest at the boundary.
      return badRequest("`to` cannot be in the future.");
    }

    const interval = INTERVALS.includes(body.interval as CandleInterval)
      ? (body.interval as CandleInterval)
      : "1d";

    const capitalRupees = Number(body.initialCapital);
    if (!Number.isFinite(capitalRupees) || capitalRupees <= 0) {
      return badRequest("`initialCapital` must be above zero.");
    }
    const initialCapital: Paise = rupeesToPaise(capitalRupees);

    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;
    const strategy = await getStrategy(accountId, strategyId);
    if (!strategy) {
      return NextResponse.json(
        { error: "not_found", message: "Strategy not found." },
        { status: 404 },
      );
    }

    const service = getServerMarketDataService();
    const candles = await service.getCandles({
      instrumentId: strategy.instrumentId,
      interval,
      from,
      to,
    });

    if (candles.length > MAX_BARS) {
      return badRequest(
        `That range produces ${candles.length.toLocaleString("en-IN")} bars. Narrow the range or use a larger interval.`,
      );
    }

    const result = runBacktest({ strategy, candles, initialCapital });

    return NextResponse.json(
      jsonSafe({
        result,
        strategy: { id: strategy.id, name: strategy.name, symbol: strategy.symbol },
        window: { from, to, interval, bars: candles.length },
      }),
    );
  } catch (error) {
    return serverError(error);
  }
}
