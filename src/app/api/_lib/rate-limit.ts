import { NextResponse } from "next/server";

/**
 * Rate limiting.
 *
 * A fixed-window counter held in process memory.
 *
 * ── What this does and does not protect ────────────────────────────────────
 *
 * It stops one client hammering a route from a single instance — accidental
 * retry loops, a stuck poll, someone holding down a key. It does **not**
 * survive a restart and is **not** shared between instances, so a multi-replica
 * deployment gets N times the limit and a restart resets every counter.
 *
 * That is stated rather than glossed over: a limiter you believe is
 * distributed, but isn't, is worse than none. Behind more than one instance
 * this needs to move to Redis, and the interface here is deliberately the shape
 * that swap would take.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Stop the map growing without bound in a long-lived process. */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimit {
  /** Requests permitted per window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

/**
 * Limits per route class.
 *
 * Sign-in is the tightest: it is the only route where a wrong answer is
 * informative to an attacker, so brute force has to be expensive. Order
 * placement is generous enough for deliberate trading and a running strategy,
 * but not for a runaway loop.
 */
export const LIMITS = {
  signIn: { limit: 8, windowMs: 15 * 60_000 },
  signUp: { limit: 5, windowMs: 60 * 60_000 },
  /*
    Password reset.

    Requesting is tighter than signing in: each accepted request sends mail to
    somebody, so an unthrottled form is a way to flood a stranger's inbox from
    this app's sending domain. `password-reset.ts` adds a per-account cooldown
    on top, which — unlike this counter — survives a restart and applies across
    instances.

    Submitting is separate and looser. It is guessing a 256-bit token, which no
    rate limit meaningfully protects; the cap is there to stop the endpoint
    being used as free scrypt work.
  */
  passwordResetRequest: { limit: 5, windowMs: 60 * 60_000 },
  passwordResetSubmit: { limit: 10, windowMs: 15 * 60_000 },
  /*
    Verification email resends, and the OAuth round trip.

    `verificationResend` is a mail-sending route, so it is capped like the
    reset request. `oauthStart` is not sensitive in itself, but an unbounded
    redirect endpoint is a convenient open redirector to hammer, and the
    callback does real database work.
  */
  verificationResend: { limit: 5, windowMs: 60 * 60_000 },
  oauthStart: { limit: 20, windowMs: 15 * 60_000 },
  deposit: { limit: 20, windowMs: 60 * 60_000 },
  order: { limit: 60, windowMs: 60_000 },
  strategyRun: { limit: 120, windowMs: 60_000 },
  write: { limit: 60, windowMs: 60_000 },
  read: { limit: 300, windowMs: 60_000 },
} as const satisfies Record<string, RateLimit>;

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
}

export function checkRateLimit(key: string, rule: RateLimit, now = Date.now()): RateLimitResult {
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size > MAX_TRACKED_KEYS) sweep(now);
    windows.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, remaining: rule.limit - 1, resetAt: now + rule.windowMs };
  }

  existing.count += 1;

  return {
    allowed: existing.count <= rule.limit,
    remaining: Math.max(0, rule.limit - existing.count),
    resetAt: existing.resetAt,
  };
}

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/**
 * Identify the caller for limiting purposes.
 *
 * Prefers the authenticated user, so a shared IP (office, mobile carrier, NAT)
 * does not make one user's activity throttle everyone else's. Falls back to the
 * forwarded IP for unauthenticated routes like sign-in.
 */
export function rateLimitKey(request: Request, scope: string, userId?: string): string {
  if (userId) return `${scope}:user:${userId}`;

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  return `${scope}:ip:${ip}`;
}

/** Standard 429 with a Retry-After the client can actually use. */
export function tooManyRequests(result: RateLimitResult): NextResponse {
  const seconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));

  return NextResponse.json(
    {
      error: "rate_limited",
      message: `Too many requests. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
    },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}

/** Clears all counters. Test-only. */
export function resetRateLimits(): void {
  windows.clear();
}
