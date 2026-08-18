import type { Metadata } from "next";

import { DnaView } from "@/app/(app)/dna/dna-view";
import { PageContainer, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = {
  title: "Strategy DNA",
  description: "A profile of how you actually trade, drawn from your own history.",
};

export default function DnaPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Behaviour"
        title="Your trading DNA"
        description="What your own completed trades show about how you trade. Descriptive only — it reports what happened, never what will."
      />
      <DnaView />
    </PageContainer>
  );
}
