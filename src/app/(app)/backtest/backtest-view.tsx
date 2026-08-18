"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { BacktestCharts, BacktestStat } from "@/components/backtest/backtest-charts";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Select, type SelectOption } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import type { Strategy } from "@/domain/strategy";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import type { Paise } from "@/lib/money";
import type { BacktestResult } from "@/services/backtest/backtest-engine";
import { handleSessionExpiry } from "@/lib/session-expiry";

const INTERVALS: readonly SelectOption[] = [
  { value: "1d", label: "Daily", hint: "One bar per day" },
  { value: "1h", label: "Hourly", hint: "One bar per hour" },
  { value: "15m", label: "15 minutes", hint: "Intraday detail" },
  { value: "5m", label: "5 minutes", hint: "Fine intraday detail" },
];

const DAY = 86_400_000;

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function BacktestView() {
  const { toast } = useToast();

  const [strategies, setStrategies] = useState<readonly Strategy[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unconfigured">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const [strategyId, setStrategyId] = useState("");
  const [from, setFrom] = useState(isoDate(Date.now() - 180 * DAY));
  const [to, setTo] = useState(isoDate(Date.now()));
  /*
    Named `barInterval` rather than `interval`, because the obvious name gives
    the setter the name `setInterval`, which shadows the global timer function
    for the whole component. Nothing here schedules a timer today, so this was
    harmless — but the next person to add one would get a confusing type error
    at best, and a call into React state at worst.
  */
  const [barInterval, setBarInterval] = useState("1d");
  const [capital, setCapital] = useState("1000000");

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/strategies", { cache: "no-store" });

      if (handleSessionExpiry(response)) return;
      const payload = (await response.json()) as {
        strategies?: Strategy[];
        error?: string;
        message?: string;
      };

      if (response.status === 503 && payload.error === "database_not_configured") {
        setState("unconfigured");
        setMessage(payload.message ?? null);
        return;
      }
      if (!response.ok) {
        setState("error");
        setMessage(payload.message ?? "Could not load strategies.");
        return;
      }

      const list = payload.strategies ?? [];
      setStrategies(list);
      if (list[0]) setStrategyId(list[0].id);
      setState("ready");
    } catch {
      setState("error");
      setMessage("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const strategyOptions = useMemo<readonly SelectOption[]>(
    () =>
      strategies.map((strategy) => ({
        value: strategy.id,
        label: strategy.name,
        hint: `${strategy.symbol} · ${strategy.rules.length} rules`,
      })),
    [strategies],
  );

  const selected = strategies.find((strategy) => strategy.id === strategyId) ?? null;

  async function run(): Promise<void> {
    setRunning(true);
    setRunError(null);
    setResult(null);

    try {
      const response = await fetch("/api/backtests/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyId,
          from: new Date(`${from}T00:00:00Z`).getTime(),
          to: new Date(`${to}T23:59:59Z`).getTime(),
          interval: barInterval,
          initialCapital: Number(capital),
        }),
      });

      if (handleSessionExpiry(response)) return;

      const payload = (await response.json()) as {
        result?: BacktestResult;
        message?: string;
      };

      if (!response.ok || !payload.result) {
        setRunError(payload.message ?? "The backtest could not be run.");
        return;
      }

      if (payload.result.error) {
        setRunError(payload.result.error);
        return;
      }

      setResult(payload.result);
    } catch {
      setRunError("Could not reach the server.");
    } finally {
      setRunning(false);
    }
  }

  async function save(): Promise<void> {
    if (!result || !selected) return;
    setSaving(true);

    try {
      const response = await fetch("/api/backtests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${selected.name} · ${from} → ${to}`,
          strategyId: selected.id,
          strategyName: selected.name,
          instrumentId: selected.instrumentId,
          symbol: selected.symbol,
          from: new Date(`${from}T00:00:00Z`).getTime(),
          to: new Date(`${to}T23:59:59Z`).getTime(),
          interval: barInterval,
          result,
        }),
      });

      if (handleSessionExpiry(response)) return;

      toast(
        response.ok
          ? { title: "Backtest saved", tone: "success" }
          : { title: "Could not save the backtest", tone: "error" },
      );
    } finally {
      setSaving(false);
    }
  }

  // --- states --------------------------------------------------------------

  if (state === "unconfigured") {
    return (
      <Panel className="mt-10">
        <EmptyState
          title="Backtesting needs a database"
          description={
            message ??
            "Strategies are stored per account, so the database must be configured before a backtest can run."
          }
        />
      </Panel>
    );
  }

  if (state === "loading") return <SkeletonRows rows={4} className="mt-10" />;

  if (state === "error") {
    return (
      <Panel className="mt-10">
        <EmptyState title="Could not load strategies" description={message ?? "Try again."} />
      </Panel>
    );
  }

  if (strategies.length === 0) {
    return (
      <Panel className="mt-10">
        <EmptyState
          title="Build a strategy first"
          description="A backtest replays a strategy's rules over historical data. Create one, then return here to test it."
        />
      </Panel>
    );
  }

  return (
    <div className="mt-10 space-y-6">
      {/* --- setup --------------------------------------------------------- */}
      <Panel>
        <PanelHeader title="Run a backtest" description="Replays the strategy over a past period" />

        <div className="grid gap-4 px-5 py-5 md:grid-cols-2 md:px-6 xl:grid-cols-5">
          <Select
            label="Strategy"
            options={strategyOptions}
            value={strategyId}
            onValueChange={setStrategyId}
          />
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} max={isoDate(Date.now())} />
          <Select
            label="Interval"
            options={INTERVALS}
            value={barInterval}
            onValueChange={setBarInterval}
          />
          <Input
            label="Initial capital"
            numeric
            inputMode="decimal"
            leading="₹"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle px-5 py-4 md:px-6">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running || !strategyId}
            className="inline-flex h-11 items-center rounded-full bg-ink px-6 text-sm font-medium text-ink-inverse transition-all duration-300 hover:-translate-y-px disabled:pointer-events-none disabled:opacity-40"
          >
            {running ? "Running…" : "Run backtest"}
          </button>

          {selected ? (
            <span className="text-[0.75rem] text-ink-tertiary">
              {selected.symbol} · {selected.rules.length} rules
            </span>
          ) : null}
        </div>
      </Panel>

      {runError ? (
        <Panel>
          <EmptyState title="The backtest could not run" description={runError} className="py-12" />
        </Panel>
      ) : null}

      {/* --- results ------------------------------------------------------- */}
      {result ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex rounded-full border border-accent/40 bg-accent/8 px-3 py-1 text-[0.625rem] font-medium uppercase tracking-[0.14em] text-accent">
              Historical simulation
            </span>
            <span className="text-[0.75rem] text-ink-tertiary">
              {formatDate(new Date(`${from}T00:00:00Z`).getTime())} →{" "}
              {formatDate(new Date(`${to}T00:00:00Z`).getTime())}
            </span>
          </div>

          <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            <BacktestStat
              label="Total return"
              value={formatCurrency(result.totalReturn as Paise, { whole: true, signed: true })}
              sub={formatPercent(result.totalReturnPercent, { signed: true })}
              tone={result.totalReturn >= 0 ? "up" : "down"}
            />
            <BacktestStat
              label="Win rate"
              value={`${result.winRate.toFixed(1)}%`}
              sub={`${result.winCount}W / ${result.lossCount}L`}
            />
            <BacktestStat
              label="Profit factor"
              value={result.profitFactor === null ? "—" : result.profitFactor.toFixed(2)}
              sub={result.profitFactor === null ? "No losing trades" : "Gross profit ÷ gross loss"}
            />
            <BacktestStat
              label="Max drawdown"
              value={formatPercent(result.maxDrawdownPercent)}
              sub={formatCurrency(result.maxDrawdown as Paise, { whole: true })}
              tone={result.maxDrawdown > 0 ? "down" : undefined}
            />
          </div>

          <div className="mt-px grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            <BacktestStat label="Trades" value={String(result.tradeCount)} sub="Closed round trips" />
            <BacktestStat
              label="Average trade"
              value={formatCurrency(result.averageTrade as Paise, { whole: true, signed: true })}
              sub="Per closed trade"
            />
            <BacktestStat
              label="Best trade"
              value={
                result.bestTrade
                  ? formatCurrency(result.bestTrade.pnl as Paise, { whole: true, signed: true })
                  : "—"
              }
              sub={result.bestTrade ? formatPercent(result.bestTrade.pnlPercent, { signed: true }) : undefined}
              tone={result.bestTrade && result.bestTrade.pnl > 0 ? "up" : undefined}
            />
            <BacktestStat
              label="Worst trade"
              value={
                result.worstTrade
                  ? formatCurrency(result.worstTrade.pnl as Paise, { whole: true, signed: true })
                  : "—"
              }
              sub={result.worstTrade ? formatPercent(result.worstTrade.pnlPercent, { signed: true }) : undefined}
              tone={result.worstTrade && result.worstTrade.pnl < 0 ? "down" : undefined}
            />
          </div>

          <Panel>
            <PanelHeader title="Performance" description="Equity and drawdown over the period" />
            <div className="px-5 py-6 md:px-6">
              <BacktestCharts
                equityCurve={result.equityCurve}
                fills={result.fills}
                initialCapital={result.initialCapital}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Trades"
              description={`${result.trades.length} closed round ${result.trades.length === 1 ? "trip" : "trips"}`}
              action={
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="rounded-full border border-line px-4 py-1.5 text-[0.75rem] text-ink-secondary transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save backtest"}
                </button>
              }
            />

            {result.trades.length === 0 ? (
              <EmptyState
                title="No trades were closed"
                description="The strategy's conditions were never met over this period, or a position was still open when it ended."
                className="py-12"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[42rem] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line-subtle">
                      <Th className="pl-5 md:pl-6">Entry</Th>
                      <Th>Exit</Th>
                      <Th align="right">Qty</Th>
                      <Th align="right">In</Th>
                      <Th align="right">Out</Th>
                      <Th align="right" className="pr-5 md:pr-6">P&L</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((trade, index) => (
                      <tr key={index} className="border-b border-line-subtle last:border-b-0">
                        <td className="py-3 pl-5 text-[0.8125rem] text-ink-secondary md:pl-6">
                          {formatDate(trade.entryTime)}
                        </td>
                        <td className="py-3 text-[0.8125rem] text-ink-secondary">
                          {formatDate(trade.exitTime)}
                        </td>
                        <td className="tabular py-3 text-right text-[0.8125rem]">{trade.quantity}</td>
                        <td className="tabular py-3 text-right text-[0.8125rem]">
                          ₹{(trade.entryPrice / 10_000).toFixed(2)}
                        </td>
                        <td className="tabular py-3 text-right text-[0.8125rem]">
                          ₹{(trade.exitPrice / 10_000).toFixed(2)}
                        </td>
                        <td
                          className={cn(
                            "tabular py-3 pr-5 text-right text-[0.8125rem] md:pr-6",
                            trade.pnl >= 0 ? "text-up" : "text-down",
                          )}
                        >
                          {formatCurrency(trade.pnl as Paise, { whole: true, signed: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="max-w-3xl space-y-2 text-xs leading-relaxed text-ink-tertiary">
            <p>
              <strong className="text-ink-secondary">This is a historical simulation.</strong>{" "}
              Orders fill at the closing price of the bar that triggered them, in full, with no
              commission, no slippage and no allowance for whether the market could absorb the size
              — a real fill can only be worse.
            </p>
            <p>
              The strategy re-arms after each completed round trip and looks for its next setup
              from the following bar, so these figures describe the rules applied repeatedly across
              the period rather than a single trade.
            </p>
            <p>
              Past behaviour of any instrument does not indicate future results. Nothing here is a
              prediction or a recommendation.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Th({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn("eyebrow py-3 font-medium", align === "right" && "text-right", className)}
    >
      {children}
    </th>
  );
}
