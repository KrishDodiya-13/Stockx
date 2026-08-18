import type { Metadata } from "next";

import { StrategiesView } from "@/app/(app)/strategies/strategies-view";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { VirtualMoneyBadge } from "@/components/ui/data-source-badge";

export const metadata: Metadata = {
  title: "Strategies",
  description: "Build conditional IF/THEN strategies with targets, stops and partial exits.",
};

export default function StrategiesPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Automation"
        title="Strategies"
        description="Describe a plan as ordered IF/THEN rules. Rules run top to bottom — entry first, then targets, then stops."
        action={<VirtualMoneyBadge />}
      />
      <StrategiesView />
    </PageContainer>
  );
}
