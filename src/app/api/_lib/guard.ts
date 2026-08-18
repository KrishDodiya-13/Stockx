import { NextResponse } from "next/server";

import { databaseUnavailable, type ApiError } from "@/app/api/_lib/api-helpers";
import { isDatabaseConfigured } from "@/lib/prisma";
import { getCurrentUser, type AuthenticatedUser } from "@/services/auth/session";

/**
 * Route guards.
 *
 * `requireAccount` is the single door every account-scoped route goes through.
 * It returns the caller's account id derived from their session — routes never
 * accept an account id as a parameter, so one user cannot name another's
 * account no matter what they send.
 */

export type GuardFailure = NextResponse<ApiError>;

export function unauthorized(): GuardFailure {
  return NextResponse.json(
    { error: "unauthorized", message: "Sign in to continue." },
    { status: 401 },
  );
}

/**
 * Resolve the caller or produce the response to return.
 *
 * Returns a discriminated result rather than throwing, so a route cannot
 * accidentally continue past a failed check — the type system requires the
 * failure branch to be handled.
 */
export async function requireAccount(): Promise<
  { ok: true; user: AuthenticatedUser } | { ok: false; response: GuardFailure }
> {
  if (!isDatabaseConfigured()) return { ok: false, response: databaseUnavailable() };

  const user = await getCurrentUser();
  if (!user) return { ok: false, response: unauthorized() };

  return { ok: true, user };
}
