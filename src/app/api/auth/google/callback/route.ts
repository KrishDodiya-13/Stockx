import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { isDatabaseConfigured } from "@/lib/prisma";
import {
  GOOGLE_NEXT_COOKIE,
  GOOGLE_STATE_COOKIE,
  GoogleAuthError,
  fetchGoogleProfile,
  isGoogleConfigured,
  resolveGoogleUser,
} from "@/services/auth/google-oauth";
import { isValidOAuthState } from "@/services/market-data/providers/upstox/oauth-state";
import { safeNextPath } from "@/services/auth/redirect";
import { createSession } from "@/services/auth/session";

export const dynamic = "force-dynamic";

/**
 * Finish Google sign-in.
 *
 * Every failure lands back on `/signin` with a short, non-specific error code
 * in the query string rather than rendering anything here: this route's only
 * successful outcome is a session and a redirect, and an error page served
 * from an OAuth callback is a page nobody can navigate away from cleanly.
 *
 * Nothing from Google is logged. The token exchange carries the client secret
 * and the profile carries an address; neither belongs in a log aggregator.
 */
function backToSignIn(request: Request, error: string): NextResponse {
  const url = new URL("/signin", request.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  if (!isDatabaseConfigured() || !isGoogleConfigured()) {
    return backToSignIn(request, "google_unconfigured");
  }

  const params = new URL(request.url).searchParams;
  const store = await cookies();

  const expectedState = store.get(GOOGLE_STATE_COOKIE)?.value;
  const next = safeNextPath(store.get(GOOGLE_NEXT_COOKIE)?.value);

  // Single-use whatever happens next: a state that has been presented once
  // must not be replayable.
  store.delete(GOOGLE_STATE_COOKIE);
  store.delete(GOOGLE_NEXT_COOKIE);

  // The user pressed "cancel" at Google, or Google refused the request.
  const denied = params.get("error");
  if (denied) return backToSignIn(request, "google_cancelled");

  if (!isValidOAuthState(params.get("state") ?? undefined, expectedState)) {
    /*
      Either this callback was not started by this browser, or the ten-minute
      cookie has expired. Both are refused identically and without detail —
      distinguishing them tells an attacker whether their forged callback got
      as far as matching a real session.
    */
    return backToSignIn(request, "google_state");
  }

  const code = params.get("code");
  if (!code) return backToSignIn(request, "google_no_code");

  try {
    const profile = await fetchGoogleProfile(code);
    const userId = await resolveGoogleUser(profile);

    // The same session the password form issues: same helper, same cookie,
    // same expiry. Nothing downstream can tell how the user proved identity.
    await createSession(userId, request.headers.get("user-agent") ?? undefined);

    return NextResponse.redirect(new URL(next ?? "/dashboard", request.url));
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      console.error(`[auth] google sign-in failed (${error.code})`);
      return backToSignIn(request, `google_${error.code}`);
    }

    console.error("[auth] google sign-in failed", error);
    return backToSignIn(request, "google_failed");
  }
}
