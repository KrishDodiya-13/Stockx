"use client";

import { useCallback, useEffect, useState } from "react";

import type { PortfolioSummary } from "@/domain/trading";
import { handleSessionExpiry } from "@/lib/session-expiry";

export type ApiState = "loading" | "ready" | "error" | "unconfigured";

interface PortfolioResult {
  readonly portfolio: PortfolioSummary | null;
  readonly state: ApiState;
  readonly message: string | null;
  refresh(): void;
}

/**
 * The account's financial state, fetched from the server.
 *
 * Nothing here is computed client-side — the server owns valuation, so a page
 * cannot disagree with the database. `unconfigured` is a distinct state from
 * `error` so a missing database renders setup instructions rather than a
 * failure message.
 */
export function usePortfolio(pollMs = 5000): PortfolioResult {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [state, setState] = useState<ApiState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const response = await fetch("/api/portfolio", { cache: "no-store" });

        if (handleSessionExpiry(response)) return;
        const payload = (await response.json()) as {
          portfolio?: PortfolioSummary;
          error?: string;
          message?: string;
        };

        if (cancelled) return;

        if (response.status === 503 && payload.error === "database_not_configured") {
          setState("unconfigured");
          setMessage(payload.message ?? null);
          return;
        }

        if (!response.ok || !payload.portfolio) {
          setState("error");
          setMessage(payload.message ?? "Could not load the portfolio.");
          return;
        }

        setPortfolio(payload.portfolio);
        setMessage(null);
        setState("ready");
      } catch (error) {
        if (cancelled) return;
        setState("error");
        setMessage(error instanceof Error ? error.message : "Could not load the portfolio.");
      }
    };

    void load();

    // Re-valuing on an interval keeps unrealised P&L moving with the market.
    const timer = pollMs > 0 ? setInterval(() => void load(), pollMs) : null;

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [nonce, pollMs]);

  return { portfolio, state, message, refresh };
}

/** Shape returned by /api/orders and /api/trades. */
export interface OrderRecord {
  id: string;
  instrumentId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  status: string;
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  averageFillPrice: number | null;
  statusReason: string | null;
  placedAt: number;
  filledAt: number | null;
}

export interface TradeRecord {
  id: string;
  orderId: string;
  instrumentId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  value: number;
  realisedPnl: number;
  source: string;
  executedAt: number;
}

/** Generic loader for the two history endpoints. */
export function useHistory<T>(
  endpoint: "/api/orders" | "/api/trades",
  key: "orders" | "trades",
  refreshToken = 0,
): { records: readonly T[]; state: ApiState; message: string | null } {
  const [records, setRecords] = useState<readonly T[]>([]);
  const [state, setState] = useState<ApiState>("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });

        if (handleSessionExpiry(response)) return;
        const payload = (await response.json()) as Record<string, unknown>;
        if (cancelled) return;

        if (response.status === 503 && payload.error === "database_not_configured") {
          setState("unconfigured");
          setMessage(typeof payload.message === "string" ? payload.message : null);
          return;
        }

        if (!response.ok) {
          setState("error");
          setMessage(typeof payload.message === "string" ? payload.message : "Request failed.");
          return;
        }

        setRecords((payload[key] as T[]) ?? []);
        setState("ready");
      } catch (error) {
        if (cancelled) return;
        setState("error");
        setMessage(error instanceof Error ? error.message : "Request failed.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [endpoint, key, refreshToken]);

  return { records, state, message };
}
