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
  searchParams: Promise<{ mode?: string; next?: string }>;
}) {
  const { mode, next } = await searchParams;

  // An already-signed-in visitor has no business on this page.
  if (isDatabaseConfigured() && (await getCurrentUser())) redirect("/dashboard");

  return (
    <AuthForm initialMode={mode === "signup" ? "signup" : "signin"} next={safeNextPath(next)} />
  );
}
