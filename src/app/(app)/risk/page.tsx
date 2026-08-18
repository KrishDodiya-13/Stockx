import type { Metadata } from "next";

import { RiskSimulator } from "@/app/(app)/risk/risk-simulator";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { VirtualMoneyBadge } from "@/components/ui/data-source-badge";

export const metadata: Metadata = {
  title: "Risk Simulator",
  description: "Size a position and see the maximum loss before taking the trade.",
};

export default function RiskPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Risk simulator"
        title="Know the loss first"
        description="Set an entry, a target and a stop, then move the size. Risk is a consequence of position size, not a setting."
        action={<VirtualMoneyBadge />}
      />
      <RiskSimulator />
    </PageContainer>
  );
}
