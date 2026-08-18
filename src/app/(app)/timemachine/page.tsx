import type { Metadata } from "next";

import { TimeMachine } from "@/app/(app)/timemachine/time-machine";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { DataSourceBadge } from "@/components/ui/data-source-badge";

export const metadata: Metadata = {
  title: "Time Machine",
  description: "Trade a historical session forward, without seeing what comes next.",
};

export default function TimeMachinePage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Historical simulation"
        title="Time Machine"
        description="Drop into a past moment and trade it forward at your own pace. The session receives only the bars it has reached — the next one does not exist until you get there."
        action={<DataSourceBadge source="historical" />}
      />
      <TimeMachine />
    </PageContainer>
  );
}
