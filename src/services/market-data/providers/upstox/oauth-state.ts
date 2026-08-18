import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * CSRF protection for the Upstox OAuth round trip.
 *
 * ── Why this is needed ─────────────────────────────────────────────────────
 *
 * The callback used to accept any `?code=` it was given. Since the token it
 * mints is stored process-wide, anyone who could reach the callback with a
 * code of their own choosing could replace this server's market-data
 * credential — the classic OAuth login-CSRF, and worse than usual here because
 * the credential is shared rather than per-user.
 *
 * The `state` parameter closes it: `/login` mints a random value, keeps it in
 * an httpOnly cookie, and sends it to Upstox. The callback only proceeds if
 * Upstox echoes back a value matching that cookie, which an attacker cannot
 * read or set.
 */

export const UPSTOX_STATE_COOKIE = "upstox_oauth_state";

/** Long enough that guessing is not worth modelling. */
const STATE_BYTES = 32;

/** The round trip is a redirect and a form post; ten minutes is generous. */
export const STATE_TTL_SECONDS = 600;

export function createOAuthState(): string {
  return randomBytes(STATE_BYTES).toString("base64url");
}

/**
 * Compare in constant time, so a timing side channel cannot be used to
 * reconstruct the expected value byte by byte.
 */
export function isValidOAuthState(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, which is itself public.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
