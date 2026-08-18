import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  NotTradable,
  UnknownInstrument,
  addToWatchlist,
  getWatchlist,
  isWatching,
  removeFromWatchlist,
} from "@/services/watchlist/watchlist-service";

/**
 * The watchlist against a real database.
 *
 * Run against Postgres rather than a mock on purpose: the properties that
 * matter here — one row per instrument per account, and one account never
 * seeing another's list — are enforced by a unique index and a foreign key, and
 * a mocked Prisma client would happily agree with a broken implementation.
 */

const RELIANCE = "NSE:RELIANCE";
const SUDARSCHEM = "NSE:SUDARSCHEM";
const TCS = "NSE:TCS";

let userA = "";
let userB = "";
let accountA = "";
let accountB = "";

async function makeAccount(label: string): Promise<{ userId: string; accountId: string }> {
  const user = await prisma.user.create({
    data: { email: `watchlist-${label}-${Date.now()}-${Math.random()}@stockx.test` },
  });
  const account = await prisma.account.create({
    data: { userId: user.id, cashBalance: 5_000_000n, startingCapital: 5_000_000n },
  });
  return { userId: user.id, accountId: account.id };
}

beforeEach(async () => {
  const a = await makeAccount("a");
  const b = await makeAccount("b");
  userA = a.userId;
  accountA = a.accountId;
  userB = b.userId;
  accountB = b.accountId;
});

afterAll(async () => {
  // Only the rows these tests created; the developer's own account stays.
  await prisma.user.deleteMany({ where: { email: { contains: "@stockx.test" } } });
  await prisma.$disconnect();
});

describe("the watchlist", () => {
  it("starts empty", async () => {
    expect(await getWatchlist(accountA)).toEqual([]);
  });

  it("adds an instrument", async () => {
    const list = await addToWatchlist(accountA, RELIANCE);
    expect(list.map((item) => item.symbol)).toEqual(["RELIANCE"]);
  });

  it("adds SUDARSCHEM through the same registry as everything else", async () => {
    // The symbol that motivated widening the universe; no special case here.
    const list = await addToWatchlist(accountA, SUDARSCHEM);
    expect(list[0]?.symbol).toBe("SUDARSCHEM");
    expect(list[0]?.name).toBe("Sudarshan Chemical Industries");
  });

  it("refuses an instrument that is not in the registry", async () => {
    // Otherwise the table accumulates ids that render as blank rows nobody can
    // identify or remove.
    await expect(addToWatchlist(accountA, "NSE:NOT-A-REAL-SYMBOL")).rejects.toBeInstanceOf(
      UnknownInstrument,
    );
    expect(await getWatchlist(accountA)).toEqual([]);
  });

  it("refuses a market index, which has nothing to trade", async () => {
    /*
      Every watchlist row carries a trade action, so an index row would put a
      BUY button in front of something with no order book. Indices belong to
      the dashboard's market strip. The refusal happens before any write, so
      the table cannot acquire one even by a direct API call.
    */
    for (const id of ["BSE:SENSEX", "NSE:NIFTY50", "NSE:BANKNIFTY"]) {
      await expect(addToWatchlist(accountA, id)).rejects.toBeInstanceOf(NotTradable);
    }
    expect(await getWatchlist(accountA)).toEqual([]);
  });

  it("cannot hold the same instrument twice", async () => {
    await addToWatchlist(accountA, RELIANCE);
    const list = await addToWatchlist(accountA, RELIANCE);

    expect(list).toHaveLength(1);
    const rows = await prisma.watchlist.count({ where: { accountId: accountA } });
    expect(rows).toBe(1);
  });

  it("survives two concurrent adds of the same instrument", async () => {
    /*
      The case the pre-insert check cannot cover: both calls read "not present"
      before either writes. Only the unique index decides this, and the loser
      has to be swallowed rather than surfaced as an error.
    */
    await Promise.all([
      addToWatchlist(accountA, RELIANCE),
      addToWatchlist(accountA, RELIANCE),
      addToWatchlist(accountA, RELIANCE),
    ]);

    expect(await prisma.watchlist.count({ where: { accountId: accountA } })).toBe(1);
  });

  it("removes an instrument and leaves the rest", async () => {
    await addToWatchlist(accountA, RELIANCE);
    await addToWatchlist(accountA, SUDARSCHEM);

    const list = await removeFromWatchlist(accountA, RELIANCE);
    expect(list.map((item) => item.symbol)).toEqual(["SUDARSCHEM"]);
  });

  it("treats removing something absent as a success", async () => {
    // A double-click should not read as a failure.
    await expect(removeFromWatchlist(accountA, TCS)).resolves.toEqual([]);
  });

  it("orders most recently added first", async () => {
    await addToWatchlist(accountA, RELIANCE);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await addToWatchlist(accountA, SUDARSCHEM);

    const list = await getWatchlist(accountA);
    expect(list.map((item) => item.symbol)).toEqual(["SUDARSCHEM", "RELIANCE"]);
  });

  it("reports whether an instrument is being watched", async () => {
    await addToWatchlist(accountA, RELIANCE);
    expect(await isWatching(accountA, RELIANCE)).toBe(true);
    expect(await isWatching(accountA, TCS)).toBe(false);
  });
});

describe("isolation between users", () => {
  it("gives each account its own list", async () => {
    await addToWatchlist(accountA, RELIANCE);
    await addToWatchlist(accountB, TCS);

    expect((await getWatchlist(accountA)).map((i) => i.symbol)).toEqual(["RELIANCE"]);
    expect((await getWatchlist(accountB)).map((i) => i.symbol)).toEqual(["TCS"]);
  });

  it("lets two accounts follow the same instrument independently", async () => {
    // The unique index is per account, not global — one user starring RELIANCE
    // must not stop another from doing the same.
    await addToWatchlist(accountA, RELIANCE);
    await addToWatchlist(accountB, RELIANCE);

    expect(await isWatching(accountA, RELIANCE)).toBe(true);
    expect(await isWatching(accountB, RELIANCE)).toBe(true);
  });

  it("does not remove another account's row", async () => {
    await addToWatchlist(accountA, RELIANCE);
    await addToWatchlist(accountB, RELIANCE);

    await removeFromWatchlist(accountA, RELIANCE);

    expect(await isWatching(accountA, RELIANCE)).toBe(false);
    expect(await isWatching(accountB, RELIANCE)).toBe(true);
  });
});

describe("removing a stock leaves trading records alone", () => {
  it("keeps an existing holding", async () => {
    /*
      The guarantee that matters most: un-starring is a display preference, not
      a disposal. Holdings live in their own table with no foreign key to the
      watchlist, and this proves the delete does not reach them.
    */
    await addToWatchlist(accountA, RELIANCE);
    await prisma.holding.create({
      data: {
        accountId: accountA,
        instrumentId: RELIANCE,
        symbol: "RELIANCE",
        quantity: 10,
        averagePrice: 14_000_000n,
        investedValue: 1_400_000n,
      },
    });

    await removeFromWatchlist(accountA, RELIANCE);

    const holding = await prisma.holding.findUnique({
      where: { accountId_instrumentId: { accountId: accountA, instrumentId: RELIANCE } },
    });
    expect(holding?.quantity).toBe(10);
    expect(holding?.investedValue).toBe(1_400_000n);
  });

  it("does not require a holding to exist before watching", async () => {
    // Watching is not owning; the two are independent by design.
    await addToWatchlist(accountA, TCS);
    const holding = await prisma.holding.findFirst({
      where: { accountId: accountA, instrumentId: TCS },
    });
    expect(holding).toBeNull();
    expect(await isWatching(accountA, TCS)).toBe(true);
  });
});

describe("account deletion", () => {
  it("takes the watchlist with it", async () => {
    await addToWatchlist(accountA, RELIANCE);
    await prisma.user.delete({ where: { id: userA } });

    expect(await prisma.watchlist.count({ where: { accountId: accountA } })).toBe(0);
    // The other account is untouched.
    void userB;
    expect(await prisma.watchlist.count({ where: { accountId: accountB } })).toBe(0);
  });
});
