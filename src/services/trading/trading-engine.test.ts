import { describe, expect, it } from "vitest";

import type { Quote } from "@/domain/market";
import type { AccountState, Holding } from "@/domain/trading";
import { rupeesToPaise, rupeesToPrice, type Paise, type PriceE4 } from "@/lib/money";
import {
  applyFill,
  computePortfolio,
  isLimitExecutable,
  maxBuyQuantity,
  validateOrder,
} from "@/services/trading/trading-engine";

const CAPITAL = rupeesToPaise(1_000_000);

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: "h1",
    instrumentId: "NSE:RELIANCE",
    symbol: "RELIANCE",
    quantity: 100,
    averagePrice: rupeesToPrice(1000),
    investedValue: rupeesToPaise(100_000),
    ...overrides,
  };
}

function account(overrides: Partial<AccountState> = {}): AccountState {
  return { cashBalance: CAPITAL, holdings: [], ...overrides };
}

function quote(instrumentId: string, price: number, previousClose = price): Quote {
  return {
    instrumentId,
    price: rupeesToPrice(price),
    previousClose: rupeesToPrice(previousClose),
    open: rupeesToPrice(previousClose),
    dayHigh: rupeesToPrice(Math.max(price, previousClose)),
    dayLow: rupeesToPrice(Math.min(price, previousClose)),
    volume: 1_000,
    averageVolume: 1_000,
    change: (rupeesToPrice(price) - rupeesToPrice(previousClose)) as PriceE4,
    changePercent: ((price - previousClose) / previousClose) * 100,
    timestamp: 0,
    source: "simulated",
  };
}

describe("validateOrder", () => {
  const base = {
    instrumentId: "NSE:RELIANCE",
    symbol: "RELIANCE",
    limitPrice: null,
    marketPrice: rupeesToPrice(1000),
  } as const;

  it("accepts a market buy within the cash balance", () => {
    const result = validateOrder({ ...base, side: "BUY", type: "MARKET", quantity: 100 }, account());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(rupeesToPaise(100_000));
  });

  it("rejects a buy that exceeds available cash", () => {
    const result = validateOrder(
      { ...base, side: "BUY", type: "MARKET", quantity: 2_000 },
      account(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("insufficient-funds");
  });

  it("rejects selling more shares than are held", () => {
    const result = validateOrder(
      { ...base, side: "SELL", type: "MARKET", quantity: 150 },
      account({ holdings: [holding({ quantity: 100 })] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("insufficient-shares");
  });

  it("rejects selling an instrument that is not held", () => {
    const result = validateOrder(
      { ...base, side: "SELL", type: "MARKET", quantity: 1 },
      account(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("insufficient-shares");
  });

  it.each([0, -5, 1.5, Number.NaN])("rejects an invalid quantity: %s", (quantity) => {
    const result = validateOrder({ ...base, side: "BUY", type: "MARKET", quantity }, account());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid-quantity");
  });

  it("rejects a limit order with no limit price", () => {
    const result = validateOrder(
      { ...base, side: "BUY", type: "LIMIT", quantity: 10, limitPrice: null },
      account(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing-limit-price");
  });

  it("rejects an order it cannot price", () => {
    const result = validateOrder(
      { ...base, side: "BUY", type: "MARKET", quantity: 10, marketPrice: null },
      account(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("no-market-price");
  });

  /*
    A limit price is a bound, not the price.

    The engine used to fill every limit order *at* its limit. For a buy whose
    limit sits below the market that happens to be the right number — it is the
    worst case the order reserves cash for while it rests — which is why the
    first case here passed throughout. The bug only showed on a marketable
    limit, where filling at the limit means paying far above the market: a buy
    limit of ₹9,99,999 against a ₹4,000 market filled at ₹9,99,999.
  */
  describe("limit order pricing", () => {
    it("reserves at the limit for a buy that will rest below the market", () => {
      const result = validateOrder(
        {
          ...base,
          side: "BUY",
          type: "LIMIT",
          quantity: 10,
          limitPrice: rupeesToPrice(990),
          marketPrice: rupeesToPrice(1000),
        },
        account(),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.executionPrice).toBe(rupeesToPrice(990));
    });

    it("fills a marketable buy at the market, never above it", () => {
      const result = validateOrder(
        {
          ...base,
          side: "BUY",
          type: "LIMIT",
          quantity: 10,
          limitPrice: rupeesToPrice(999_999),
          marketPrice: rupeesToPrice(1000),
        },
        account(),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.executionPrice).toBe(rupeesToPrice(1000));
    });

    it("fills a marketable sell at the market, never below it", () => {
      const result = validateOrder(
        {
          ...base,
          side: "SELL",
          type: "LIMIT",
          quantity: 10,
          limitPrice: rupeesToPrice(1),
          marketPrice: rupeesToPrice(1000),
        },
        account({ holdings: [holding({ quantity: 100 })] }),
      );
      expect(result.ok).toBe(true);
      // Filling at the ₹1 limit would have given the shares away.
      if (result.ok) expect(result.executionPrice).toBe(rupeesToPrice(1000));
    });

    it("reserves at the limit for a sell that will rest above the market", () => {
      const result = validateOrder(
        {
          ...base,
          side: "SELL",
          type: "LIMIT",
          quantity: 10,
          limitPrice: rupeesToPrice(1100),
          marketPrice: rupeesToPrice(1000),
        },
        account({ holdings: [holding({ quantity: 100 })] }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.executionPrice).toBe(rupeesToPrice(1100));
    });

    it("never fills a buy worse than the limit, at any market price", () => {
      for (const market of [1, 500, 999, 1000, 1001, 5000, 999_999]) {
        const result = validateOrder(
          {
            ...base,
            side: "BUY",
            type: "LIMIT",
            quantity: 1,
            limitPrice: rupeesToPrice(1000),
            marketPrice: rupeesToPrice(market),
          },
          account(),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.executionPrice).toBeLessThanOrEqual(rupeesToPrice(1000));
          expect(result.executionPrice).toBe(rupeesToPrice(Math.min(market, 1000)));
        }
      }
    });

    it("never fills a sell worse than the limit, at any market price", () => {
      for (const market of [1, 500, 999, 1000, 1001, 5000, 999_999]) {
        const result = validateOrder(
          {
            ...base,
            side: "SELL",
            type: "LIMIT",
            quantity: 1,
            limitPrice: rupeesToPrice(1000),
            marketPrice: rupeesToPrice(market),
          },
          account({ holdings: [holding({ quantity: 100 })] }),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.executionPrice).toBeGreaterThanOrEqual(rupeesToPrice(1000));
          expect(result.executionPrice).toBe(rupeesToPrice(Math.max(market, 1000)));
        }
      }
    });
  });

  it("allows a buy that spends the balance exactly", () => {
    const result = validateOrder(
      { ...base, side: "BUY", type: "MARKET", quantity: 1_000 },
      account(),
    );
    expect(result.ok).toBe(true);
  });
});

describe("isLimitExecutable", () => {
  it("fills a buy limit only at or below its price", () => {
    expect(isLimitExecutable("BUY", rupeesToPrice(100), rupeesToPrice(99))).toBe(true);
    expect(isLimitExecutable("BUY", rupeesToPrice(100), rupeesToPrice(100))).toBe(true);
    expect(isLimitExecutable("BUY", rupeesToPrice(100), rupeesToPrice(101))).toBe(false);
  });

  it("fills a sell limit only at or above its price", () => {
    expect(isLimitExecutable("SELL", rupeesToPrice(100), rupeesToPrice(101))).toBe(true);
    expect(isLimitExecutable("SELL", rupeesToPrice(100), rupeesToPrice(99))).toBe(false);
  });
});

describe("applyFill — buying", () => {
  it("opens a position and debits cash", () => {
    const result = applyFill(null, CAPITAL, "BUY", 100, rupeesToPrice(1000));

    expect(result.holding?.quantity).toBe(100);
    expect(result.holding?.averagePrice).toBe(rupeesToPrice(1000));
    expect(result.holding?.investedValue).toBe(rupeesToPaise(100_000));
    expect(result.cashBalance).toBe(rupeesToPaise(900_000));
    expect(result.realisedPnl).toBe(0);
  });

  it("re-weights average price when adding at a different price", () => {
    const first = applyFill(null, CAPITAL, "BUY", 100, rupeesToPrice(100));
    const second = applyFill(first.holding, first.cashBalance, "BUY", 100, rupeesToPrice(200));

    // 100 @ ₹100 + 100 @ ₹200 → 200 @ ₹150
    expect(second.holding?.quantity).toBe(200);
    expect(second.holding?.averagePrice).toBe(rupeesToPrice(150));
    expect(second.holding?.investedValue).toBe(rupeesToPaise(30_000));
  });

  it("never books profit on a purchase", () => {
    expect(applyFill(null, CAPITAL, "BUY", 10, rupeesToPrice(999)).realisedPnl).toBe(0);
  });
});

describe("applyFill — selling", () => {
  it("books profit and credits cash on a full exit", () => {
    const open = applyFill(null, CAPITAL, "BUY", 100, rupeesToPrice(1000));
    const close = applyFill(open.holding, open.cashBalance, "SELL", 100, rupeesToPrice(1100));

    expect(close.holding).toBeNull();
    expect(close.realisedPnl).toBe(rupeesToPaise(10_000));
    // Started at ₹10,00,000, made ₹10,000.
    expect(close.cashBalance).toBe(rupeesToPaise(1_010_000));
  });

  it("books a loss correctly", () => {
    const open = applyFill(null, CAPITAL, "BUY", 100, rupeesToPrice(1000));
    const close = applyFill(open.holding, open.cashBalance, "SELL", 100, rupeesToPrice(900));

    expect(close.realisedPnl).toBe(rupeesToPaise(-10_000));
    expect(close.cashBalance).toBe(rupeesToPaise(990_000));
  });

  it("leaves average price unchanged on a partial exit", () => {
    const open = applyFill(null, CAPITAL, "BUY", 100, rupeesToPrice(1000));
    const partial = applyFill(open.holding, open.cashBalance, "SELL", 40, rupeesToPrice(1200));

    expect(partial.holding?.quantity).toBe(60);
    // Selling part of a position does not change what the rest cost.
    expect(partial.holding?.averagePrice).toBe(rupeesToPrice(1000));
    expect(partial.holding?.investedValue).toBe(rupeesToPaise(60_000));
    expect(partial.realisedPnl).toBe(rupeesToPaise(8_000));
  });

  it("leaves no residual invested value when fully closed in pieces", () => {
    // A price that does not divide evenly, to expose rounding residue.
    const open = applyFill(null, CAPITAL, "BUY", 7, rupeesToPrice(333.33));
    const first = applyFill(open.holding, open.cashBalance, "SELL", 3, rupeesToPrice(400));
    const second = applyFill(first.holding, first.cashBalance, "SELL", 4, rupeesToPrice(400));

    expect(second.holding).toBeNull();

    // Total realised must equal proceeds minus the original cost exactly.
    const totalRealised = first.realisedPnl + second.realisedPnl;
    const cost = open.value;
    const proceeds = first.value + second.value;
    expect(totalRealised).toBe(proceeds - cost);
  });

  it("conserves cash across a full round trip at the same price", () => {
    const open = applyFill(null, CAPITAL, "BUY", 137, rupeesToPrice(1234.56));
    const close = applyFill(open.holding, open.cashBalance, "SELL", 137, rupeesToPrice(1234.56));

    expect(close.realisedPnl).toBe(0);
    expect(close.cashBalance).toBe(CAPITAL);
  });

  it("refuses to sell more than is held", () => {
    expect(() => applyFill(holding({ quantity: 10 }), CAPITAL, "SELL", 11, rupeesToPrice(100))).toThrow();
  });
});

describe("computePortfolio", () => {
  it("reports an untouched account as all cash and zero P&L", () => {
    const summary = computePortfolio(CAPITAL, CAPITAL, 0 as Paise, [], new Map());

    expect(summary.totalValue).toBe(CAPITAL);
    expect(summary.investedValue).toBe(0);
    expect(summary.totalPnl).toBe(0);
    expect(summary.totalPnlPercent).toBe(0);
    expect(summary.holdings).toHaveLength(0);
  });

  it("keeps cash + holdings equal to total value", () => {
    const holdings = [
      holding({ instrumentId: "NSE:RELIANCE", quantity: 100, investedValue: rupeesToPaise(100_000) }),
      holding({
        id: "h2",
        instrumentId: "NSE:TCS",
        symbol: "TCS",
        quantity: 50,
        averagePrice: rupeesToPrice(3000),
        investedValue: rupeesToPaise(150_000),
      }),
    ];

    const quotes = new Map([
      ["NSE:RELIANCE", quote("NSE:RELIANCE", 1100)],
      ["NSE:TCS", quote("NSE:TCS", 2900)],
    ]);

    const cash = rupeesToPaise(750_000);
    const summary = computePortfolio(cash, CAPITAL, 0 as Paise, holdings, quotes);

    expect(summary.holdingsValue).toBe(rupeesToPaise(110_000 + 145_000));
    expect(summary.totalValue).toBe(cash + summary.holdingsValue);
    // +10,000 on RELIANCE, −5,000 on TCS
    expect(summary.unrealisedPnl).toBe(rupeesToPaise(5_000));
  });

  it("adds realised and unrealised into total P&L", () => {
    const summary = computePortfolio(
      rupeesToPaise(950_000),
      CAPITAL,
      rupeesToPaise(20_000),
      [holding()],
      new Map([["NSE:RELIANCE", quote("NSE:RELIANCE", 1100)]]),
    );

    expect(summary.realisedPnl).toBe(rupeesToPaise(20_000));
    expect(summary.unrealisedPnl).toBe(rupeesToPaise(10_000));
    expect(summary.totalPnl).toBe(rupeesToPaise(30_000));
    expect(summary.totalPnlPercent).toBeCloseTo(3);
  });

  it("values a holding at cost when its quote is missing, not at zero", () => {
    const summary = computePortfolio(
      rupeesToPaise(900_000),
      CAPITAL,
      0 as Paise,
      [holding()],
      new Map(),
    );

    expect(summary.holdingsValue).toBe(rupeesToPaise(100_000));
    expect(summary.unrealisedPnl).toBe(0);
    expect(summary.holdings[0]?.lastPrice).toBeNull();
    // Losing a quote must not look like losing money.
    expect(summary.totalValue).toBe(CAPITAL);
  });

  it("computes day P&L from the previous close, not from cost", () => {
    const summary = computePortfolio(
      rupeesToPaise(900_000),
      CAPITAL,
      0 as Paise,
      [holding()],
      // Bought at 1000, closed yesterday at 1050, now 1100.
      new Map([["NSE:RELIANCE", quote("NSE:RELIANCE", 1100, 1050)]]),
    );

    expect(summary.unrealisedPnl).toBe(rupeesToPaise(10_000));
    expect(summary.dayPnl).toBe(rupeesToPaise(5_000));
  });

  it("orders holdings by current value, largest first", () => {
    const summary = computePortfolio(
      CAPITAL,
      CAPITAL,
      0 as Paise,
      [
        holding({ instrumentId: "NSE:A", symbol: "A", quantity: 1, investedValue: rupeesToPaise(100) }),
        holding({ id: "h2", instrumentId: "NSE:B", symbol: "B", quantity: 10, investedValue: rupeesToPaise(9_000) }),
      ],
      new Map([
        ["NSE:A", quote("NSE:A", 100)],
        ["NSE:B", quote("NSE:B", 900)],
      ]),
    );

    expect(summary.holdings[0]?.symbol).toBe("B");
  });
});

describe("full lifecycle", () => {
  it("conserves value across buy, partial sell and close", () => {
    let cash = CAPITAL;
    let held: Holding | null = null;
    let realised = 0 as Paise;

    const buy = applyFill(held, cash, "BUY", 200, rupeesToPrice(500));
    ({ cashBalance: cash } = buy);
    held = buy.holding;

    const partial = applyFill(held, cash, "SELL", 80, rupeesToPrice(600));
    cash = partial.cashBalance;
    held = partial.holding;
    realised = (realised + partial.realisedPnl) as Paise;

    const close = applyFill(held, cash, "SELL", 120, rupeesToPrice(450));
    cash = close.cashBalance;
    held = close.holding;
    realised = (realised + close.realisedPnl) as Paise;

    expect(held).toBeNull();

    // 80 × (600−500) = +8,000; 120 × (450−500) = −6,000 → +2,000
    expect(realised).toBe(rupeesToPaise(2_000));
    // With nothing held, cash must equal starting capital plus realised P&L.
    expect(cash).toBe(CAPITAL + realised);

    const summary = computePortfolio(cash, CAPITAL, realised, [], new Map());
    expect(summary.totalValue).toBe(CAPITAL + realised);
    expect(summary.totalPnl).toBe(realised);
  });
});

describe("maxBuyQuantity", () => {
  it("never proposes more than the cash can buy", () => {
    expect(maxBuyQuantity(rupeesToPaise(10_000), rupeesToPrice(999))).toBe(10);
  });

  it("returns zero for a non-positive price", () => {
    expect(maxBuyQuantity(CAPITAL, 0 as PriceE4)).toBe(0);
  });
});
