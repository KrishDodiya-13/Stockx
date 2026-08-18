import { describe, expect, it } from "vitest";

import type { Candle } from "@/domain/market";
import { rupeesToPaise, rupeesToPrice, type Paise } from "@/lib/money";
import {
  buildRoundTrips,
  buildTimeline,
  holdExtremes,
  replayWindow,
  type Fill,
} from "@/services/replay/replay-engine";

let sequence = 0;

function fill(overrides: Partial<Fill> = {}): Fill {
  sequence += 1;
  return {
    id: `f${sequence}`,
    orderId: `o${sequence}`,
    instrumentId: "NSE:RELIANCE",
    symbol: "RELIANCE",
    side: "BUY",
    quantity: 100,
    price: rupeesToPrice(100),
    realisedPnl: 0 as Paise,
    source: "MANUAL",
    executedAt: sequence * 60_000,
    ...overrides,
  };
}

function candles(prices: readonly number[], startTime = 0, stepMs = 60_000): Candle[] {
  return prices.map((price, index) => ({
    time: startTime + index * stepMs,
    open: rupeesToPrice(price),
    high: rupeesToPrice(price),
    low: rupeesToPrice(price),
    close: rupeesToPrice(price),
    volume: 1000,
  }));
}

describe("buildRoundTrips", () => {
  it("pairs a buy and a sell into one trip", () => {
    const trips = buildRoundTrips([
      fill({ side: "BUY", quantity: 100, price: rupeesToPrice(100), executedAt: 1000 }),
      fill({
        side: "SELL",
        quantity: 100,
        price: rupeesToPrice(110),
        realisedPnl: rupeesToPaise(1000),
        executedAt: 2000,
      }),
    ]);

    expect(trips).toHaveLength(1);
    expect(trips[0]!.status).toBe("CLOSED");
    expect(trips[0]!.realisedPnl).toBe(rupeesToPaise(1000));
  });

  it("keeps partial exits inside one trip", () => {
    /*
      The reason round trips are the unit of replay: three fills, one decision.
      Splitting them would present two half-stories.
    */
    const trips = buildRoundTrips([
      fill({ side: "BUY", quantity: 100, executedAt: 1000 }),
      fill({ side: "SELL", quantity: 40, realisedPnl: rupeesToPaise(400), executedAt: 2000 }),
      fill({ side: "SELL", quantity: 60, realisedPnl: rupeesToPaise(900), executedAt: 3000 }),
    ]);

    expect(trips).toHaveLength(1);
    expect(trips[0]!.fills).toHaveLength(3);
    expect(trips[0]!.realisedPnl).toBe(rupeesToPaise(1300));
  });

  it("keeps scaling in inside one trip", () => {
    const trips = buildRoundTrips([
      fill({ side: "BUY", quantity: 50, price: rupeesToPrice(100), executedAt: 1000 }),
      fill({ side: "BUY", quantity: 50, price: rupeesToPrice(120), executedAt: 2000 }),
      fill({ side: "SELL", quantity: 100, realisedPnl: rupeesToPaise(500), executedAt: 3000 }),
    ]);

    expect(trips).toHaveLength(1);
    expect(trips[0]!.quantity).toBe(100);
    // 50 @ 100 + 50 @ 120 → average 110
    expect(trips[0]!.averageEntry).toBe(rupeesToPrice(110));
  });

  it("separates sequential trips in the same instrument", () => {
    const trips = buildRoundTrips([
      fill({ side: "BUY", quantity: 10, executedAt: 1000 }),
      fill({ side: "SELL", quantity: 10, executedAt: 2000 }),
      fill({ side: "BUY", quantity: 20, executedAt: 3000 }),
      fill({ side: "SELL", quantity: 20, executedAt: 4000 }),
    ]);

    expect(trips).toHaveLength(2);
    expect(trips.every((trip) => trip.status === "CLOSED")).toBe(true);
  });

  it("separates trips by instrument", () => {
    const trips = buildRoundTrips([
      fill({ instrumentId: "NSE:A", symbol: "A", side: "BUY", quantity: 10, executedAt: 1000 }),
      fill({ instrumentId: "NSE:B", symbol: "B", side: "BUY", quantity: 10, executedAt: 1500 }),
      fill({ instrumentId: "NSE:A", symbol: "A", side: "SELL", quantity: 10, executedAt: 2000 }),
      fill({ instrumentId: "NSE:B", symbol: "B", side: "SELL", quantity: 10, executedAt: 2500 }),
    ]);

    expect(trips).toHaveLength(2);
    expect(new Set(trips.map((trip) => trip.symbol))).toEqual(new Set(["A", "B"]));
  });

  it("returns a still-open position as an open trip", () => {
    const trips = buildRoundTrips([
      fill({ side: "BUY", quantity: 100, executedAt: 1000 }),
      fill({ side: "SELL", quantity: 40, executedAt: 2000 }),
    ]);

    expect(trips).toHaveLength(1);
    expect(trips[0]!.status).toBe("OPEN");
    expect(trips[0]!.closedAt).toBeNull();
  });

  it("ignores a sell with no matching entry rather than inventing one", () => {
    // Its opening fills predate the window we were given.
    const trips = buildRoundTrips([
      fill({ side: "SELL", quantity: 50, executedAt: 1000 }),
      fill({ side: "BUY", quantity: 10, executedAt: 2000 }),
      fill({ side: "SELL", quantity: 10, executedAt: 3000 }),
    ]);

    expect(trips).toHaveLength(1);
    expect(trips[0]!.quantity).toBe(10);
  });

  it("orders trips newest first", () => {
    const trips = buildRoundTrips([
      fill({ side: "BUY", quantity: 10, executedAt: 1000 }),
      fill({ side: "SELL", quantity: 10, executedAt: 2000 }),
      fill({ side: "BUY", quantity: 10, executedAt: 5000 }),
      fill({ side: "SELL", quantity: 10, executedAt: 6000 }),
    ]);

    expect(trips[0]!.openedAt).toBeGreaterThan(trips[1]!.openedAt);
  });

  it("flags a trip containing an automated fill", () => {
    const trips = buildRoundTrips([
      fill({ side: "BUY", quantity: 10, executedAt: 1000, source: "STRATEGY" }),
      fill({ side: "SELL", quantity: 10, executedAt: 2000 }),
    ]);

    expect(trips[0]!.automated).toBe(true);
  });

  it("returns nothing for no fills", () => {
    expect(buildRoundTrips([])).toHaveLength(0);
  });
});

describe("buildTimeline", () => {
  const trip = buildRoundTrips([
    fill({ side: "BUY", quantity: 100, price: rupeesToPrice(100), executedAt: 60_000 }),
    fill({
      side: "SELL",
      quantity: 100,
      price: rupeesToPrice(120),
      realisedPnl: rupeesToPaise(2000),
      executedAt: 240_000,
    }),
  ])[0]!;

  const bars = candles([95, 100, 110, 115, 120, 118], 0, 60_000);

  it("produces one frame per candle", () => {
    expect(buildTimeline(trip, bars)).toHaveLength(bars.length);
  });

  it("attaches each fill to the bar containing it", () => {
    const frames = buildTimeline(trip, bars);

    expect(frames[0]!.events).toHaveLength(0);
    expect(frames[1]!.events[0]).toMatchObject({ kind: "ENTRY", side: "BUY" });
    expect(frames[4]!.events[0]).toMatchObject({ kind: "EXIT", side: "SELL" });
  });

  it("tracks the position as of each bar, not the final state", () => {
    const frames = buildTimeline(trip, bars);

    expect(frames[0]!.position).toBe(0); // before entry
    expect(frames[1]!.position).toBe(100);
    expect(frames[3]!.position).toBe(100); // still holding
    expect(frames[4]!.position).toBe(0); // exited
  });

  it("shows unrealised P&L only while the position is open", () => {
    const frames = buildTimeline(trip, bars);

    expect(frames[0]!.unrealisedPnl).toBe(0);
    // Bought at 100, bar closes at 110 → +₹1,000 on 100 shares.
    expect(frames[2]!.unrealisedPnl).toBe(rupeesToPaise(1000));
    // Flat again.
    expect(frames[5]!.unrealisedPnl).toBe(0);
  });

  it("books realised P&L from the exit bar onward", () => {
    const frames = buildTimeline(trip, bars);

    expect(frames[3]!.realisedPnl).toBe(0);
    expect(frames[4]!.realisedPnl).toBe(rupeesToPaise(2000));
    expect(frames[5]!.realisedPnl).toBe(rupeesToPaise(2000));
  });

  it("marks a partial exit distinctly from a full one", () => {
    const partial = buildRoundTrips([
      fill({ side: "BUY", quantity: 100, price: rupeesToPrice(100), executedAt: 60_000 }),
      fill({ side: "SELL", quantity: 40, price: rupeesToPrice(110), realisedPnl: rupeesToPaise(400), executedAt: 120_000 }),
      fill({ side: "SELL", quantity: 60, price: rupeesToPrice(120), realisedPnl: rupeesToPaise(1200), executedAt: 240_000 }),
    ])[0]!;

    const frames = buildTimeline(partial, bars);
    const kinds = frames.flatMap((frame) => frame.events.map((event) => event.kind));

    expect(kinds).toEqual(["ENTRY", "PARTIAL_EXIT", "EXIT"]);
  });

  it("labels events from a strategy when detail is supplied", () => {
    const detail = new Map([
      [trip.fills[1]!.orderId, { kind: "STOP" as const, detail: "Stop loss at ₹95" }],
    ]);

    const frames = buildTimeline(trip, bars, detail);
    const exit = frames.flatMap((frame) => frame.events).find((event) => event.side === "SELL");

    expect(exit?.kind).toBe("STOP");
    expect(exit?.detail).toBe("Stop loss at ₹95");
  });

  it("returns nothing when there are no candles", () => {
    expect(buildTimeline(trip, [])).toHaveLength(0);
  });
});

describe("holdExtremes", () => {
  it("finds the best and worst unrealised points during the hold", () => {
    const trip = buildRoundTrips([
      fill({ side: "BUY", quantity: 100, price: rupeesToPrice(100), executedAt: 60_000 }),
      fill({ side: "SELL", quantity: 100, price: rupeesToPrice(105), realisedPnl: rupeesToPaise(500), executedAt: 300_000 }),
    ])[0]!;

    // Dips to 90, peaks at 130, exits at 105.
    const bars = candles([100, 100, 90, 130, 105, 105], 0, 60_000);
    const { bestUnrealised, worstUnrealised } = holdExtremes(buildTimeline(trip, bars));

    expect(bestUnrealised).toBe(rupeesToPaise(3000));
    expect(worstUnrealised).toBe(rupeesToPaise(-1000));
  });

  it("is zero when nothing was ever held", () => {
    expect(holdExtremes([])).toEqual({ bestUnrealised: 0, worstUnrealised: 0 });
  });
});

describe("replayWindow", () => {
  it("pads both sides of the trip", () => {
    const trip = buildRoundTrips([
      fill({ side: "BUY", quantity: 10, executedAt: 1_000_000 }),
      fill({ side: "SELL", quantity: 10, executedAt: 2_000_000 }),
    ])[0]!;

    const window = replayWindow(trip);

    expect(window.from).toBeLessThan(trip.openedAt);
    expect(window.to).toBeGreaterThan(trip.closedAt!);
  });

  it("never extends past the present", () => {
    const trip = buildRoundTrips([
      fill({ side: "BUY", quantity: 10, executedAt: Date.now() - 60_000 }),
      fill({ side: "SELL", quantity: 10, executedAt: Date.now() - 30_000 }),
    ])[0]!;

    expect(replayWindow(trip).to).toBeLessThanOrEqual(Date.now());
  });
});
