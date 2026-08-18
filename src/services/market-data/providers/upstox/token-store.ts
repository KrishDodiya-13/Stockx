/**
 * In-memory Upstox access-token store.
 *
 * This app has no session/DB-backed store for third-party vendor tokens yet,
 * so the token obtained via `/api/market-data/upstox/callback` is held in a
 * module-level singleton for the lifetime of the server process.
 *
 * ── Known limitations, stated rather than hidden ───────────────────────────
 *  - Resets on every server restart — you'll need to log in again.
 *  - Not multi-instance safe — behind more than one server process/replica,
 *    only whichever instance handled the callback has the token.
 *  - Global to the process, not per-user — fine for a personal/dev deployment
 *    with a single Upstox account; a real multi-tenant app must persist this
 *    per-user in a database instead.
 *
 * Good enough for local development and a personal paper-trading setup, which
 * is what this app is.
 */

import { cookies } from "next/headers";

/** Cookie name used as the secondary read path (see module docstring). */
export const UPSTOX_TOKEN_COOKIE = "upstox_access_token";

let inMemoryToken: string | null = null;
let expiresAt: number | null = null;

/** Store a freshly minted token. Upstox tokens are valid until ~3:30 AM IST. */
export function setUpstoxAccessToken(token: string | null, expiresAtMs: number | null = null): void {
  inMemoryToken = token;
  expiresAt = expiresAtMs;
}

/** True once the stored token has passed its expiry. */
function expired(): boolean {
  return expiresAt !== null && expiresAt <= Date.now();
}

/** In-memory token only, synchronous. Does not consult the cookie. */
export function getUpstoxAccessToken(): string | null {
  /*
    The expiry was recorded at login and then never consulted, so a token that
    had aged out was still handed to every request. Upstox answered 401, the
    app reported "session expired", and the cookie fallback — which may well
    have been fine — was never reached, because the dead in-memory token always
    won. Treating an expired token as absent is what makes that fallback work.
  */
  if (expired()) return null;
  return inMemoryToken;
}

export function getUpstoxTokenExpiry(): number | null {
  return expiresAt;
}

/** Whether a usable, unexpired token is held in memory. */
export function hasLiveUpstoxToken(): boolean {
  return getUpstoxAccessToken() !== null;
}

export function clearUpstoxAccessToken(): void {
  inMemoryToken = null;
  expiresAt = null;
}

/**
 * Resolve a token for this request: the in-memory singleton first (fast,
 * works as long as the same server process handled the callback), falling
 * back to the httpOnly cookie set at login time (covers a restart, or a
 * different instance than the one that handled the callback, as long as the
 * browser still carries the cookie).
 */
export async function resolveUpstoxAccessToken(): Promise<string | null> {
  const live = getUpstoxAccessToken();
  if (live) return live;

  const store = await cookies();
  return store.get(UPSTOX_TOKEN_COOKIE)?.value ?? null;
}
