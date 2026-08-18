import type { Metadata } from "next";

import { BacktestView } from "@/app/(app)/backtest/backtest-view";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";

export const metadata: Metadata = {
  title: "Backtesting",
  description: "Replay a strategy over historical data and read its equity curve.",
};

export default function BacktestPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Historical simulation"
        title="Backtesting"
        description="Replay a strategy's rules bar by bar over a past period. The engine sees only data up to the bar it is evaluating — never anything after it."
        action={<DataSourceBadge source="historical" />}
      />
      <BacktestView />
    </PageContainer>
  );
}
