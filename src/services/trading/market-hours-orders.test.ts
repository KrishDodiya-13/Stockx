import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rupeesToPaise, type Paise } from "@/lib/money";
import { bigIntToNumber, prisma } from "@/lib/prisma";
import { createAccountForUser } from "@/services/auth/session";
import { instrumentId } from "@/services/market-data";
import { MARKET_CLOSED_MESSAGE, placeOrder } from "@/services/trading/order-service";

/**
 * Market hours, enforced at the order-execution layer.
 *
 * These run against a real database, because the claim being tested is not
 * "the function returns a rejection" but "nothing was written" — and only the
 * database can answer that. Skipped when no `DATABASE_URL` is configured, so a
 * checkout without Postgres still runs the rest of the suite.
 *
 * The clock is injected rather than faked globally: `placeOrder` takes the
 * moment to judge, so each case names the IST time a trader would see.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);

/** IST is a fixed UTC+05:30, so an IST wall-clock time is one exact instant. */
function ist(date: string, hour: number, minute: number): Date {
  const midnightUtc = new Date(`${date}T00:00:00.000Z`).getTime();
  return new Date(midnightUtc + (hour - 5) * 3_600_000 + (minute - 30) * 60_000);
}

// 2026-08-17 is a Monday; the 22nd and 23rd are Saturday and Sunday.
const MONDAY = "2026-08-17";
const SATURDAY = "2026-08-22";
const SUNDAY = "2026-08-23";

const RELIANCE = instrumentId("NSE", "RELIANCE");
const OPEN_MOMENT = ist(MONDAY, 11, 0);

describe.skipIf(!HAS_DB)("order execution respects market hours", () => {
  let accountId = "";
  let userId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `hours-${Date.now()}@stockx.test`, name: "Hours" },
      select: { id: true },
    });
    userId = user.id;
    accountId = await createAccountForUser(user.id, rupeesToPaise(500_000));
  });

  afterAll(async () => {
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** Everything a rejected order must leave untouched. */
  async function snapshot() {
    const [account, holdings, positions, orders, trades, transactions] = await Promise.all([
      prisma.account.findUniqueOrThrow({
        where: { id: accountId },
        select: { cashBalance: true, startingCapital: true, realisedPnl: true },
      }),
      prisma.holding.count({ where: { accountId } }),
      prisma.position.count({ where: { accountId } }),
      prisma.order.count({ where: { accountId } }),
      prisma.trade.count({ where: { accountId } }),
      prisma.transaction.count({ where: { accountId } }),
    ]);

    return {
      cash: bigIntToNumber(account.cashBalance) as Paise,
      startingCapital: bigIntToNumber(account.startingCapital) as Paise,
      realisedPnl: bigIntToNumber(account.realisedPnl) as Paise,
      holdings,
      positions,
      orders,
      trades,
      transactions,
    };
  }

  function order(side: "BUY" | "SELL", quantity = 10) {
    return {
      instrumentId: RELIANCE,
      symbol: "RELIANCE",
      side,
      type: "MARKET" as const,
      quantity,
      limitPrice: null,
      marketPrice: rupeesToPaise(1_400) as never,
      source: "MANUAL" as const,
    };
  }

  const CLOSED_CASES: readonly [string, Date][] = [
    ["09:14 — one minute before the open", ist(MONDAY, 9, 14)],
    ["15:30 — the moment of close", ist(MONDAY, 15, 30)],
    ["16:00 — after hours", ist(MONDAY, 16, 0)],
    ["03:00 — overnight", ist(MONDAY, 3, 0)],
    ["Saturday midday", ist(SATURDAY, 12, 0)],
    ["Sunday midday", ist(SUNDAY, 12, 0)],
  ];

  for (const [label, moment] of CLOSED_CASES) {
    for (const side of ["BUY", "SELL"] as const) {
      it(`rejects a ${side} at ${label}`, async () => {
        const before = await snapshot();
        const result = await placeOrder(accountId, order(side), moment);

        expect(result.ok).toBe(false);
        expect(result.status).toBe("REJECTED");
        expect(result.message).toBe(MARKET_CLOSED_MESSAGE);
        expect(result.filledQuantity).toBe(0);
        expect(result.executionPrice).toBeNull();

        // The substance of the requirement: nothing moved.
        expect(await snapshot()).toEqual(before);
      });
    }
  }

  it("does not record the refused order anywhere", async () => {
    const before = await snapshot();
    await placeOrder(accountId, order("BUY"), ist(MONDAY, 16, 0));
    const after = await snapshot();

    // Not even as a REJECTED row: the refusal happens before the transaction,
    // so an active strategy cannot fill the history overnight.
    expect(after.orders).toBe(before.orders);
    expect(after.trades).toBe(before.trades);
    expect(after.transactions).toBe(before.transactions);
  });

  it("allows a BUY at 09:15, the first tradable minute", async () => {
    const result = await placeOrder(accountId, order("BUY", 5), ist(MONDAY, 9, 15));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("FILLED");
  });

  it("allows a BUY at 15:29, the last tradable minute", async () => {
    const result = await placeOrder(accountId, order("BUY", 5), ist(MONDAY, 15, 29));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("FILLED");
  });

  it("moves cash, holdings and the ledger when the market is open", async () => {
    const before = await snapshot();
    const result = await placeOrder(accountId, order("BUY", 10), OPEN_MOMENT);
    const after = await snapshot();

    expect(result.ok).toBe(true);
    expect(after.cash).toBeLessThan(before.cash);
    expect(after.orders).toBe(before.orders + 1);
    expect(after.trades).toBe(before.trades + 1);
    expect(after.transactions).toBe(before.transactions + 1);
  });

  it("allows a SELL of held shares while open, then refuses the same sell once closed", async () => {
    const open = await placeOrder(accountId, order("SELL", 5), OPEN_MOMENT);
    expect(open.ok).toBe(true);

    const before = await snapshot();
    const closed = await placeOrder(accountId, order("SELL", 5), ist(MONDAY, 16, 0));

    expect(closed.ok).toBe(false);
    expect(closed.message).toBe(MARKET_CLOSED_MESSAGE);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a strategy order too, not just a manual one", async () => {
    // The automated pathway reaches the same function, so it is gated by the
    // same check rather than by a second copy of the rule.
    const before = await snapshot();
    const result = await placeOrder(
      accountId,
      { ...order("BUY"), source: "STRATEGY" as const },
      ist(SUNDAY, 11, 0),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toBe(MARKET_CLOSED_MESSAGE);
    expect(await snapshot()).toEqual(before);
  });
});
