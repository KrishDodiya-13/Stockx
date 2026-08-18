import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionStatus } from "@/domain/connection";
import { IDLE_CONNECTION } from "@/domain/connection";
import type { Candle, Instrument, MarketStatus, Quote, SectorPerformance, Tick } from "@/domain/market";
import type { PriceE4 } from "@/lib/money";
import { MarketDataService } from "@/services/market-data/market-data-service";
import type { MarketDataProvider, Unsubscribe } from "@/services/market-data/types";
import { INSTRUMENTS } from "@/services/market-data/universe";

/**
 * Batching must not cost correctness.
 *
 * Coalescing tick notifications is a performance change, and a performance
 * change that drops or reorders prices is a bug. These pin the three things
 * that have to stay true: every subscriber still hears about a move, the cache
 * is never behind, and what lands is the newest price rather than a stale one
 * from the middle of a burst.
 */

/** Drain the batching timer. Off-screen the service flushes on a 100ms timer. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(150);
}

/**
 * A provider whose ticks this test controls.
 *
 * Written here rather than adding a test-only emitter to the simulator: the
 * point is to drive `MarketDataService` on an exact schedule, and production
 * code should not grow a hook that exists only for tests.
 */
class ControllableProvider implements MarketDataProvider {
  readonly name = "controllable";
  readonly source = "simulated" as const;

  private readonly subscribers = new Map<string, Set<(tick: Tick) => void>>();
  /** The id list of every `getQuotes` call, in order. */
  readonly quoteCalls: string[][] = [];

  push(tick: Tick): void {
    for (const listener of this.subscribers.get(tick.instrumentId) ?? []) listener(tick);
  }

  async listInstruments(): Promise<readonly Instrument[]> {
    return INSTRUMENTS;
  }
  async searchInstruments(): Promise<readonly Instrument[]> {
    return [];
  }
  async getQuote(instrumentId: string): Promise<Quote | null> {
    return (await this.getQuotes([instrumentId]))[0] ?? null;
  }
  async getQuotes(instrumentIds: readonly string[]): Promise<readonly Quote[]> {
    this.quoteCalls.push([...instrumentIds]);
    return instrumentIds.map((id) => seedQuote(id));
  }
  async getCandles(): Promise<readonly Candle[]> {
    return [];
  }
  async getSectorPerformance(): Promise<readonly SectorPerformance[]> {
    return [];
  }
  async getMarketStatus(): Promise<MarketStatus> {
    return { phase: "open", timestamp: Date.now(), source: this.source };
  }
  subscribe(instrumentIds: readonly string[], onTick: (tick: Tick) => void): Unsubscribe {
    for (const id of instrumentIds) {
      let set = this.subscribers.get(id);
      if (!set) {
        set = new Set();
        this.subscribers.set(id, set);
      }
      set.add(onTick);
    }
    return () => {
      for (const id of instrumentIds) this.subscribers.get(id)?.delete(onTick);
    };
  }
  getConnectionStatus(): ConnectionStatus {
    return IDLE_CONNECTION;
  }
  onConnectionChange(): Unsubscribe {
    return () => {};
  }
  dispose(): void {}
}

function seedQuote(instrumentId: string): Quote {
  const base = 1_000_0000 as PriceE4;
  return {
    instrumentId,
    price: base,
    previousClose: base,
    open: base,
    dayHigh: base,
    dayLow: base,
    volume: 1_000,
    averageVolume: 1_000,
    change: 0 as PriceE4,
    changePercent: 0,
    timestamp: Date.now(),
    source: "simulated",
  };
}

function makeService(): { service: MarketDataService; provider: ControllableProvider } {
  const provider = new ControllableProvider();
  return { service: new MarketDataService(provider), provider };
}

const RELIANCE = "NSE:RELIANCE";

describe("tick batching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("still delivers a tick to its subscriber", async () => {
    const { service, provider } = makeService();
    const seen: Quote[] = [];

    service.subscribeQuote(RELIANCE, (quote) => seen.push(quote));
    // Let the batched seed fetch resolve and prime the cache.
    await vi.advanceTimersByTimeAsync(50);

    const before = seen.length;
    provider.push(tick(RELIANCE, 1_500_0000));
    await flush();

    expect(seen.length).toBeGreaterThan(before);
    expect(seen[seen.length - 1]?.price).toBe(1_500_0000);
  });

  it("collapses a burst into one notification carrying the last price", async () => {
    // The point of the batch: ten prints inside one frame are one re-render,
    // and the price that lands is the one that was actually current.
    const { service, provider } = makeService();
    const seen: Quote[] = [];

    service.subscribeQuote(RELIANCE, (quote) => seen.push(quote));
    await vi.advanceTimersByTimeAsync(50);
    seen.length = 0;

    for (let i = 1; i <= 10; i += 1) {
      provider.push(tick(RELIANCE, (1_400_0000 + i * 1000) as PriceE4));
    }
    await flush();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.price).toBe(1_400_0000 + 10 * 1000);
  });

  it("updates the cache synchronously, before any flush", async () => {
    /*
      The deferral is only of the notification. Anything reading the cache —
      snapshots, a newly mounted component, an order being priced — must see
      the newest tick immediately, or batching would introduce staleness.
    */
    const { service, provider } = makeService();
    service.subscribeQuote(RELIANCE, () => {});
    await vi.advanceTimersByTimeAsync(50);

    provider.push(tick(RELIANCE, 1_777_0000));
    expect(service.peekQuote(RELIANCE)?.price).toBe(1_777_0000);
  });

  it("notifies every subscriber watching the same instrument", async () => {
    const { service, provider } = makeService();
    const a: Quote[] = [];
    const b: Quote[] = [];

    service.subscribeQuote(RELIANCE, (q) => a.push(q));
    service.subscribeQuote(RELIANCE, (q) => b.push(q));
    await vi.advanceTimersByTimeAsync(50);
    a.length = 0;
    b.length = 0;

    provider.push(tick(RELIANCE, 1_610_0000));
    await flush();

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.price).toBe(1_610_0000);
  });

  it("stops notifying after unsubscribe", async () => {
    const { service, provider } = makeService();
    const seen: Quote[] = [];

    const unsubscribe = service.subscribeQuote(RELIANCE, (q) => seen.push(q));
    await vi.advanceTimersByTimeAsync(50);
    unsubscribe();
    seen.length = 0;

    provider.push(tick(RELIANCE, 1_650_0000));
    await flush();

    expect(seen).toHaveLength(0);
  });

  it("keeps instruments separate within one flush", async () => {
    const { service, provider } = makeService();
    const seen: Quote[] = [];

    service.subscribeQuote(RELIANCE, (q) => seen.push(q));
    service.subscribeQuote("NSE:TCS", (q) => seen.push(q));
    await vi.advanceTimersByTimeAsync(50);
    seen.length = 0;

    provider.push(tick(RELIANCE, 1_500_0000));
    provider.push(tick("NSE:TCS", 3_200_0000));
    await flush();

    const byId = new Map(seen.map((q) => [q.instrumentId, q.price]));
    expect(byId.get(RELIANCE)).toBe(1_500_0000);
    expect(byId.get("NSE:TCS")).toBe(3_200_0000);
  });

  it("seeds a whole table with one request, not one per row", async () => {
    /*
      The regression this exists to catch.

      A ninety-row table mounts ninety `subscribeQuote` calls in one
      synchronous pass. Seeding per instrument turned that into ninety HTTP
      requests and, in live mode, ninety Upstox round trips — measured at 91
      requests for `/stocks` before this was batched.
    */
    const { service, provider } = makeService();
    const ids = INSTRUMENTS.slice(0, 90).map((instrument) => instrument.id);

    for (const id of ids) service.subscribeQuote(id, () => {});
    await vi.advanceTimersByTimeAsync(50);

    expect(provider.quoteCalls).toHaveLength(1);
    expect(provider.quoteCalls[0]).toHaveLength(ids.length);
  });

  it("does not re-request an instrument already in the cache", async () => {
    const { service, provider } = makeService();

    service.subscribeQuote(RELIANCE, () => {});
    await vi.advanceTimersByTimeAsync(50);
    const after = provider.quoteCalls.length;

    // A second widget watching the same symbol is served from the cache.
    service.subscribeQuote(RELIANCE, () => {});
    await vi.advanceTimersByTimeAsync(50);

    expect(provider.quoteCalls).toHaveLength(after);
  });

  it("survives a subscriber that throws", async () => {
    const { service, provider } = makeService();
    const survivor: Quote[] = [];

    service.subscribeQuote(RELIANCE, () => {
      throw new Error("bad subscriber");
    });
    service.subscribeQuote(RELIANCE, (q) => survivor.push(q));
    await vi.advanceTimersByTimeAsync(50);
    survivor.length = 0;

    provider.push(tick(RELIANCE, 1_520_0000));
    await flush();

    expect(survivor).toHaveLength(1);
  });
});

function tick(instrumentId: string, price: number): Tick {
  return {
    instrumentId,
    price: price as PriceE4,
    volume: 1_000,
    timestamp: Date.now(),
    source: "simulated",
  };
}
