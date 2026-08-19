import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { createOAuthState } from "@/services/market-data/providers/upstox/oauth-state";
import {
  GOOGLE_NEXT_COOKIE,
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_TTL_SECONDS,
  googleAuthorizeUrl,
  isGoogleConfigured,
} from "@/services/auth/google-oauth";
import { safeNextPath } from "@/services/auth/redirect";

export const dynamic = "force-dynamic";

/**
 * Begin Google sign-in.
 *
 * ── The state parameter is the whole CSRF story ────────────────────────────
 *
 * This route mints a random value, keeps it in an httpOnly cookie the browser
 * will return, and hands the same value to Google. The callback proceeds only
 * if Google echoes back a value matching that cookie. Without it, anyone could
 * feed the callback an authorisation code of their own and have the victim's
 * browser sign in as *the attacker's* account — the classic login CSRF, which
 * on a trading app means watching someone type their positions into a stranger's
 * portfolio.
 *
 * The generator is the one already written for the Upstox round trip; the
 * problem is identical and there is no reason for a second implementation.
 *
 * `?next=` is validated by `safeNextPath` before being stored, so this cannot
 * be used as an open redirect to an external host.
 */
export async function GET(request: Request) {
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL("/signin?error=google_unconfigured", request.url));
  }

  const limit = checkRateLimit(rateLimitKey(request, "oauth-start"), LIMITS.oauthStart);
  if (!limit.allowed) return tooManyRequests(limit);

  const state = createOAuthState();
  const next = safeNextPath(new URL(request.url).searchParams.get("next"));

  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";

  store.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    // `lax` rather than `strict`: the callback arrives as a top-level
    // navigation from accounts.google.com, and `strict` would withhold the
    // cookie on exactly that request, breaking every sign-in.
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: GOOGLE_STATE_TTL_SECONDS,
  });

  if (next) {
    store.set(GOOGLE_NEXT_COOKIE, next, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: GOOGLE_STATE_TTL_SECONDS,
    });
  }

  return NextResponse.redirect(googleAuthorizeUrl(state));
}
