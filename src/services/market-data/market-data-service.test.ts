import { describe, expect, it, vi } from "vitest";

import type { Tick } from "@/domain/market";
import { priceToRupees, rupeesToPrice } from "@/lib/money";
import { MarketDataService, relativeVolume } from "@/services/market-data/market-data-service";
import { MockMarketDataProvider } from "@/services/market-data/providers/mock-provider";
import { INSTRUMENTS, SEED_BY_ID, instrumentId } from "@/services/market-data/universe";

const EQUITY_IDS = INSTRUMENTS.filter((i) => i.kind === "equity").map((i) => i.id);
const RELIANCE = instrumentId("NSE", "RELIANCE");

/** A provider that never starts timers, so tests drive the clock themselves. */
function createService(): { service: MarketDataService; provider: MockMarketDataProvider } {
  const provider = new MockMarketDataProvider({ seed: "test-seed", streaming: false });
  return { service: new MarketDataService(provider), provider };
}

describe("MockMarketDataProvider", () => {
  it("is deterministic for a given seed, so SSR and the client agree", async () => {
    const a = new MockMarketDataProvider({ seed: "fixed", streaming: false });
    const b = new MockMarketDataProvider({ seed: "fixed", streaming: false });

    const [qa] = await a.getQuotes([RELIANCE]);
    const [qb] = await b.getQuotes([RELIANCE]);

    expect(qa?.price).toBe(qb?.price);
    expect(qa?.previousClose).toBe(qb?.previousClose);
    expect(qa?.averageVolume).toBe(qb?.averageVolume);
  });

  it("labels every quote as simulated", async () => {
    const { service } = createService();
    const quotes = await service.getQuotes(EQUITY_IDS.slice(0, 5));

    expect(quotes).not.toHaveLength(0);
    for (const quote of quotes) expect(quote.source).toBe("simulated");
  });

  it("keeps changePercent consistent with price and previousClose", async () => {
    const { service } = createService();
    const quotes = await service.getQuotes(EQUITY_IDS);

    for (const quote of quotes) {
      // The simulator always knows its own previous close, so every quote it
      // produces must carry one — a null here would mean the mock had started
      // hiding data the way a real feed can.
      expect(quote.previousClose, quote.instrumentId).not.toBeNull();

      const expected =
        ((quote.price - quote.previousClose!) / quote.previousClose!) * 100;
      expect(quote.changePercent).toBeCloseTo(expected, 6);
    }
  });

  it("never returns a candle after the requested window", async () => {
    const { service } = createService();
    const to = Date.UTC(2025, 2, 15, 10, 0, 0);
    const from = to - 60 * 60_000;

    const candles = await service.getCandles({
      instrumentId: RELIANCE,
      interval: "1m",
      from,
      to,
    });

    expect(candles.length).toBeGreaterThan(0);
    for (const candle of candles) {
      expect(candle.time).toBeGreaterThanOrEqual(from);
      // The Time Machine's no-future-data guarantee depends on this bound.
      expect(candle.time).toBeLessThanOrEqual(to);
    }
  });

  it("produces candles whose high and low actually bound open and close", async () => {
    const { service } = createService();
    const to = Date.UTC(2025, 2, 15, 10, 0, 0);

    const candles = await service.getCandles({
      instrumentId: RELIANCE,
      interval: "5m",
      from: to - 6 * 60 * 60_000,
      to,
    });

    for (const candle of candles) {
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
    }
  });
});

describe("MarketDataService subscriptions", () => {
  it("multiplexes many listeners onto one upstream subscription", () => {
    const { service, provider } = createService();
    const subscribe = vi.spyOn(provider, "subscribe");

    const off1 = service.subscribeQuote(RELIANCE, () => {});
    const off2 = service.subscribeQuote(RELIANCE, () => {});
    const off3 = service.subscribeQuote(RELIANCE, () => {});

    expect(subscribe).toHaveBeenCalledTimes(1);

    off1();
    off2();
    off3();
  });

  it("releases the upstream subscription only when the last listener leaves", () => {
    const { service, provider } = createService();
    const unsubscribe = vi.fn();
    vi.spyOn(provider, "subscribe").mockReturnValue(unsubscribe);

    const off1 = service.subscribeQuote(RELIANCE, () => {});
    const off2 = service.subscribeQuote(RELIANCE, () => {});

    off1();
    expect(unsubscribe).not.toHaveBeenCalled();

    off2();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("records price history for sparklines as quotes arrive", async () => {
    const { service } = createService();

    expect(service.getHistory(RELIANCE)).toHaveLength(0);
    await service.getQuote(RELIANCE);
    expect(service.getHistory(RELIANCE)).toHaveLength(1);
    await service.getQuote(RELIANCE);
    expect(service.getHistory(RELIANCE)).toHaveLength(2);
  });
});

describe("the day's change as ticks arrive", () => {
  /**
   * Seed the cache, then hand back a function that pushes ticks into the
   * service as the provider would.
   */
  async function tickable() {
    const { service, provider } = createService();
    const seeded = await service.getQuote(RELIANCE);

    let push: ((tick: Tick) => void) | null = null;
    vi.spyOn(provider, "subscribe").mockImplementation((_ids, onTick) => {
      push = onTick;
      return () => {};
    });

    service.subscribeQuote(RELIANCE, () => {});
    return { service, seeded: seeded!, push: push! as (tick: Tick) => void };
  }

  function tick(price: number, overrides: Partial<Tick> = {}): Tick {
    return {
      instrumentId: RELIANCE,
      price: rupeesToPrice(price),
      volume: 1_000,
      timestamp: Date.now(),
      source: "live",
      ...overrides,
    };
  }

  it("recomputes the percentage against the previous close on every tick", async () => {
    const { service, seeded, push } = await tickable();
    const previousClose = priceToRupees(seeded.previousClose!);

    for (const price of [previousClose * 1.05, previousClose * 0.97, previousClose * 1.2]) {
      push(tick(price));

      const quote = service.peekQuote(RELIANCE)!;
      expect(quote.changePercent).toBeCloseTo(((price - previousClose) / previousClose) * 100, 4);
    }
  });

  it("measures from the previous close, never from the last tick", async () => {
    /*
      The distinction that matters: two ticks at the same price must report the
      same day change. Computing from the previous tick — or from whatever the
      cell last rendered — would make the second one read 0.00%, and the figure
      would then depend on when the page happened to be opened.
    */
    const { service, seeded, push } = await tickable();
    const previousClose = priceToRupees(seeded.previousClose!);
    const price = previousClose * 1.1;

    push(tick(price));
    const first = service.peekQuote(RELIANCE)!.changePercent;

    push(tick(price));
    const second = service.peekQuote(RELIANCE)!.changePercent;

    expect(second).toBe(first);
    expect(second).toBeCloseTo(10, 6);
  });

  it("adopts a previous close that a tick carries", async () => {
    // Upstox sends `cp` on every LTPC frame. A close learned there must reach
    // the quote, or a row seeded without one would show "--" forever.
    const { service, push } = await tickable();

    push(tick(110, { previousClose: rupeesToPrice(100) }));

    const quote = service.peekQuote(RELIANCE)!;
    expect(priceToRupees(quote.previousClose!)).toBeCloseTo(100, 4);
    expect(quote.changePercent).toBeCloseTo(10, 6);
  });

  it("keeps the cached close when a tick says nothing about it", async () => {
    const { service, seeded, push } = await tickable();

    push(tick(priceToRupees(seeded.price)));

    expect(service.peekQuote(RELIANCE)!.previousClose).toBe(seeded.previousClose);
  });

  it("reports an unknown change, not zero, when a tick clears the close", async () => {
    const { service, push } = await tickable();

    push(tick(110, { previousClose: null }));

    const quote = service.peekQuote(RELIANCE)!;
    expect(quote.previousClose).toBeNull();
    expect(quote.changePercent).toBeNull();
    expect(quote.change).toBeNull();
    // The price still updates: an unknown change does not freeze the row.
    expect(priceToRupees(quote.price)).toBeCloseTo(110, 4);
  });

  it("leaves instruments with no known change out of breadth and the movers", async () => {
    /*
      An instrument whose move is unknown is not an unchanged one. Counting it
      as flat would pad the breadth reading with instruments that may have done
      anything at all, and it has no business being ranked among the day's
      biggest movers either.
    */
    const { service, provider } = createService();
    await service.getQuotes(EQUITY_IDS);

    const before = service.buildSnapshot({ limit: 8 });
    expect(before.advancing + before.declining + before.unchanged).toBe(EQUITY_IDS.length);

    let push: ((tick: Tick) => void) | null = null;
    vi.spyOn(provider, "subscribe").mockImplementation((_ids, onTick) => {
      push = onTick;
      return () => {};
    });
    service.subscribeQuote(RELIANCE, () => {});

    // A feed frame that carries no `cp`, exactly as Upstox can send.
    (push! as (tick: Tick) => void)({
      instrumentId: RELIANCE,
      price: rupeesToPrice(1_400),
      volume: 1_000,
      timestamp: Date.now(),
      source: "live",
      previousClose: null,
    });

    const after = service.buildSnapshot({ limit: 8 });
    expect(after.advancing + after.declining + after.unchanged).toBe(EQUITY_IDS.length - 1);
    expect(after.gainers.every((entry) => entry.instrument.id !== RELIANCE)).toBe(true);
    expect(after.losers.every((entry) => entry.instrument.id !== RELIANCE)).toBe(true);
  });
});

describe("market snapshot", () => {
  it("ranks gainers descending and losers ascending, without overlap", async () => {
    const { service } = createService();
    await service.getQuotes(EQUITY_IDS);

    const snapshot = service.buildSnapshot({ limit: 8 });

    for (let i = 1; i < snapshot.gainers.length; i += 1) {
      expect(snapshot.gainers[i - 1]!.quote.changePercent!).toBeGreaterThanOrEqual(
        snapshot.gainers[i]!.quote.changePercent!,
      );
    }
    for (let i = 1; i < snapshot.losers.length; i += 1) {
      expect(snapshot.losers[i - 1]!.quote.changePercent!).toBeLessThanOrEqual(
        snapshot.losers[i]!.quote.changePercent!,
      );
    }

    // A gainer must never also appear as a loser.
    for (const gainer of snapshot.gainers) expect(gainer.quote.changePercent!).toBeGreaterThan(0);
    for (const loser of snapshot.losers) expect(loser.quote.changePercent!).toBeLessThan(0);

    const gainerIds = new Set(snapshot.gainers.map((g) => g.instrument.id));
    for (const loser of snapshot.losers) expect(gainerIds.has(loser.instrument.id)).toBe(false);
  });

  it("ranks numbering from 1 without gaps", async () => {
    const { service } = createService();
    await service.getQuotes(EQUITY_IDS);

    const { gainers, mostActive } = service.buildSnapshot({ limit: 8 });
    gainers.forEach((entry, index) => expect(entry.rank).toBe(index + 1));
    mostActive.forEach((entry, index) => expect(entry.rank).toBe(index + 1));
  });

  it("counts breadth over every equity exactly once", async () => {
    const { service } = createService();
    await service.getQuotes(EQUITY_IDS);

    const snapshot = service.buildSnapshot();
    expect(snapshot.advancing + snapshot.declining + snapshot.unchanged).toBe(EQUITY_IDS.length);
  });

  it("excludes indices from equity rankings", async () => {
    const { service } = createService();
    // Subscribe to the whole universe, indices included.
    await service.getQuotes(INSTRUMENTS.map((i) => i.id));

    const snapshot = service.buildSnapshot({ limit: 20 });
    const indexIds = new Set(
      INSTRUMENTS.filter((i) => i.kind === "index").map((i) => i.id),
    );

    for (const entry of [...snapshot.gainers, ...snapshot.losers, ...snapshot.mostActive]) {
      expect(indexIds.has(entry.instrument.id)).toBe(false);
    }
    expect(snapshot.indices.length).toBe(indexIds.size);
  });

  it("orders most-active by descending volume", async () => {
    const { service } = createService();
    await service.getQuotes(EQUITY_IDS);

    const { mostActive } = service.buildSnapshot({ limit: 8 });
    for (let i = 1; i < mostActive.length; i += 1) {
      expect(mostActive[i - 1]!.quote.volume).toBeGreaterThanOrEqual(mostActive[i]!.quote.volume);
    }
  });

  it("marks every quote's provenance on the snapshot", async () => {
    const { service } = createService();
    await service.getQuotes(EQUITY_IDS);
    expect(service.buildSnapshot().source).toBe("simulated");
  });
});

describe("relativeVolume", () => {
  it("treats an unknown average as 0 rather than dividing by it", () => {
    const quote = { volume: 1_000, averageVolume: 0 } as never;
    expect(relativeVolume(quote)).toBe(0);
    expect(Number.isFinite(relativeVolume(quote))).toBe(true);
  });

  it("reports volume as a multiple of its own average", () => {
    expect(relativeVolume({ volume: 2_400, averageVolume: 1_000 } as never)).toBeCloseTo(2.4);
  });

  it("only ever flags spikes above the threshold", async () => {
    const { service } = createService();
    await service.getQuotes(EQUITY_IDS);

    for (const spike of service.buildSnapshot({ limit: 40 }).volumeSpikes) {
      expect(spike.relativeVolume).toBeGreaterThanOrEqual(1.5);
      expect(spike.quote.averageVolume).toBeGreaterThan(0);
    }
  });
});

/*
  Market hours, enforced where prices actually change.

  The reported bug was that the badge read CLOSED while quotes, percentages and
  volume carried on moving. These drive the simulator's own clock so the freeze
  is asserted on observable output — ticks and quotes — rather than on the
  predicate alone, which was already correct and was simply never consulted.
*/
describe("market hours", () => {
  const RELIANCE_ID = RELIANCE;

  /** Runs the tick loop `count` times with the clock fixed at `at`. */
  async function tickAt(at: Date, count: number) {
    vi.useFakeTimers();
    vi.setSystemTime(at);

    const provider = new MockMarketDataProvider({
      seed: "hours-seed",
      tickIntervalMs: 10,
      streaming: true,
    });

    const ticks: unknown[] = [];
    const stop = provider.subscribe([RELIANCE_ID], (tick) => ticks.push(tick));

    const before = await provider.getQuote(RELIANCE_ID);
    await vi.advanceTimersByTimeAsync(10 * count);
    const after = await provider.getQuote(RELIANCE_ID);

    stop();
    provider.dispose();
    vi.useRealTimers();

    return { ticks, before: before!, after: after! };
  }

  // 2026-08-17 is a Monday. 04:00Z = 09:30 IST, 12:00Z = 17:30 IST.
  const DURING_SESSION = new Date("2026-08-17T04:00:00.000Z");
  const AFTER_CLOSE = new Date("2026-08-17T12:00:00.000Z");
  const SATURDAY_MIDDAY = new Date("2026-08-22T06:30:00.000Z");

  it("moves prices during the session", async () => {
    const { ticks, before, after } = await tickAt(DURING_SESSION, 40);

    expect(ticks.length).toBeGreaterThan(0);
    expect(after.price).not.toBe(before.price);
  });

  it("emits no ticks once the session has closed", async () => {
    const { ticks } = await tickAt(AFTER_CLOSE, 40);
    expect(ticks).toHaveLength(0);
  });

  it("freezes price, change and volume after close", async () => {
    const { before, after } = await tickAt(AFTER_CLOSE, 100);

    expect(after.price).toBe(before.price);
    expect(after.changePercent).toBe(before.changePercent);
    expect(after.volume).toBe(before.volume);
  });

  it("freezes at the weekend", async () => {
    const { ticks, before, after } = await tickAt(SATURDAY_MIDDAY, 60);

    expect(ticks).toHaveLength(0);
    expect(after.price).toBe(before.price);
    expect(after.volume).toBe(before.volume);
  });

  it("resumes on its own when the session reopens, with no re-subscription", async () => {
    /*
      The timer keeps running while the market is shut; only the work inside it
      is skipped. So crossing 09:15 needs nothing to be restarted — which is
      what makes resumption automatic and keeps a single interval alive.
    */
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T03:44:00.000Z")); // 09:14 IST

    const provider = new MockMarketDataProvider({
      seed: "resume-seed",
      tickIntervalMs: 10,
      streaming: true,
    });

    const ticks: unknown[] = [];
    const stop = provider.subscribe([RELIANCE_ID], (tick) => ticks.push(tick));

    await vi.advanceTimersByTimeAsync(200);
    expect(ticks).toHaveLength(0); // still 09:14 — closed

    vi.setSystemTime(new Date("2026-08-17T03:45:00.000Z")); // 09:15 IST
    await vi.advanceTimersByTimeAsync(200);

    stop();
    provider.dispose();
    vi.useRealTimers();

    expect(ticks.length).toBeGreaterThan(0);
  });

  it("stops extending the candle series after close", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(AFTER_CLOSE);

    const provider = new MockMarketDataProvider({ seed: "candle-seed", streaming: false });
    const window = { instrumentId: RELIANCE_ID, interval: "5m" as const };

    const at17_30 = await provider.getCandles({
      ...window,
      from: AFTER_CLOSE.getTime() - 6 * 3_600_000,
      to: AFTER_CLOSE.getTime(),
    });

    // Two hours later the request reaches further, but the market has not
    // traded in between, so the newest bar must be the same one.
    const later = new Date("2026-08-17T14:00:00.000Z");
    vi.setSystemTime(later);
    const at19_30 = await provider.getCandles({
      ...window,
      from: later.getTime() - 6 * 3_600_000,
      to: later.getTime(),
    });

    vi.useRealTimers();

    expect(at17_30.length).toBeGreaterThan(0);
    expect(at19_30.at(-1)!.time).toBe(at17_30.at(-1)!.time);
    expect(at19_30.at(-1)!.close).toBe(at17_30.at(-1)!.close);
  });

  it("still returns a full window on a Sunday rather than an empty chart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T09:00:00.000Z")); // Sunday

    const provider = new MockMarketDataProvider({ seed: "sunday-seed", streaming: false });
    const now = Date.now();
    const candles = await provider.getCandles({
      instrumentId: RELIANCE_ID,
      interval: "5m",
      from: now - 6 * 3_600_000,
      to: now,
    });

    vi.useRealTimers();

    // Clamping only the window's end would have collapsed the span to nothing.
    expect(candles.length).toBeGreaterThan(10);
    expect(candles.at(-1)!.time).toBeLessThanOrEqual(now);
  });
});

/*
  Registry integrity.

  A duplicate symbol does not fail loudly: `INSTRUMENT_BY_ID` and the
  simulator's state map are both keyed by id, so a repeated row silently
  collapses into one and every count that walks the array disagrees with every
  count that walks the map. That is exactly what happened when the universe was
  expanded — a second JSWSTEEL row made breadth come up one short — so it is
  worth an assertion rather than a comment.
*/
describe("instrument registry", () => {
  it("has no duplicate instrument ids", () => {
    const ids = INSTRUMENTS.map((instrument) => instrument.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate symbols within an exchange", () => {
    const keys = INSTRUMENTS.map((instrument) => `${instrument.exchange}:${instrument.symbol}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every equity a sector and a simulator seed", () => {
    for (const instrument of INSTRUMENTS.filter((i) => i.kind === "equity")) {
      expect(instrument.sector, instrument.symbol).not.toBeNull();
      expect(SEED_BY_ID.get(instrument.id), instrument.symbol).toBeDefined();
    }
  });

  it("carries more instruments than the original forty", () => {
    // Guards against a future edit quietly trimming the universe back.
    expect(INSTRUMENTS.filter((i) => i.kind === "equity").length).toBeGreaterThan(40);
  });

  it("includes Sudarshan Chemical Industries, findable by symbol and by name", () => {
    const sudarshan = INSTRUMENTS.find((i) => i.symbol === "SUDARSCHEM");

    expect(sudarshan).toBeDefined();
    expect(sudarshan!.id).toBe("NSE:SUDARSCHEM");
    expect(sudarshan!.name).toBe("Sudarshan Chemical Industries");
    expect(sudarshan!.sector).toBe("Chemicals");
    expect(SEED_BY_ID.get("NSE:SUDARSCHEM")).toBeDefined();
  });
});
