"use client";

import Link from "next/link";

import { Sparkline } from "@/components/market/sparkline";
import { Panel, PanelHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PercentChange } from "@/components/ui/financial";
import { SkeletonRows } from "@/components/ui/skeleton";
import type { MarketSnapshot } from "@/domain/market";
import { formatVolume } from "@/lib/format";
import { stockRoute } from "@/lib/routes";
import { VOLUME_SPIKE_THRESHOLD } from "@/services/market-data";

/**
 * Instruments trading unusually heavily for themselves.
 *
 * Ranked by *relative* volume rather than absolute — a large-cap always trades
 * more shares than a mid-cap, so an absolute list would show the same names
 * every day and say nothing.
 */
export function VolumeSpikes({ snapshot }: { snapshot: MarketSnapshot | null }) {
  return (
    <Panel>
      <PanelHeader
        title="Volume spikes"
        description={`Trading at ${VOLUME_SPIKE_THRESHOLD}× their own average or more`}
      />

      {!snapshot ? (
        <SkeletonRows rows={5} className="px-5 md:px-6" />
      ) : snapshot.volumeSpikes.length === 0 ? (
        <EmptyState
          title="No unusual volume right now"
          description={`Nothing is trading at ${VOLUME_SPIKE_THRESHOLD}× its average volume. This panel fills as activity picks up.`}
          className="py-12"
        />
      ) : (
        <ul>
          {snapshot.volumeSpikes.map(({ instrument, quote, relativeVolume }) => (
            <li
              key={instrument.id}
              className="border-b border-line-subtle last:border-b-0 row-hover"
            >
              <Link
                href={stockRoute(instrument.symbol)}
                className="flex items-center gap-4 px-5 py-3 md:px-6"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.875rem] font-medium">
                    {instrument.symbol}
                  </span>
                  <span className="tabular block truncate text-[0.6875rem] text-ink-tertiary">
                    {formatVolume(quote.volume)} vs {formatVolume(quote.averageVolume)} avg
                  </span>
                </span>

                <Sparkline
                  instrumentId={instrument.id}
                  changePercent={quote.changePercent}
                  width={64}
                  height={22}
                  className="hidden shrink-0 sm:block"
                />

                <span className="flex shrink-0 flex-col items-end">
                  <span className="tabular text-[0.875rem] font-medium text-accent">
                    {relativeVolume.toFixed(1)}×
                  </span>
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
