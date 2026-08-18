"use client";

import { useEffect, useMemo, useState } from "react";

import type { ConnectionStatus } from "@/domain/connection";
import { IDLE_CONNECTION } from "@/domain/connection";
import type { MarketSnapshot, SectorPerformance } from "@/domain/market";
import { getMarketDataService } from "@/services/market-data";

/**
 * A whole-market read, recomputed on an interval.
 *
 * Snapshots are polled rather than rebuilt on every tick: with ~40 instruments
 * updating roughly every second, re-ranking and re-rendering the entire page on
 * each individual tick would burn the main thread for no visible gain. The
 * interval sets the refresh rate of the *rankings*; individual prices still
 * stream at full speed through `useQuotes`.
 */
export function useMarketSnapshot(
  instrumentIds: readonly string[],
  options: { refreshMs?: number; limit?: number } = {},
): { snapshot: MarketSnapshot | null; ready: boolean } {
  const { refreshMs = 2000, limit = 8 } = options;
  const service = useMemo(() => getMarketDataService(), []);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);

  const key = instrumentIds.join("|");

  useEffect(() => {
    if (instrumentIds.length === 0) return;

    let cancelled = false;

    // Subscribing here is what fills the cache the snapshot is derived from.
    const unsubscribe = service.subscribeQuotes(instrumentIds, () => {});

    const refresh = (): void => {
      if (cancelled) return;
      setSnapshot(service.buildSnapshot({ limit }));
    };

    void service.getQuotes(instrumentIds).then(refresh);
    const timer = setInterval(refresh, refreshMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe();
    };
    // `key` stands in for membership; the array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, service, refreshMs, limit]);

  return { snapshot, ready: snapshot !== null };
}

/** Sector performance, polled from the provider. */
export function useSectorPerformance(refreshMs = 4000): readonly SectorPerformance[] | null {
  const service = useMemo(() => getMarketDataService(), []);
  const [sectors, setSectors] = useState<readonly SectorPerformance[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = (): void => {
      void service.getSectorPerformance().then((next) => {
        if (!cancelled) setSectors(next);
      });
    };

    refresh();
    const timer = setInterval(refresh, refreshMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [service, refreshMs]);

  return sectors;
}

/** Live feed health, for the connection indicator. */
export function useConnectionStatus(): ConnectionStatus {
  const service = useMemo(() => getMarketDataService(), []);
  const [status, setStatus] = useState<ConnectionStatus>(IDLE_CONNECTION);

  useEffect(() => service.onConnectionChange(setStatus), [service]);

  return status;
}
