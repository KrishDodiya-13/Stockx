import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { serverEnv } from "@/config/env";
import {
  STATE_TTL_SECONDS,
  UPSTOX_STATE_COOKIE,
  createOAuthState,
} from "@/services/market-data/providers/upstox/oauth-state";

/**
 * Starts the Upstox OAuth login flow.
 *
 * Visit this route in a browser (while signed into the Upstox app you're
 * testing with) to be redirected to Upstox's consent screen. On approval,
 * Upstox redirects to `UPSTOX_REDIRECT_URI`, which should point at
 * `/api/market-data/upstox/callback`.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  /*
    Rate limited because this route issues outbound redirects and mints a
    cookie on every call. It is not session-guarded: connecting the feed is a
    deployment-level action that may need to happen before anyone signs in.
  */
  const limit = checkRateLimit(rateLimitKey(request, "upstox-login"), LIMITS.write);
  if (!limit.allowed) return tooManyRequests(limit);

  const clientId = serverEnv.upstoxApiKey;
  const redirectUri = serverEnv.upstoxRedirectUri;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "Set UPSTOX_API_KEY and UPSTOX_REDIRECT_URI before starting the Upstox login flow.",
      },
      { status: 503 },
    );
  }

  /*
    A one-time value tying this redirect to the callback that follows. Without
    it the callback would accept a code from anyone — see `oauth-state.ts`.
  */
  const state = createOAuthState();

  const authorizeUrl = new URL("https://api.upstox.com/v2/login/authorization/dialog");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  const store = await cookies();
  store.set(UPSTOX_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });

  return NextResponse.redirect(authorizeUrl.toString());
}
