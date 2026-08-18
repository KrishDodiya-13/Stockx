import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { serverEnv } from "@/config/env";
import {
  UPSTOX_STATE_COOKIE,
  isValidOAuthState,
} from "@/services/market-data/providers/upstox/oauth-state";
import {
  UPSTOX_TOKEN_COOKIE,
  setUpstoxAccessToken,
} from "@/services/market-data/providers/upstox/token-store";

/**
 * OAuth callback for the Upstox login flow.
 *
 * Upstox redirects here with `?code=...` after the user approves the app.
 * This exchanges that code for an access token server-to-server (the
 * `client_secret` never touches the browser), stores it in the in-memory
 * token-store singleton, mirrors it into an httpOnly cookie as a secondary
 * read path, then redirects back to `/`.
 */
export const dynamic = "force-dynamic";

interface UpstoxTokenResponse {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly expires_in?: number;
  readonly error?: string;
  readonly error_description?: string;
}

/** Upstox tokens expire daily around 3:30 AM IST; used only if `expires_in` is absent. */
const DEFAULT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const limit = checkRateLimit(rateLimitKey(request, "upstox-callback"), LIMITS.write);
  if (!limit.allowed) return tooManyRequests(limit);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  const home = new URL("/", url.origin);

  /*
    Verify the round trip before spending the code.

    The state cookie is httpOnly and same-site, so only a flow this server
    actually started can produce a match. Checked before anything else is read
    so a forged callback never reaches the token exchange. The cookie is
    cleared either way — it is single-use.
  */
  const store = await cookies();
  const expectedState = store.get(UPSTOX_STATE_COOKIE)?.value;
  const receivedState = url.searchParams.get("state") ?? undefined;
  store.delete(UPSTOX_STATE_COOKIE);

  if (!isValidOAuthState(receivedState, expectedState)) {
    home.searchParams.set("upstox", "state_mismatch");
    return NextResponse.redirect(home);
  }

  if (oauthError) {
    home.searchParams.set("upstox", "denied");
    return NextResponse.redirect(home);
  }

  if (!code) {
    home.searchParams.set("upstox", "error");
    return NextResponse.redirect(home);
  }

  const clientId = serverEnv.upstoxApiKey;
  const clientSecret = serverEnv.upstoxApiSecret;
  const redirectUri = serverEnv.upstoxRedirectUri;

  if (!clientId || !clientSecret || !redirectUri) {
    home.searchParams.set("upstox", "not_configured");
    return NextResponse.redirect(home);
  }

  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const response = await fetch("https://api.upstox.com/v2/login/authorization/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      cache: "no-store",
    });

    const payload = (await response.json()) as UpstoxTokenResponse;

    if (!response.ok || !payload.access_token) {
      // Only the error fields. The payload as a whole can carry `access_token`,
      // and a credential must never reach the logs.
      console.error(
        `[market-data/upstox] token exchange failed (${response.status}): ${payload.error ?? "unknown"} ${payload.error_description ?? ""}`.trim(),
      );
      home.searchParams.set("upstox", "error");
      return NextResponse.redirect(home);
    }

    const ttlMs = payload.expires_in ? payload.expires_in * 1000 : DEFAULT_TOKEN_TTL_MS;
    setUpstoxAccessToken(payload.access_token, Date.now() + ttlMs);

    store.set(UPSTOX_TOKEN_COOKIE, payload.access_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.floor(ttlMs / 1000),
    });

    home.searchParams.set("upstox", "connected");
    return NextResponse.redirect(home);
  } catch (error) {
    // Message only: a fetch error's cause can quote the request, and the
    // request body carries `client_secret`.
    console.error(
      `[market-data/upstox] callback failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    home.searchParams.set("upstox", "error");
    return NextResponse.redirect(home);
  }
}
