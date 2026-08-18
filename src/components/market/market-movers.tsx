"use client";

import Link from "next/link";
import { useState } from "react";

import { Sparkline } from "@/components/market/sparkline";
import { Panel, PanelHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PercentChange, Price } from "@/components/ui/financial";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import type { MarketSnapshot, RankedQuote } from "@/domain/market";
import { formatVolume } from "@/lib/format";
import { stockRoute } from "@/lib/routes";

type MoverView = "gainers" | "losers" | "volume";

const TABS: readonly TabItem<MoverView>[] = [
  { value: "gainers", label: "Gainers" },
  { value: "losers", label: "Losers" },
  { value: "volume", label: "Most active" },
];

/**
 * Top gainers, losers and most-active names.
 *
 * Rows come from the shared market snapshot rather than a separate ranking
 * pass, so this panel and the heatmap beside it are always reading the same
 * prices from the same instant.
 */
export function MarketMovers({ snapshot }: { snapshot: MarketSnapshot | null }) {
  const [view, setView] = useState<MoverView>("gainers");

  const rows: readonly RankedQuote[] = !snapshot
    ? []
    : view === "gainers"
      ? snapshot.gainers
      : view === "losers"
        ? snapshot.losers
        : snapshot.mostActive;

  return (
    <Panel>
      <PanelHeader
        title="Movers"
        description="Ranked across the simulated equity universe"
        action={<Tabs items={TABS} value={view} onValueChange={setView} variant="segment" />}
      />

      {!snapshot ? (
        <SkeletonRows rows={8} className="px-5 md:px-6" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={view === "gainers" ? "Nothing is up right now" : "Nothing is down right now"}
          description="This list fills as instruments move away from their previous close."
          className="py-12"
        />
      ) : (
        <ul>
          {rows.map(({ rank, instrument, quote }) => (
            <li
              key={instrument.id}
              className="border-b border-line-subtle last:border-b-0 row-hover"
            >
              <Link
                href={stockRoute(instrument.symbol)}
                className="flex items-center gap-4 px-5 py-3 md:px-6"
              >
                <span className="tabular w-5 shrink-0 text-[0.6875rem] text-ink-tertiary">
                  {String(rank).padStart(2, "0")}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.875rem] font-medium">
                    {instrument.symbol}
                  </span>
                  <span className="block truncate text-[0.6875rem] text-ink-tertiary">
                    {instrument.name}
                  </span>
                </span>

                <Sparkline
                  instrumentId={instrument.id}
                  changePercent={quote.changePercent}
                  width={64}
                  height={22}
                  className="hidden shrink-0 sm:block"
                />

                {view === "volume" ? (
                  <span className="tabular hidden shrink-0 text-[0.8125rem] text-ink-secondary md:block">
                    {formatVolume(quote.volume)}
                  </span>
                ) : null}

                <span className="flex shrink-0 flex-col items-end">
                  <Price value={quote.price} size="sm" />
                  <PercentChange
                    value={quote.changePercent}
                    size="sm"
                    className="mt-0.5 text-[0.6875rem]"
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Advancing vs declining — the breadth behind an index move. */
export function MarketBreadth({ snapshot }: { snapshot: MarketSnapshot | null }) {
  if (!snapshot) {
    return <span className="block h-1.5 w-full animate-pulse rounded-full bg-line" aria-hidden />;
  }

  const total = snapshot.advancing + snapshot.declining + snapshot.unchanged;
  if (total === 0) return null;

  const advancingPercent = (snapshot.advancing / total) * 100;
  const decliningPercent = (snapshot.declining / total) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between text-[0.6875rem]">
        <span className="tabular text-up">{snapshot.advancing} advancing</span>
        <span className="eyebrow">Breadth</span>
        <span className="tabular text-down">{snapshot.declining} declining</span>
      </div>

      <div
        className="mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-line"
        role="img"
        aria-label={`${snapshot.advancing} instruments advancing, ${snapshot.declining} declining, ${snapshot.unchanged} unchanged`}
      >
        <span className="bg-up transition-all duration-700" style={{ width: `${advancingPercent}%` }} />
        <span className="bg-flat/40 transition-all duration-700" style={{ width: `${100 - advancingPercent - decliningPercent}%` }} />
        <span className="bg-down transition-all duration-700" style={{ width: `${decliningPercent}%` }} />
      </div>
    </div>
  );
}
