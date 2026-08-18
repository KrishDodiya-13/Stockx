import type { Metadata } from "next";

import { SettingsPanels } from "@/app/(app)/settings/settings-panels";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { bigIntToNumber, isDatabaseConfigured, prisma } from "@/lib/prisma";
import type { Paise } from "@/lib/money";
import { getCurrentUser } from "@/services/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
  description: "Theme, motion and account preferences.",
};

export default async function SettingsPage() {
  const user = isDatabaseConfigured() ? await getCurrentUser() : null;

  const account = user
    ? await prisma.account.findUnique({
        where: { id: user.accountId },
        select: { cashBalance: true, startingCapital: true },
      })
    : null;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="How the terminal looks and behaves, and what your virtual account is."
      />
      <SettingsPanels
        email={user?.email ?? null}
        name={user?.name ?? null}
        cashBalance={account ? (bigIntToNumber(account.cashBalance) as Paise) : null}
        startingCapital={account ? (bigIntToNumber(account.startingCapital) as Paise) : null}
      />
    </PageContainer>
  );
}
