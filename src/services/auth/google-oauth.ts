import "server-only";

/**
 * Google sign-in.
 *
 * ── Why this is not a second auth system ───────────────────────────────────
 *
 * It is an additional way to *prove who you are*, and nothing more. Once the
 * proof lands, the callback calls the same `createSession` that the password
 * form calls, sets the same cookie, and every route downstream — `requireAccount`,
 * the portfolio, the order engine — is unchanged and unaware. No second session
 * model, no second cookie, no NextAuth alongside the sessions this app already
 * owns.
 *
 * The authorisation-code flow is implemented directly rather than through a
 * framework for the same reason the Upstox integration is: it is one redirect
 * and one POST, and adding a full auth framework to gain them would mean two
 * systems that both believe they own the session.
 *
 * ── What is verified before anyone is signed in ────────────────────────────
 *
 * The `state` round trip (CSRF, mirroring `oauth-state.ts`), that Google says
 * the address is verified, and that the identity has not already been claimed
 * by another user. Each is load-bearing and each is explained where it happens.
 *
 * Server-only.
 */

import { serverEnv } from "@/config/env";
import { DEFAULT_INITIAL_DEPOSIT_RUPEES } from "@/domain/constants";
import { prisma } from "@/lib/prisma";
import { rupeesToPaise } from "@/lib/money";
import { createAccountForUser } from "@/services/auth/session";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export const PROVIDER = "google";

/**
 * Cookies carrying the round trip's state.
 *
 * Defined here rather than in the route that sets them: a Next route file may
 * export nothing but its handlers, and both the start and the callback need
 * these names.
 */
export const GOOGLE_STATE_COOKIE = "google_oauth_state";
export const GOOGLE_NEXT_COOKIE = "google_oauth_next";

/** The round trip is a redirect and a form post; ten minutes is generous. */
export const GOOGLE_STATE_TTL_SECONDS = 600;

/** A hung provider must not hold the callback open. */
const REQUEST_TIMEOUT_MS = 10_000;

/** True when the app is configured to offer Google sign-in at all. */
export function isGoogleConfigured(): boolean {
  return Boolean(serverEnv.googleClientId && serverEnv.googleClientSecret);
}

/**
 * The redirect URI, derived from the app's own configured origin.
 *
 * Built from `APP_URL` rather than the request's `Host` header for the same
 * reason the reset link is: `Host` is attacker-controlled, and Google requires
 * this value to match the console entry exactly, so it must be configuration.
 */
export function googleRedirectUri(): string {
  return `${serverEnv.appUrl}/api/auth/google/callback`;
}

/** Where to send the browser to begin the round trip. */
export function googleAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: serverEnv.googleClientId ?? "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    // The minimum that answers "who is this": an identifier and an address.
    // No Drive, no contacts, no offline access — this app never acts on the
    // user's behalf at Google, so it asks for nothing that would let it.
    scope: "openid email profile",
    state,
    // No refresh token is requested: there is nothing to refresh for. The
    // session this app issues is its own.
    prompt: "select_account",
  });

  return `${AUTH_ENDPOINT}?${params}`;
}

interface GoogleTokenResponse {
  readonly access_token?: string;
  readonly id_token?: string;
}

interface GoogleProfile {
  /** Google's immutable identifier for the account. */
  readonly sub: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly name?: string;
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    /** Short, safe identifier for the failure, used in the redirect. */
    readonly code: string,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/**
 * Exchange the authorisation code for the user's profile.
 *
 * The code is single-use and short-lived at Google's end, and it is sent over
 * a server-to-server POST with the client secret — it never touches the
 * browser beyond the redirect that delivered it.
 */
export async function fetchGoogleProfile(code: string): Promise<GoogleProfile> {
  const clientId = serverEnv.googleClientId;
  const clientSecret = serverEnv.googleClientSecret;

  if (!clientId || !clientSecret) {
    throw new GoogleAuthError("Google sign-in is not configured.", "unconfigured");
  }

  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!tokenResponse.ok) {
    // The body is not logged: it echoes the request, which carries the client
    // secret in this call.
    throw new GoogleAuthError(
      `Google rejected the token exchange (${tokenResponse.status}).`,
      "exchange_failed",
    );
  }

  const tokens = (await tokenResponse.json()) as GoogleTokenResponse;
  if (!tokens.access_token) {
    throw new GoogleAuthError("Google returned no access token.", "exchange_failed");
  }

  const profileResponse = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!profileResponse.ok) {
    throw new GoogleAuthError(
      `Google rejected the profile request (${profileResponse.status}).`,
      "profile_failed",
    );
  }

  const profile = (await profileResponse.json()) as GoogleProfile;
  if (!profile.sub) {
    throw new GoogleAuthError("Google returned no account identifier.", "profile_failed");
  }

  return profile;
}

/**
 * Resolve a Google profile to a user id, linking or creating as needed.
 *
 * ── The three cases, and why they are ordered this way ─────────────────────
 *
 * 1. The identity is already linked → that user. Matched on Google's `sub`,
 *    not on the address, because an address can be changed or reassigned at
 *    the provider and the subject id cannot.
 *
 * 2. An account exists with the same address → link to it. This is what stops
 *    a duplicate account appearing for someone who registered with a password
 *    and later clicks the Google button, which is exactly the case that would
 *    otherwise split one person's portfolio across two accounts.
 *
 * 3. Nobody matches → create the user and their funded account, the same way
 *    the sign-up route does.
 */
export async function resolveGoogleUser(profile: GoogleProfile): Promise<string> {
  /*
    An unverified Google address is refused outright.

    Case 2 links a Google identity to an existing password account on the
    strength of the address matching. If Google has not verified that address,
    anyone able to set an arbitrary unverified email on a Google account could
    use this to take over the matching account here. Google sets this flag
    honestly; the whole safety of account linking rests on reading it.
  */
  const email = profile.email?.trim().toLowerCase();
  if (!email || profile.email_verified !== true) {
    throw new GoogleAuthError(
      "Google did not supply a verified email address for this account.",
      "email_unverified",
    );
  }

  const linked = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: { provider: PROVIDER, providerAccountId: profile.sub },
    },
    select: { userId: true },
  });

  if (linked) return linked.userId;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true },
  });

  if (existing) {
    await prisma.$transaction(async (tx) => {
      await tx.oAuthAccount.create({
        data: { userId: existing.id, provider: PROVIDER, providerAccountId: profile.sub },
      });

      /*
        Signing in through Google proves control of the address, so an account
        that had never verified becomes verified here. Without this, someone
        who signed up with a password, never opened the email, and then used
        the Google button would still be refused at sign-in — having just
        proved the very thing the refusal is asking for.
      */
      if (!existing.emailVerifiedAt) {
        await tx.user.update({
          where: { id: existing.id },
          data: { emailVerifiedAt: new Date() },
        });
      }
    });

    return existing.id;
  }

  // A new person. The account and its opening ledger entry are created by the
  // same helper the sign-up route uses, so a Google account is funded and
  // reconcilable exactly like any other.
  const user = await prisma.user.create({
    data: {
      email,
      name: profile.name?.trim().slice(0, 80) || null,
      // No password. This account signs in through Google until its owner sets
      // one; `passwordHash` stays null and the password paths refuse it.
      emailVerifiedAt: new Date(),
      oauthAccounts: {
        create: { provider: PROVIDER, providerAccountId: profile.sub },
      },
    },
    select: { id: true },
  });

  await createAccountForUser(user.id, rupeesToPaise(DEFAULT_INITIAL_DEPOSIT_RUPEES));

  return user.id;
}
