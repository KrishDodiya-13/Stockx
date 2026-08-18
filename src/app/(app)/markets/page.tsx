import type { Metadata } from "next";

import { MarketPulse } from "@/app/(app)/markets/market-pulse";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { ConnectionStatusPill } from "@/components/market/connection-status";
import { activeQuoteSource, DataSourceBadge } from "@/components/ui/data-source-badge";

export const metadata: Metadata = {
  title: "Market Pulse",
  description: "Indices, movers, heatmap and sector rotation.",
};

export default function MarketsPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Market Pulse"
        title="The market, live"
        description="Indices, the day's movers, unusual volume and where money is rotating between sectors."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <ConnectionStatusPill />
            <DataSourceBadge source={activeQuoteSource()} />
          </div>
        }
      />

      <MarketPulse />

      <p className="mt-10 max-w-2xl text-xs leading-relaxed text-ink-tertiary">
        Every price, volume figure and ranking on this screen is produced by a local simulator. It
        is not real market data, is not sourced from any exchange or vendor, and must not be used to
        inform a real trading decision.
      </p>
    </PageContainer>
  );
}
