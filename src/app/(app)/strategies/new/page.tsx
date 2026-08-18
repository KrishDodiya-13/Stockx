import type { Metadata } from "next";

import { StrategiesView } from "@/app/(app)/strategies/strategies-view";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { VirtualMoneyBadge } from "@/components/ui/data-source-badge";

export const metadata: Metadata = {
  title: "New strategy",
  description: "Build a conditional IF/THEN strategy with targets, stops and partial exits.",
};

/**
 * `/strategies/new` — the builder, opened directly.
 *
 * This route did not exist. The builder was reachable only by pressing "New
 * strategy" on `/strategies`, which swaps a view in place without changing the
 * URL, so anyone who typed or bookmarked `/strategies/new` landed on the 404
 * page instead — a short, centred page with no form on it and nothing to
 * scroll.
 *
 * It renders the same `StrategiesView`, opened on the builder, rather than a
 * second copy of the form. One component, two entry points, no duplicated
 * state.
 */
export default function NewStrategyPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Automation"
        title="New strategy"
        description="Describe a plan as ordered IF/THEN rules. Rules run top to bottom — entry first, then targets, then stops."
        action={<VirtualMoneyBadge />}
      />
      <StrategiesView initialView="edit" />
    </PageContainer>
  );
}
