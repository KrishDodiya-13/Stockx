import { NextResponse } from "next/server";

import { jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { bigIntToNumber, prisma } from "@/lib/prisma";
import { percentChange, priceToRupees, type Paise, type PriceE4 } from "@/lib/money";
import {
  evaluateAchievements,
  evaluateChallenges,
  type AccountSnapshot,
} from "@/services/gamification/challenges";
import {
  periodWindow,
  scoreAccounts,
  type AccountRecord,
  type LeaderboardPeriod,
} from "@/services/gamification/scoring";
import { instrumentId } from "@/services/market-data";
import { buildRoundTrips, type Fill } from "@/services/replay/replay-engine";
import { getServerMarketDataService } from "@/services/market-data/server";

export const dynamic = "force-dynamic";

const PERIODS: readonly LeaderboardPeriod[] = ["weekly", "monthly", "all-time"];
const NIFTY = instrumentId("NSE", "NIFTY50");

/**
 * Leaderboard, challenges and achievements.
 *
 * The board is built from real accounts only — none are seeded and none are
 * invented. With a single account it contains a single entry, which is the
 * honest result rather than a padded one.
 */
export async function GET(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;

    const requested = new URL(request.url).searchParams.get("period");
    const period: LeaderboardPeriod = PERIODS.includes(requested as LeaderboardPeriod)
      ? (requested as LeaderboardPeriod)
      : "all-time";

    const window = periodWindow(period);
    const benchmarkPercent = await benchmarkMove(window.from, window.to);

    const accounts = await prisma.account.findMany({
      select: {
        id: true,
        name: true,
        startingCapital: true,
        cashBalance: true,
        realisedPnl: true,
        user: { select: { name: true, email: true } },
      },
    });

    /*
      One trade query for the whole board, not one per account.

      This used to `await buildRecord(...)` inside a loop, which is a sequential
      N+1: with a hundred accounts it issued a hundred round trips one after
      another, and the page got linearly slower as the product succeeded. The
      leaderboard was already the slowest route in the app at a handful of
      accounts.

      Trades are fetched in a single query and grouped in memory. The per-account
      arithmetic is unchanged — `buildRecord` still owns it — it is only the
      fetching that moved.
    */
    const allTrades = await prisma.trade.findMany({
      where: {
        accountId: { in: accounts.map((account) => account.id) },
        ...(window.from === null ? {} : { executedAt: { gte: new Date(window.from) } }),
      },
      orderBy: { executedAt: "asc" },
    });

    const tradesByAccount = new Map<string, typeof allTrades>();
    for (const trade of allTrades) {
      const bucket = tradesByAccount.get(trade.accountId);
      if (bucket) bucket.push(trade);
      else tradesByAccount.set(trade.accountId, [trade]);
    }

    const records: AccountRecord[] = accounts.map((account) =>
      buildRecord(account, tradesByAccount.get(account.id) ?? [], benchmarkPercent),
    );

    const scored = scoreAccounts(records);

    /*
      Other people's account ids never leave the server.

      A leaderboard has to publish everyone's *performance* — that is the whole
      point — but it does not have to publish an identifier that other routes
      key on. Each row is reduced to a public shape carrying an `isYou` flag
      instead, so the client can highlight the caller's row without ever
      learning anyone else's account id.
    */
    const leaderboard = scored.map(({ accountId: entryAccountId, ...entry }) => ({
      ...entry,
      isYou: entryAccountId === accountId,
    }));

    // Challenges and achievements are always about *this* account.
    const snapshot = await buildSnapshot(accountId, benchmarkPercent);

    return NextResponse.json(
      jsonSafe({
        period,
        benchmarkPercent,
        leaderboard,
        you: leaderboard.find((entry) => entry.isYou) ?? null,
        challenges: evaluateChallenges(snapshot),
        achievements: evaluateAchievements(snapshot),
        participantCount: accounts.length,
      }),
    );
  } catch (error) {
    return serverError(error);
  }
}

/** NIFTY 50's move across the period, used as the benchmark. */
async function benchmarkMove(from: number | null, to: number): Promise<number> {
  try {
    const service = getServerMarketDataService();
    const start = from ?? to - 90 * 86_400_000;

    const candles = await service.getCandles({
      instrumentId: NIFTY,
      interval: "1d",
      from: start,
      to,
    });

    const first = candles[0];
    const last = candles[candles.length - 1];
    if (!first || !last) return 0;

    return percentChange(priceToRupees(first.close), priceToRupees(last.close));
  } catch {
    // A benchmark that cannot be fetched is reported as flat rather than
    // guessed at, so outperformance degrades to plain return.
    return 0;
  }
}

interface AccountRow {
  id: string;
  name: string;
  startingCapital: bigint;
  cashBalance: bigint;
  realisedPnl: bigint;
  user: { name: string | null; email: string };
}

/**
 * Score one account from trades already fetched for it.
 *
 * Takes the trades rather than loading them, so the caller can fetch the whole
 * board in one query. Pure apart from that.
 */
function buildRecord(
  account: AccountRow,
  trades: readonly TradeRow[],
  benchmarkPercent: number,
): AccountRecord {
  const trips = buildRoundTrips(trades.map(toFill)).filter((trip) => trip.status === "CLOSED");

  const startingCapital = bigIntToNumber(account.startingCapital) as Paise;
  const realised = trips.reduce((total, trip) => total + trip.realisedPnl, 0);

  // Peak-to-trough on the realised path across the period.
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trip of trips) {
    running += trip.realisedPnl;
    if (running > peak) peak = running;
    if (peak - running > maxDrawdown) maxDrawdown = peak - running;
  }

  return {
    accountId: account.id,
    // Never the email local part: a leaderboard is public to every signed-in
    // user, and an address is not something they chose to publish.
    displayName: account.user.name ?? "Anonymous trader",
    startingCapital,
    endingEquity: (startingCapital + realised) as Paise,
    closedTrades: trips.length,
    wins: trips.filter((trip) => trip.realisedPnl > 0).length,
    losses: trips.filter((trip) => trip.realisedPnl < 0).length,
    maxDrawdown: maxDrawdown as Paise,
    tradePnls: trips.map((trip) => trip.realisedPnl),
    benchmarkPercent,
  };
}

async function buildSnapshot(
  accountId: string,
  benchmarkPercent: number,
): Promise<AccountSnapshot> {
  const [account, trades, strategies, activated] = await Promise.all([
    prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { startingCapital: true, cashBalance: true, realisedPnl: true },
    }),
    prisma.trade.findMany({ where: { accountId }, orderBy: { executedAt: "asc" }, take: 2_000 }),
    prisma.strategy.count({ where: { accountId } }),
    prisma.strategy.count({ where: { accountId, activatedAt: { not: null } } }),
  ]);

  const trips = buildRoundTrips(trades.map(toFill)).filter((trip) => trip.status === "CLOSED");

  const startingCapital = bigIntToNumber(account.startingCapital) as Paise;
  const realised = trips.reduce((total, trip) => total + trip.realisedPnl, 0);

  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trip of trips) {
    running += trip.realisedPnl;
    if (running > peak) peak = running;
    if (peak - running > maxDrawdown) maxDrawdown = peak - running;
  }

  const wins = trips.filter((trip) => trip.realisedPnl > 0);
  const losses = trips.filter((trip) => trip.realisedPnl < 0);
  const hold = (trip: (typeof trips)[number]): number =>
    (trip.closedAt ?? trip.openedAt) - trip.openedAt;

  const mean = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

  // Trades produced by a strategy that also had a stop rule are the closest
  // available proxy for "this position was protected".
  const automated = trips.filter((trip) => trip.automated).length;

  return {
    startingCapital,
    currentEquity: (startingCapital + realised) as Paise,
    returnPercent: startingCapital === 0 ? 0 : (realised / startingCapital) * 100,
    benchmarkPercent,
    closedTrades: trips.length,
    wins: wins.length,
    winRate: trips.length === 0 ? 0 : (wins.length / trips.length) * 100,
    maxDrawdownPercent: startingCapital === 0 ? 0 : (maxDrawdown / startingCapital) * 100,
    strategiesCreated: strategies,
    strategiesActivated: activated,
    tradesWithStops: automated,
    averageWinHoldMs: mean(wins.map(hold)),
    averageLossHoldMs: mean(losses.map(hold)),
    consistency: evenness(trips.map((trip) => Math.abs(trip.realisedPnl))),
  };
}

function evenness(values: readonly number[]): number | null {
  const positive = values.filter((value) => value > 0);
  if (positive.length < 10) return null;

  const average = positive.reduce((a, b) => a + b, 0) / positive.length;
  if (average === 0) return null;

  const variance =
    positive.reduce((total, value) => total + (value - average) ** 2, 0) / positive.length;
  return Math.max(0, Math.min(100, 100 * (1 - Math.min(Math.sqrt(variance) / average, 1))));
}

/** The trade columns the leaderboard arithmetic needs. */
interface TradeRow {
  id: string;
  orderId: string;
  instrumentId: string;
  symbol: string;
  side: string;
  quantity: number;
  price: bigint;
  realisedPnl: bigint;
  source: string;
  executedAt: Date;
}

function toFill(row: TradeRow): Fill {
  return {
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
  };
}
