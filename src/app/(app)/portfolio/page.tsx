import type { Metadata } from "next";

import { PortfolioView } from "@/app/(app)/portfolio/portfolio-view";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { VirtualMoneyBadge } from "@/components/ui/data-source-badge";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Holdings, cash, allocation and P&L for your virtual account.",
};

export default function PortfolioPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Account"
        title="Portfolio"
        description="Everything your virtual account holds, and what it has made or lost."
        action={<VirtualMoneyBadge />}
      />
      <PortfolioView />
    </PageContainer>
  );
}
