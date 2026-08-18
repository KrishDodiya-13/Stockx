"use client";

import { useMemo } from "react";

import { IndexStrip } from "@/components/market/index-strip";
import { MarketBreadth, MarketMovers } from "@/components/market/market-movers";
import { MarketHeatmap } from "@/components/market/market-heatmap";
import { MarketTicker } from "@/components/market/market-ticker";
import { SectorStrip } from "@/components/market/sector-strip";
import { VolumeSpikes } from "@/components/market/volume-spikes";
import { Panel, PanelHeader } from "@/components/ui/card";
import { useMarketSnapshot } from "@/hooks/use-market-snapshot";
import { EQUITY_INSTRUMENTS, INDEX_IDS, instrumentId } from "@/services/market-data";

const EQUITY_IDS = EQUITY_INSTRUMENTS.map((instrument) => instrument.id);

const TICKER_IDS = [
  ...INDEX_IDS,
  ...["RELIANCE", "HDFCBANK", "TCS", "INFY", "SBIN", "ITC", "TATAMOTORS", "BHARTIARTL"].map(
    (symbol) => instrumentId("NSE", symbol),
  ),
];

/**
 * Market Pulse.
 *
 * One snapshot subscription feeds the movers, volume spikes and breadth, so
 * every panel on this screen is reading the same instant. The heatmap and index
 * strip subscribe to prices directly for their own tick-level animation, which
 * is the same cache underneath — they cannot disagree.
 */
export function MarketPulse() {
  const ids = useMemo(() => EQUITY_IDS, []);
  const { snapshot } = useMarketSnapshot(ids, { refreshMs: 2000, limit: 8 });

  return (
    <>
      <section className="mt-8" aria-label="Price ticker">
        <div className="border-y border-line-subtle">
          <MarketTicker instrumentIds={TICKER_IDS} durationSeconds={80} />
        </div>
      </section>

      <section className="mt-8" aria-label="Indices">
        <IndexStrip />
      </section>

      <section className="mt-8 border border-line px-5 py-5 md:px-6" aria-label="Market breadth">
        <MarketBreadth snapshot={snapshot} />
      </section>

      <section className="mt-8" aria-label="Heatmap">
        <Panel>
          <PanelHeader
            title="Heatmap"
            description="Every instrument, sized by market capitalisation and shaded by today's move"
          />
          <div className="p-5 md:p-6">
            <MarketHeatmap />
          </div>
        </Panel>
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <MarketMovers snapshot={snapshot} />
        <VolumeSpikes snapshot={snapshot} />
      </div>

      <section className="mt-6">
        <Panel>
          <PanelHeader title="Sector rotation" description="Market-cap weighted change, ranked" />
          <SectorStrip />
        </Panel>
      </section>
    </>
  );
}
