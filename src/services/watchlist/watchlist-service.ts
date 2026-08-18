import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { INSTRUMENT_BY_ID } from "@/services/market-data/universe";

/**
 * The watchlist, as the server owns it.
 *
 * ── Scoping ────────────────────────────────────────────────────────────────
 *
 * Every function here takes an `accountId` resolved from the session by
 * `requireAccount()`. None of them accepts one from the client, so a caller
 * cannot read or edit another user's list by naming it — the same rule the
 * holdings and orders routes follow.
 *
 * ── What a watchlist row is not ────────────────────────────────────────────
 *
 * It records only that an instrument is followed. No price, no change, no
 * volume: those come from the market-data service when the page is read, so a
 * row written last week cannot be mistaken for a current quote.
 *
 * Removing a row removes nothing else. Holdings, positions, orders and trades
 * are separate tables with no foreign key to this one, so un-starring a symbol
 * cannot touch a position the user actually owns.
 */

export interface WatchlistItem {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly name: string;
  readonly addedAt: number;
}

export class UnknownInstrument extends Error {
  constructor(instrumentId: string) {
    super(`Unknown instrument: ${instrumentId}`);
    this.name = "UnknownInstrument";
  }
}

/**
 * Raised when something untradable is starred.
 *
 * The watchlist is a list of things the user might trade — every row in it
 * carries a trade action. A market index has no order book, so a row for one
 * would offer a BUY button against an instrument that cannot be bought.
 * Indices belong to the dashboard's market strip instead.
 */
export class NotTradable extends Error {
  constructor(instrumentId: string) {
    super(
      `${instrumentId} is a market index, not a tradable instrument. Indices appear in the market section, not the watchlist.`,
    );
    this.name = "NotTradable";
  }
}

/** The account's watchlist, most recently added first. */
export async function getWatchlist(accountId: string): Promise<readonly WatchlistItem[]> {
  const rows = await prisma.watchlist.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) => ({
    instrumentId: row.instrumentId,
    /*
      Names come from the registry, not the stored row. The registry is the
      source of truth, so a company that has since been renamed displays
      correctly rather than showing whatever was current when it was starred.
    */
    symbol: INSTRUMENT_BY_ID.get(row.instrumentId)?.symbol ?? row.symbol,
    name: INSTRUMENT_BY_ID.get(row.instrumentId)?.name ?? row.symbol,
    addedAt: row.createdAt.getTime(),
  }));
}

/**
 * Add an instrument, idempotently.
 *
 * Adding something already present is a success, not an error: two taps on a
 * star should leave one row and no complaint. The unique index is what actually
 * guarantees that — the check below races, and P2002 is the branch that wins.
 */
export async function addToWatchlist(
  accountId: string,
  instrumentId: string,
): Promise<readonly WatchlistItem[]> {
  const instrument = INSTRUMENT_BY_ID.get(instrumentId);
  // Validated against the registry so the table cannot accumulate ids that
  // resolve to nothing and render as blank, un-removable rows.
  if (!instrument) throw new UnknownInstrument(instrumentId);
  if (instrument.kind !== "equity") throw new NotTradable(instrumentId);

  try {
    await prisma.watchlist.create({
      data: { accountId, instrumentId, symbol: instrument.symbol },
    });
  } catch (error) {
    const duplicate =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    if (!duplicate) throw error;
    // Already following it. Nothing to do.
  }

  return getWatchlist(accountId);
}

/**
 * Stop following an instrument.
 *
 * Removing something absent is also a success — the caller's intent ("this
 * should not be on my list") is already satisfied, and reporting an error would
 * make a double-click look like a failure.
 */
export async function removeFromWatchlist(
  accountId: string,
  instrumentId: string,
): Promise<readonly WatchlistItem[]> {
  await prisma.watchlist.deleteMany({ where: { accountId, instrumentId } });
  return getWatchlist(accountId);
}

/** Whether this account is following the instrument. */
export async function isWatching(accountId: string, instrumentId: string): Promise<boolean> {
  const row = await prisma.watchlist.findUnique({
    where: { accountId_instrumentId: { accountId, instrumentId } },
    select: { id: true },
  });
  return row !== null;
}
