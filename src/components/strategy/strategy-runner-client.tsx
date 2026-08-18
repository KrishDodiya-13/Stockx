"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { handleSessionExpiry } from "@/lib/session-expiry";

export interface CycleResult {
  evaluated: number;
  executed: number;
  rejected: number;
  completed: number;
  errors: number;
}

export interface ExecutionRecord {
  id: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  ruleId: string | null;
  outcome: "EXECUTED" | "REJECTED" | "SKIPPED" | "INFO";
  side: "BUY" | "SELL" | null;
  quantity: number | null;
  price: number | null;
  orderId: string | null;
  detail: string;
  createdAt: number;
}

interface RunnerState {
  readonly running: boolean;
  readonly lastRunAt: number | null;
  readonly lastResult: CycleResult | null;
  readonly executions: readonly ExecutionRecord[];
  readonly available: boolean;
}

const TICK_MS = 4000;

/**
 * Drives strategy evaluation from the browser.
 *
 * This is an honest compromise, not a pretence at a background service. There
 * is no worker process in this deployment, so cycles happen while the app is
 * open and stop when it is closed — which the UI states outright rather than
 * implying round-the-clock coverage.
 *
 * Two safeguards make client-driven execution safe:
 *
 *   - The server claims each rule atomically, so several open tabs cannot
 *     double-execute the same rule.
 *   - A cycle is never started while the previous one is still in flight, so a
 *     slow pass cannot pile up requests.
 */
export function useStrategyRunner(enabled: boolean): RunnerState & {
  runNow: () => Promise<void>;
} {
  const [state, setState] = useState<RunnerState>({
    running: false,
    lastRunAt: null,
    lastResult: null,
    executions: [],
    available: true,
  });

  // Guards against overlapping cycles without causing a re-render.
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadExecutions = useCallback(async () => {
    try {
      const response = await fetch("/api/strategies/run", { cache: "no-store" });

      if (handleSessionExpiry(response)) return;
      if (!response.ok) return;
      const payload = (await response.json()) as { executions?: ExecutionRecord[] };
      if (mountedRef.current) {
        setState((current) => ({ ...current, executions: payload.executions ?? [] }));
      }
    } catch {
      // A failed log fetch is not worth surfacing; the next tick retries.
    }
  }, []);

  const runNow = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (mountedRef.current) setState((current) => ({ ...current, running: true }));

    try {
      const response = await fetch("/api/strategies/run", { method: "POST" });

      if (handleSessionExpiry(response)) return;

      if (response.status === 503) {
        if (mountedRef.current) {
          setState((current) => ({ ...current, available: false, running: false }));
        }
        return;
      }

      const payload = (await response.json()) as { result?: CycleResult };

      if (mountedRef.current) {
        setState((current) => ({
          ...current,
          running: false,
          lastRunAt: Date.now(),
          lastResult: payload.result ?? null,
          available: true,
        }));
      }

      // Only refresh the log when something actually happened.
      if (payload.result && payload.result.executed + payload.result.rejected + payload.result.completed > 0) {
        await loadExecutions();
      }
    } catch {
      if (mountedRef.current) setState((current) => ({ ...current, running: false }));
    } finally {
      inFlightRef.current = false;
    }
  }, [loadExecutions]);

  useEffect(() => {
    if (!enabled) return;

    void loadExecutions();
    void runNow();

    const timer = setInterval(() => void runNow(), TICK_MS);
    return () => clearInterval(timer);
  }, [enabled, runNow, loadExecutions]);

  return { ...state, runNow };
}
