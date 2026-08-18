"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import {
  EQUITY_RANGES,
  RANGE_WINDOW_MS,
  windowSeries,
  type EquityPoint,
  type EquityRange,
} from "@/components/portfolio/equity-series";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { formatCurrency, formatPercent } from "@/lib/format";
import { type Paise } from "@/lib/money";
import { handleSessionExpiry } from "@/lib/session-expiry";

const CHART_HEIGHT = 260;

/**
 * The canvas chart, loaded on demand.
 *
 * It is the heaviest thing on the dashboard and nothing above the fold needs
 * it, so it is kept out of the initial bundle. `ssr: false` because it measures
 * its container and reads the theme's computed colour tokens — neither exists
 * on the server, and rendering an empty canvas into the HTML only to discard it
 * costs a paint for nothing.
 */
const EquityChart = dynamic(
  () => import("@/components/portfolio/equity-chart").then((module) => module.EquityChart),
  {
    ssr: false,
    loading: () => <Skeleton className="w-full" style={{ height: CHART_HEIGHT }} />,
  },
);

const RANGE_TABS: readonly TabItem<EquityRange>[] = EQUITY_RANGES.map((value) => ({
  value,
  label: value,
}));

interface HistoryResponse {
  points?: EquityPoint[];
  startingCapital?: number;
  tradeCount?: number;
  error?: string;
  message?: string;
}

/**
 * Portfolio performance.
 *
 * This component owns the data and the frame; `EquityChart` owns the pixels.
 * The split is what keeps a live-value update cheap — the series is rebuilt
 * only when the history, the range or the account value actually change, and
 * the chart repaints a canvas rather than remounting.
 *
 * Every value drawn comes from `/api/portfolio/history`, which is the account's
 * own booked P&L, plus the live account value as the closing point. Nothing is
 * generated or interpolated.
 */
export function PortfolioChart({ liveValue }: { liveValue: Paise | null }) {
  const [range, setRange] = useState<EquityRange>("1M");
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/portfolio/history", { cache: "no-store" });

        if (handleSessionExpiry(response)) return;
        const payload = (await response.json()) as HistoryResponse;
        if (cancelled) return;

        if (!response.ok) {
          setFailed(true);
          setHistory(payload);
          return;
        }
        setHistory(payload);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
    "Now" is pinned, and advances only when the account value does.

    Calling `Date.now()` inside the series memo would move the window on every
    render — including renders caused by something else entirely — so the memo
    would never hit and the whole series would be rebuilt for nothing. Pinning
    it to the moment the value last changed is both cheaper and more accurate:
    the right-hand edge is stamped with when that value was actually observed.
  */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
  }, [liveValue]);

  const series = useMemo(() => {
    const points = history?.points ?? [];
    if (points.length === 0) return [];

    return windowSeries(points, {
      from: now - RANGE_WINDOW_MS[range],
      to: now,
      liveValue,
    });
  }, [history, range, liveValue, now]);

  // --- states --------------------------------------------------------------

  if (failed) {
    return (
      <Frame range={range} onRangeChange={setRange}>
        <EmptyState
          title="Performance data is unavailable"
          description="The account history could not be loaded. It will appear here once the connection recovers."
          className="py-16"
        />
      </Frame>
    );
  }

  if (!history) {
    return (
      <Frame range={range} onRangeChange={setRange}>
        <Skeleton className="w-full" style={{ height: CHART_HEIGHT }} />
      </Frame>
    );
  }

  if ((history.tradeCount ?? 0) === 0 || series.length < 2) {
    return (
      <Frame range={range} onRangeChange={setRange}>
        <EmptyState
          title="No performance history yet"
          description="Your equity curve is drawn from trades you have actually closed. Place your first paper trade and it starts here."
          className="py-16"
        />
      </Frame>
    );
  }

  const first = series[0]!.value;
  const last = series[series.length - 1]!.value;
  const delta = last - first;
  const rising = delta >= 0;
  const changePercent = first === 0 ? 0 : (delta / Math.abs(first)) * 100;

  return (
    <Frame
      range={range}
      onRangeChange={setRange}
      summary={
        <div className="flex items-baseline gap-3">
          {/* Sign is printed as well as coloured. */}
          <span className={cn("tabular text-numeric-m", rising ? "text-up" : "text-down")}>
            {rising ? "+" : "−"}
            {formatCurrency(Math.abs(delta) as Paise, { whole: true })}
          </span>
          <span className={cn("tabular text-[0.8125rem]", rising ? "text-up" : "text-down")}>
            {formatPercent(changePercent, { signed: true })}
          </span>
          <span className="text-[0.6875rem] text-ink-tertiary">over {range}</span>
        </div>
      }
    >
      <EquityChart series={series} range={range} height={CHART_HEIGHT} />
    </Frame>
  );
}

function Frame({
  range,
  onRangeChange,
  summary,
  children,
}: {
  range: EquityRange;
  onRangeChange: (range: EquityRange) => void;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="eyebrow">Performance</h2>
          {summary ? <div className="mt-2.5">{summary}</div> : null}
          <p className="mt-2 text-[0.6875rem] text-ink-tertiary">
            Realised equity — booked P&amp;L only, excluding open-position movement
          </p>
        </div>
        <Tabs items={RANGE_TABS} value={range} onValueChange={onRangeChange} variant="segment" />
      </div>
      {children}
    </div>
  );
}
