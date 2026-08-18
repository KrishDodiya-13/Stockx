import type { Metadata } from "next";

import { StockBrowser } from "@/app/(app)/stocks/stock-browser";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { activeQuoteSource, DataSourceBadge } from "@/components/ui/data-source-badge";

export const metadata: Metadata = {
  title: "Stocks",
  description: "Search and analyse instruments.",
};

/**
 * Reading `searchParams` here makes the route dynamic, which is correct for a
 * searchable screen: the deep link the command palette produces
 * (`/stocks?symbol=RELIANCE`) is server-rendered with its results already in
 * the HTML, rather than appearing only once the client bundle has run.
 */
export default async function StocksPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>;
}) {
  const { symbol } = await searchParams;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Instruments"
        title="Stocks"
        description="Search the universe, filter by sector and watch prices update live."
        action={<DataSourceBadge source={activeQuoteSource()} />}
      />

      <StockBrowser initialSymbol={symbol ?? ""} />
    </PageContainer>
  );
}
