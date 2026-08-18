import type { Metadata } from "next";

import { WatchlistView } from "@/app/(app)/watchlist/watchlist-view";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { activeQuoteSource, DataSourceBadge } from "@/components/ui/data-source-badge";

export const metadata: Metadata = {
  title: "Watchlist",
  description: "The instruments you follow, with live prices and one-tap trading.",
};

/**
 * The watchlist is per-user and read from the database, so this route is
 * dynamic — a cached copy would show one person's list to another.
 */
export const dynamic = "force-dynamic";

export default function WatchlistPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Trade"
        title="Watchlist"
        description="The instruments you follow, priced live and ready to trade with virtual money."
        action={<DataSourceBadge source={activeQuoteSource()} />}
      />

      <WatchlistView />
    </PageContainer>
  );
}
