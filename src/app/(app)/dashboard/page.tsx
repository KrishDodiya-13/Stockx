import type { Metadata } from "next";

import { OpenPositions } from "@/app/(app)/dashboard/account-summary";
import { PortfolioHero } from "@/app/(app)/dashboard/portfolio-hero";
import { PageContainer } from "@/components/layout/page-header";
import { IndexStrip } from "@/components/market/index-strip";
import { QuoteTable } from "@/components/market/quote-table";
import { Panel, PanelHeader } from "@/components/ui/card";
import { activeQuoteSource, DataSourceBadge, VirtualMoneyBadge } from "@/components/ui/data-source-badge";
import { instrumentId } from "@/services/market-data";

export const metadata: Metadata = { title: "Dashboard" };

const WATCHLIST = ["RELIANCE", "HDFCBANK", "TCS", "INFY", "SBIN", "TATAMOTORS"].map((symbol) =>
  instrumentId("NSE", symbol),
);

/**
 * The dashboard leads with the account, not with a grid of equal-weight cards:
 * one hero figure, four supporting metrics, then the market.
 */
export default function DashboardPage() {
  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-4">
        <VirtualMoneyBadge />
        <DataSourceBadge source={activeQuoteSource()} />
      </div>

      <PortfolioHero />

      <section className="mt-16" aria-label="Market indices">
        <h2 className="eyebrow mb-5">Market</h2>
        <IndexStrip />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Watchlist" description="Prices from your market-data feed" />
          <QuoteTable instrumentIds={WATCHLIST} showSparkline />
        </Panel>

        <Panel>
          <PanelHeader title="Open positions" description="Held in your virtual account" />
          <OpenPositions />
        </Panel>
      </div>
    </PageContainer>
  );
}
