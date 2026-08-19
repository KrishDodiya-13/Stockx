import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { isDatabaseConfigured } from "@/lib/prisma";
import { getCurrentUser } from "@/services/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Request a link to reset your STOCKX paper-trading password.",
  // A reset page has no business in a search index.
  robots: { index: false, follow: false },
};

/**
 * Lives in the `(auth)` route group, so it inherits the same two-column shell
 * as sign-in — the aside, the mobile wordmark, the centred column — without
 * restating any of it.
 */
export default async function ForgotPasswordPage() {
  // Someone already signed in does not need this; the same rule the sign-in
  // page applies.
  if (isDatabaseConfigured() && (await getCurrentUser())) redirect("/dashboard");

  return <ForgotPasswordForm />;
}
