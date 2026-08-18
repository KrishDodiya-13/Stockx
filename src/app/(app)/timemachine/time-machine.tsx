"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_INDICATORS } from "@/components/chart/indicator-config";
import { PriceChart } from "@/components/chart/price-chart";
import { SessionReportPanel } from "@/components/timemachine/session-report";
import { TransportControls } from "@/components/timemachine/transport-controls";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Select, type SelectOption } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import type { Candle } from "@/domain/market";
import { cn } from "@/lib/cn";
import { EQUITY_OPTIONS, INSTRUMENT_SEARCH_PLACEHOLDER } from "@/lib/instrument-options";
import { formatCurrency, formatTime } from "@/lib/format";
import { shouldIgnoreTarget } from "@/lib/shortcuts";
import { priceToRupees, rupeesToPaise, type PriceE4 } from "@/lib/money";
import { INSTRUMENTS } from "@/services/market-data";
import {
  buildReport,
  createSession,
  currentCandle,
  currentPrice,
  placeSessionOrder,
  revealNext,
  sessionEquity,
  tickInterval,
  type PlaybackSpeed,
  type SessionState,
} from "@/services/timemachine/session-engine";

/*
  Equities only.

  This screen carries BUY and SELL buttons, so its instrument picker is a
  trading picker whatever else it also does. It previously offered the whole
  registry on the grounds that a session can replay an index — but an index
  cannot be bought at any point in history either, so those buttons had nothing
  to act on.
*/
const SYMBOL_OPTIONS = EQUITY_OPTIONS;

const INTERVAL_OPTIONS: readonly SelectOption[] = [
  { value: "1m", label: "1 minute", hint: "Intraday detail" },
  { value: "5m", label: "5 minutes", hint: "A full session at pace" },
  { value: "15m", label: "15 minutes", hint: "Several days" },
  { value: "1h", label: "1 hour", hint: "Weeks" },
];

/** Bars a session runs for. Enough to be a session, short enough to finish. */
const SESSION_BARS = 120;

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function TimeMachine() {
  const { toast } = useToast();

  // --- setup ---------------------------------------------------------------
  const [instrumentId, setInstrumentId] = useState(SYMBOL_OPTIONS[0]?.value ?? "");
  const [date, setDate] = useState(isoDate(Date.now() - 30 * 86_400_000));
  const [time, setTime] = useState("09:30");
  const [interval, setInterval] = useState("5m");
  const [capital, setCapital] = useState("100000");

  // --- session -------------------------------------------------------------
  const [session, setSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("100");

  /**
   * Bars fetched so far, kept in a ref rather than state.
   *
   * This is the session's *supply* of revealed bars — the engine pulls the next
   * one from here as the clock advances. It never contains a bar beyond the
   * cursor, because the server only ever sends up to it.
   */
  const supplyRef = useRef<Candle[]>([]);
  const fetchingRef = useRef(false);

  /**
   * Latest session state, for `step` to read without depending on it.
   *
   * Keeping the session out of `step`'s dependencies is what stops the playback
   * timer being torn down and rebuilt on every state change — including every
   * trade, which would otherwise reset the bar the user is waiting on.
   */
  const sessionRef = useRef<SessionState | null>(null);

  const symbol =
    INSTRUMENTS.find((instrument) => instrument.id === instrumentId)?.symbol ?? "";

  const sessionStart = useMemo(
    () => new Date(`${date}T${time}:00`).getTime(),
    [date, time],
  );

  /**
   * Ask the server for bars up to the given cursor — never beyond it.
   *
   * `availableBars` comes back too: how long this session can actually run.
   * Without it the session would keep asking for a bar that does not exist.
   */
  const fetchUpTo = useCallback(
    async (cursor: number): Promise<{ candles: Candle[]; availableBars: number }> => {
      const params = new URLSearchParams({
        instrumentId,
        start: String(sessionStart),
        interval,
        cursor: String(cursor),
        limit: String(SESSION_BARS),
      });

      const response = await fetch(`/api/timemachine/candles?${params}`, { cache: "no-store" });
      const payload = (await response.json()) as {
        candles?: Candle[];
        availableBars?: number;
        message?: string;
      };

      if (!response.ok) throw new Error(payload.message ?? "Could not load historical data.");
      return { candles: payload.candles ?? [], availableBars: payload.availableBars ?? 0 };
    },
    [instrumentId, sessionStart, interval],
  );

  async function start(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      if (sessionStart > Date.now()) {
        setError("Pick a date and time in the past.");
        return;
      }

      // Prime with the first bar only — the session must not begin holding
      // data it has not reached.
      const { candles: first, availableBars } = await fetchUpTo(1);

      if (first.length === 0 || availableBars === 0) {
        setError("No historical data is available for that moment.");
        return;
      }

      /*
        The session runs for as long as there is history, not for a fixed
        count. Picking a moment only an hour ago leaves far fewer bars than the
        nominal length, and a session that kept asking for bar 120 of 24 would
        hang with a frozen progress bar and a request every tick.
      */
      const length = Math.min(SESSION_BARS, availableBars);

      supplyRef.current = first;
      const fresh = createSession(rupeesToPaise(Number(capital) || 100_000), length);
      setSession(revealNext(fresh, first[0]!));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the session.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Advance one bar, topping up the supply when it runs out.
   *
   * The fetch is kept outside the state updater. An updater must be pure —
   * React may invoke it more than once for a single update, which would fire
   * duplicate requests.
   */
  const step = useCallback(async (): Promise<void> => {
    const current = sessionRef.current;
    if (!current || current.status === "finished") return;

    const next = supplyRef.current[current.cursor];

    if (next) {
      setSession((state) => (state ? revealNext(state, next) : state));
      return;
    }

    // Supply exhausted — fetch more, then let the following tick consume it.
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const { candles } = await fetchUpTo(Math.min(current.cursor + 30, current.total));

      /*
        If the top-up brings nothing new, the history is spent. End the session
        rather than retrying forever — a stalled clock with a frozen progress
        bar is the worst possible outcome here.
      */
      if (candles.length <= current.cursor) {
        setSession((state) => (state ? { ...state, status: "finished" } : state));
        return;
      }

      supplyRef.current = candles;
    } catch {
      // Transient failure; the next tick retries.
    } finally {
      fetchingRef.current = false;
    }
  }, [fetchUpTo]);

  // Mirror the session into a ref so `step` and the clock can read it without
  // re-subscribing on every change.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // --- the clock -----------------------------------------------------------
  // Depends on status and speed only. Depending on the whole session object
  // would rebuild the interval on every revealed bar and every trade.
  const running = session?.status === "running";
  const speed = session?.speed ?? 1;

  useEffect(() => {
    if (!running) return;

    const timer = window.setInterval(() => void step(), tickInterval(speed));
    return () => window.clearInterval(timer);
  }, [running, speed, step]);

  /**
   * Set the playback speed.
   *
   * The single writer for speed, shared by the transport buttons and the
   * keyboard shortcuts. It changes *only* `speed`: the cursor, revealed bars,
   * cash and trades are all carried through untouched, so switching from 1× to
   * 5× continues from the current bar rather than restarting. It also does not
   * touch `status`, which is what makes changing speed while paused leave the
   * session paused.
   */
  const changeSpeed = useCallback((next: PlaybackSpeed): void => {
    setSession((current) =>
      current && current.speed !== next ? { ...current, speed: next } : current,
    );
  }, []);

  /*
    Keyboard shortcuts: 1, 2, 3, 5 select their multiplier and 0 selects 10×,
    since there is no single digit for ten.

    Guarded by `shouldIgnoreTarget` — the same helper the command palette uses —
    so typing a quantity into the trade ticket never changes playback speed
    underneath the user.
  */
  useEffect(() => {
    if (!session) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (shouldIgnoreTarget(event.target, event)) return;

      const speedForKey: Record<string, PlaybackSpeed> = {
        "1": 1,
        "2": 2,
        "3": 3,
        "5": 5,
        "0": 10,
      };

      const next = speedForKey[event.key];
      if (!next) return;

      event.preventDefault();
      changeSpeed(next);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session, changeSpeed]);

  const setStatus = (status: SessionState["status"]): void =>
    setSession((current) => (current ? { ...current, status } : current));

  function reset(): void {
    supplyRef.current = [];
    setSession(null);
    setError(null);
  }

  function trade(side: "BUY" | "SELL"): void {
    if (!session) return;

    const outcome = placeSessionOrder(session, side, Number(quantity) || 0);

    if (!outcome.ok) {
      toast({ title: "Order rejected", description: outcome.message ?? undefined, tone: "error" });
      return;
    }

    setSession(outcome.state);
    toast({
      title: `${side === "BUY" ? "Bought" : "Sold"} ${quantity} ${symbol}`,
      tone: "success",
      duration: 2200,
    });
  }

  // --- setup screen --------------------------------------------------------
  if (!session) {
    return (
      <div className="mt-10 max-w-2xl">
        <Panel>
          <PanelHeader
            title="Choose your moment"
            description="The session begins here and moves forward. You will not see what happens next."
          />

          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 md:px-6">
            <Select
              label="Instrument"
              options={SYMBOL_OPTIONS}
              value={instrumentId}
              onValueChange={setInstrumentId}
              searchable
              searchPlaceholder={INSTRUMENT_SEARCH_PLACEHOLDER}
              emptyMessage="No instruments found"
            />
            <Select
              label="Bar size"
              options={INTERVAL_OPTIONS}
              value={interval}
              onValueChange={setInterval}
            />
            <Input label="Date" type="date" value={date} max={isoDate(Date.now())} onChange={(e) => setDate(e.target.value)} />
            <Input label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            <div className="sm:col-span-2">
              <Input
                label="Starting capital"
                numeric
                inputMode="decimal"
                leading="₹"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
              />
            </div>
          </div>

          {error ? (
            <p className="px-5 pb-4 text-[0.8125rem] text-down md:px-6" role="alert">
              {error}
            </p>
          ) : null}

          <div className="border-t border-line-subtle px-5 py-4 md:px-6">
            <button
              type="button"
              onClick={() => void start()}
              disabled={loading}
              className="inline-flex h-12 items-center rounded-full bg-ink px-7 text-sm font-medium text-ink-inverse transition-all duration-300 hover:-translate-y-px disabled:pointer-events-none disabled:opacity-40"
            >
              {loading ? "Entering…" : "Enter the market"}
            </button>
          </div>
        </Panel>

        <p className="mt-6 text-xs leading-relaxed text-ink-tertiary">
          The server sends only the bars the session has reached, so future prices never arrive in
          your browser. Trades use a sandbox balance and do not touch your paper trading account.
        </p>
      </div>
    );
  }

  // --- finished ------------------------------------------------------------
  if (session.status === "finished") {
    return (
      <div className="mt-10">
        <SessionReportPanel report={buildReport(session)} symbol={symbol} onReset={reset} />
      </div>
    );
  }

  // --- running -------------------------------------------------------------
  const price = currentPrice(session);
  const candle = currentCandle(session);
  const equity = sessionEquity(session);
  const held = session.holding?.quantity ?? 0;

  return (
    <div className="mt-10 space-y-6">
      {/* Clock and price — the two facts that define "where" you are. */}
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-line-subtle pb-6">
        <div>
          <span className="eyebrow">
            {symbol} · {date} · bar {session.cursor} of {session.total}
          </span>
          <p className="mt-4 text-numeric-hero">
            <span className="text-ink-tertiary">₹</span>
            <span className="tabular">{price === null ? "—" : priceToRupees(price).toFixed(2)}</span>
          </p>
          {candle ? (
            <p className="tabular mt-2 text-[0.75rem] text-ink-tertiary">
              {formatTime(candle.time)} · simulated historical data
            </p>
          ) : null}
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <Stat label="Session equity" value={formatCurrency(equity, { whole: true })} />
          <Stat label="Cash" value={formatCurrency(session.cash, { whole: true })} />
          <Stat label="Holding" value={`${held.toLocaleString("en-IN")} sh`} />
          <Stat
            label="Realised"
            value={formatCurrency(session.realisedPnl, { whole: true, signed: true })}
            tone={session.realisedPnl >= 0 ? "up" : "down"}
          />
        </dl>
      </div>

      <TransportControls
        status={session.status}
        speed={session.speed}
        cursor={session.cursor}
        total={session.total}
        onPlay={() => setStatus("running")}
        onPause={() => setStatus("paused")}
        onStep={() => void step()}
        onReset={reset}
        onSpeed={changeSpeed}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <Panel>
          <PanelHeader
            title="Revealed so far"
            description="Only bars the session has reached — nothing after them exists here"
          />
          <div className="px-5 py-5 md:px-6">
            {session.revealed.length < 2 ? (
              <Skeleton className="h-[360px] w-full" animate={false} />
            ) : (
              <PriceChart
                candles={session.revealed}
                settings={{ ...DEFAULT_INDICATORS, ma2: false }}
                height={360}
              />
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Trade" description="At the current bar's close" />
          <div className="space-y-4 px-5 py-5 md:px-6">
            <Input
              label="Quantity"
              numeric
              inputMode="numeric"
              trailing="sh"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => trade("BUY")}
                disabled={price === null}
                className="h-11 rounded-full bg-up text-sm font-medium text-white transition-all duration-300 hover:-translate-y-px disabled:pointer-events-none disabled:opacity-40"
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => trade("SELL")}
                disabled={price === null || held === 0}
                className="h-11 rounded-full bg-down text-sm font-medium text-white transition-all duration-300 hover:-translate-y-px disabled:pointer-events-none disabled:opacity-40"
              >
                Sell
              </button>
            </div>

            {session.trades.length === 0 ? (
              <EmptyState
                title="No trades yet"
                description="Orders you place appear here as the session runs."
                className="py-8"
              />
            ) : (
              <ul className="border-t border-line-subtle pt-3">
                {[...session.trades].reverse().slice(0, 8).map((trade, index) => (
                  <li
                    key={`${trade.time}-${index}`}
                    className="flex items-baseline justify-between gap-3 py-1.5 text-[0.75rem]"
                  >
                    <span className={trade.side === "BUY" ? "text-up" : "text-down"}>
                      {trade.side} {trade.quantity}
                    </span>
                    <span className="tabular text-ink-tertiary">
                      ₹{priceToRupees(trade.price as PriceE4).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      <p className="text-xs leading-relaxed text-ink-tertiary">
        Historical simulation with virtual money in a sandbox account. Fills occur at the closing
        price of the bar you are standing on, with no commission or slippage.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className={cn("tabular mt-2 text-[0.9375rem]", tone === "up" && "text-up", tone === "down" && "text-down")}>
        {value}
      </dd>
    </div>
  );
}
