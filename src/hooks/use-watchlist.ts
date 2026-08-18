"use client";

import { useCallback, useEffect, useState } from "react";

import { INSTRUMENT_BY_ID } from "@/services/market-data";
import {
  watchlistStore,
  type WatchlistEntry,
  type WatchlistState,
} from "@/services/watchlist/watchlist-store";

/**
 * The signed-in user's watchlist, shared by every component that shows a star.
 *
 * Starts empty rather than reading during render, so the server and the first
 * client paint agree; the real list arrives on mount.
 *
 * `toggle` is async because it writes to the database, but callers that only
 * want to know which way it went can read the returned promise — it resolves to
 * whether the instrument is watched afterwards.
 */
export function useWatchlist(): {
  items: readonly WatchlistEntry[];
  ids: readonly string[];
  loaded: boolean;
  error: string | null;
  has: (instrumentId: string) => boolean;
  toggle: (instrumentId: string) => Promise<boolean>;
  add: (instrumentId: string) => Promise<boolean>;
  remove: (instrumentId: string) => Promise<boolean>;
  reload: () => Promise<void>;
} {
  const [state, setState] = useState<WatchlistState>(() => watchlistStore.getState());

  useEffect(() => watchlistStore.subscribe(setState), []);

  return {
    items: state.items,
    ids: state.ids,
    loaded: state.loaded,
    error: state.error,
    has: useCallback((instrumentId: string) => state.ids.includes(instrumentId), [state.ids]),
    toggle: useCallback((instrumentId: string) => watchlistStore.toggle(entryFor(instrumentId)), []),
    add: useCallback((instrumentId: string) => watchlistStore.add(entryFor(instrumentId)), []),
    remove: useCallback((instrumentId: string) => watchlistStore.remove(instrumentId), []),
    reload: useCallback(() => watchlistStore.load(true), []),
  };
}

/**
 * Build the optimistic row for an instrument.
 *
 * Symbol and name come from the shared registry, so the row that appears
 * instantly on click carries the same text the server will send back a moment
 * later and nothing visibly changes when the real list arrives.
 */
function entryFor(instrumentId: string): WatchlistEntry {
  const instrument = INSTRUMENT_BY_ID.get(instrumentId);
  return {
    instrumentId,
    symbol: instrument?.symbol ?? instrumentId,
    name: instrument?.name ?? instrumentId,
    addedAt: Date.now(),
  };
}
