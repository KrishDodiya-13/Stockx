import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { isDatabaseConfigured } from "@/lib/prisma";
import { safeNextPath } from "@/services/auth/redirect";
import { getCurrentUser } from "@/services/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your STOCKX paper-trading account.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string; error?: string }>;
}) {
  const { mode, next, error } = await searchParams;

  // An already-signed-in visitor has no business on this page.
  if (isDatabaseConfigured() && (await getCurrentUser())) redirect("/dashboard");

  /*
    `error` carries a short code from the Google callback, which has no page of
    its own — its only outcomes are a session or a redirect back here. Without
    this the browser would return from Google to an unchanged sign-in form and
    the user would have no idea why nothing happened.
  */
  return (
    <AuthForm
      initialMode={mode === "signup" ? "signup" : "signin"}
      next={safeNextPath(next)}
      errorCode={typeof error === "string" ? error : undefined}
    />
  );
}
