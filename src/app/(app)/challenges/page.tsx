import type { Metadata } from "next";

import { ChallengesView } from "@/app/(app)/challenges/challenges-view";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { VirtualMoneyBadge } from "@/components/ui/data-source-badge";

export const metadata: Metadata = {
  title: "Challenges",
  description: "Objectives on return, win rate, drawdown and discipline.",
};

export default function ChallengesPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Objectives"
        title="Challenges"
        description="Targets that reward discipline as much as return. Every badge states exactly what it measures."
        action={<VirtualMoneyBadge />}
      />
      <ChallengesView />
    </PageContainer>
  );
}
