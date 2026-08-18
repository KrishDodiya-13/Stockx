import { beforeEach, describe, expect, it } from "vitest";

import {
  LIMITS,
  checkRateLimit,
  rateLimitKey,
  resetRateLimits,
  type RateLimit,
} from "@/app/api/_lib/rate-limit";

const RULE: RateLimit = { limit: 3, windowMs: 1_000 };

beforeEach(() => {
  resetRateLimits();
});

describe("checkRateLimit", () => {
  it("allows requests up to the limit and refuses the next one", () => {
    const now = 1_000_000;

    expect(checkRateLimit("k", RULE, now).allowed).toBe(true);
    expect(checkRateLimit("k", RULE, now).allowed).toBe(true);
    expect(checkRateLimit("k", RULE, now).allowed).toBe(true);
    expect(checkRateLimit("k", RULE, now).allowed).toBe(false);
  });

  it("counts down the remaining allowance", () => {
    const now = 1_000_000;

    expect(checkRateLimit("k", RULE, now).remaining).toBe(2);
    expect(checkRateLimit("k", RULE, now).remaining).toBe(1);
    expect(checkRateLimit("k", RULE, now).remaining).toBe(0);
  });

  it("never reports negative remaining once over the limit", () => {
    const now = 1_000_000;
    for (let i = 0; i < 10; i += 1) checkRateLimit("k", RULE, now);

    expect(checkRateLimit("k", RULE, now).remaining).toBe(0);
  });

  it("keeps separate counters per key", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) checkRateLimit("a", RULE, now);

    // One caller exhausting their allowance must not throttle anyone else.
    expect(checkRateLimit("a", RULE, now).allowed).toBe(false);
    expect(checkRateLimit("b", RULE, now).allowed).toBe(true);
  });

  it("opens a fresh window once the old one has passed", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) checkRateLimit("k", RULE, now);
    expect(checkRateLimit("k", RULE, now).allowed).toBe(false);

    // Still inside the window at the last millisecond.
    expect(checkRateLimit("k", RULE, now + 999).allowed).toBe(false);

    // And released once it elapses.
    expect(checkRateLimit("k", RULE, now + 1_000).allowed).toBe(true);
  });

  it("reports a reset time in the future while blocking", () => {
    const now = 1_000_000;
    for (let i = 0; i < 4; i += 1) checkRateLimit("k", RULE, now);

    expect(checkRateLimit("k", RULE, now).resetAt).toBe(now + 1_000);
  });
});

describe("rateLimitKey", () => {
  function request(headers: Record<string, string> = {}): Request {
    return new Request("https://example.test/api/orders", { headers });
  }

  it("keys on the user when there is one", () => {
    const key = rateLimitKey(request({ "x-forwarded-for": "10.0.0.1" }), "order", "user-1");
    expect(key).toBe("order:user:user-1");
  });

  it("keys on the client IP when there is not", () => {
    // Sign-in has no user yet, so the IP is all there is.
    const key = rateLimitKey(request({ "x-forwarded-for": "10.0.0.1" }), "signin");
    expect(key).toBe("signin:ip:10.0.0.1");
  });

  it("takes the first hop of a forwarded chain", () => {
    const key = rateLimitKey(
      request({ "x-forwarded-for": "10.0.0.1, 70.41.3.18, 150.172.238.178" }),
      "signin",
    );
    expect(key).toBe("signin:ip:10.0.0.1");
  });

  it("still produces a key when the IP is unknown", () => {
    expect(rateLimitKey(request(), "signin")).toBe("signin:ip:unknown");
  });

  it("separates scopes, so exhausting one route does not block another", () => {
    const a = rateLimitKey(request(), "order", "user-1");
    const b = rateLimitKey(request(), "strategy-run", "user-1");
    expect(a).not.toBe(b);
  });
});

describe("configured limits", () => {
  it("makes sign-in the tightest window", () => {
    // Brute force must be expensive; ordinary trading must not be.
    const signInPerMinute = LIMITS.signIn.limit / (LIMITS.signIn.windowMs / 60_000);
    const orderPerMinute = LIMITS.order.limit / (LIMITS.order.windowMs / 60_000);

    expect(signInPerMinute).toBeLessThan(orderPerMinute);
  });

  it("leaves room for a live strategy to keep polling", () => {
    // The runner polls roughly once a second while a strategy is active.
    expect(LIMITS.strategyRun.limit / (LIMITS.strategyRun.windowMs / 60_000)).toBeGreaterThanOrEqual(60);
  });

  it("gives every rule a positive limit and window", () => {
    for (const [name, rule] of Object.entries(LIMITS)) {
      expect(rule.limit, name).toBeGreaterThan(0);
      expect(rule.windowMs, name).toBeGreaterThan(0);
    }
  });
});
