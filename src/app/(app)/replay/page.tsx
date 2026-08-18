import type { Metadata } from "next";
import { Suspense } from "react";

import { ReplayView } from "@/app/(app)/replay/replay-view";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { SkeletonRows } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Trade Replay",
  description: "Play a completed trade back against the price that surrounded it.",
};

export default function ReplayPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Review"
        title="Trade Replay"
        description="Watch a finished trade play out again — entry, exit, and everything the price did in between."
        action={<DataSourceBadge source="historical" />}
      />

      {/* useSearchParams needs a boundary; the deep link comes from trade history. */}
      <Suspense fallback={<SkeletonRows rows={4} className="mt-10" />}>
        <ReplayView />
      </Suspense>
    </PageContainer>
  );
}
