"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Quote } from "@/domain/market";
import { getMarketDataService } from "@/services/market-data";

export type LoadState = "idle" | "loading" | "ready" | "error";

export interface QuoteResult {
  readonly quote: Quote | null;
  readonly state: LoadState;
  readonly error: Error | null;
}

/** Live quote for one instrument. */
export function useQuote(instrumentId: string | null): QuoteResult {
  const service = useMemo(() => getMarketDataService(), []);
  const [quote, setQuote] = useState<Quote | null>(() =>
    instrumentId ? service.peekQuote(instrumentId) : null,
  );
  const [state, setState] = useState<LoadState>(instrumentId ? "loading" : "idle");
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!instrumentId) {
      setQuote(null);
      setState("idle");
      return;
    }

    let cancelled = false;
    setState("loading");
    setError(null);

    const unsubscribe = service.subscribeQuote(instrumentId, (next) => {
      if (cancelled) return;
      setQuote(next);
      setState("ready");
    });

    void service
      .getQuote(instrumentId)
      .then((initial) => {
        if (cancelled) return;
        if (initial) {
          setQuote(initial);
          setState("ready");
        } else {
          setError(new Error(`Unknown instrument: ${instrumentId}`));
          setState("error");
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause : new Error("Failed to load quote"));
        setState("error");
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [instrumentId, service]);

  return { quote, state, error };
}

export interface QuotesResult {
  readonly quotes: ReadonlyMap<string, Quote>;
  readonly state: LoadState;
  readonly error: Error | null;
}

/** Live quotes for many instruments, keyed by instrument id. */
export function useQuotes(instrumentIds: readonly string[]): QuotesResult {
  const service = useMemo(() => getMarketDataService(), []);
  const [quotes, setQuotes] = useState<ReadonlyMap<string, Quote>>(() => new Map());
  const [state, setState] = useState<LoadState>(instrumentIds.length > 0 ? "loading" : "idle");
  const [error, setError] = useState<Error | null>(null);

  // Subscribe on membership change, not on array identity — callers routinely
  // pass a fresh array literal on every render.
  const key = instrumentIds.join("|");
  const idsRef = useRef(instrumentIds);
  idsRef.current = instrumentIds;

  useEffect(() => {
    const ids = idsRef.current;
    if (ids.length === 0) {
      setQuotes(new Map());
      setState("idle");
      return;
    }

    let cancelled = false;
    setState("loading");
    setError(null);

    const apply = (quote: Quote): void => {
      if (cancelled) return;
      setQuotes((previous) => {
        const next = new Map(previous);
        next.set(quote.instrumentId, quote);
        return next;
      });
    };

    const unsubscribe = service.subscribeQuotes(ids, apply);

    void service
      .getQuotes(ids)
      .then((initial) => {
        if (cancelled) return;
        setQuotes(new Map(initial.map((quote) => [quote.instrumentId, quote])));
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause : new Error("Failed to load quotes"));
        setState("error");
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key, service]);

  return { quotes, state, error };
}
