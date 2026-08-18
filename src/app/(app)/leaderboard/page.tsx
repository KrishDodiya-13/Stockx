import type { Metadata } from "next";

import { LeaderboardView } from "@/app/(app)/leaderboard/leaderboard-view";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { VirtualMoneyBadge } from "@/components/ui/data-source-badge";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Rankings by risk-adjusted performance and consistency.",
};

export default function LeaderboardPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Compete"
        title="Leaderboard"
        description="Ranked on how a return was earned, not only on how large it was."
        action={<VirtualMoneyBadge />}
      />
      <LeaderboardView />
    </PageContainer>
  );
}
