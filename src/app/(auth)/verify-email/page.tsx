import type { Metadata } from "next";

import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm your email",
  description: "Confirm your email address for your STOCKX paper-trading account.",
  // The URL carries a live verification token; never indexed, never followed.
  robots: { index: false, follow: false },
};

/**
 * Confirm an email address.
 *
 * The token is read from the URL and posted by the client, rather than being
 * spent during this render. Mail clients and corporate link scanners prefetch
 * GET links, and a page that verified on render would let a scanner confirm an
 * address its owner never opened.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return <VerifyEmailPanel token={typeof token === "string" ? token : ""} />;
}
