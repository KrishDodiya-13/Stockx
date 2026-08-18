import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { isDatabaseConfigured } from "@/lib/prisma";
import { getCurrentUser } from "@/services/auth/session";

/**
 * Route group for the trading terminal. The landing page sits outside it and
 * keeps its own full-bleed editorial layout.
 *
 * ── The gate ───────────────────────────────────────────────────────────────
 *
 * Authentication is checked here, on the server, before any page in the group
 * renders. This is the *convenience* half of the protection: the authoritative
 * half is `requireAccount` on every API route, because a client-side redirect
 * protects nothing — the data is what has to be protected, and it is.
 *
 * When no database is configured there is nothing to sign in against, so the
 * shell renders unauthenticated and each API route reports 503 as it already
 * does. Redirecting instead would trap a fresh checkout on a sign-in page that
 * cannot possibly succeed.
 */
/*
  Forced dynamic, and not as a formality.

  Without this, whether the gate runs at all depends on the *build* environment:
  with no DATABASE_URL present at build time the `cookies()` call below is
  skipped, Next prerenders every terminal page as static HTML, and a deployment
  that later has a database would serve that cached shell without ever checking
  a session. The authorisation on the API routes still holds — so no data would
  leak — but a signed-out visitor would land in a terminal full of empty panels
  instead of on the sign-in page.

  A security-relevant code path must not be contingent on which environment
  variables happened to be set when the bundle was built.
*/
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (isDatabaseConfigured()) {
    const user = await getCurrentUser();
    if (!user) redirect("/signin");
  }

  return <AppShell>{children}</AppShell>;
}
