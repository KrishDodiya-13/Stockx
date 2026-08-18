import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UPSTOX_STATE_COOKIE,
  createOAuthState,
  isValidOAuthState,
} from "@/services/market-data/providers/upstox/oauth-state";
import {
  clearUpstoxAccessToken,
  getUpstoxAccessToken,
  setUpstoxAccessToken,
} from "@/services/market-data/providers/upstox/token-store";

/**
 * The two ways the Upstox credential could be taken or misused.
 *
 * Both were live defects: the callback accepted any `code` it was handed, and
 * an expired token was served forever because the expiry was recorded and then
 * never read.
 */

describe("OAuth state", () => {
  it("mints a value long enough not to be guessable", () => {
    // 32 random bytes, base64url — no padding, URL-safe.
    const state = createOAuthState();
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never mints the same value twice", () => {
    const seen = new Set(Array.from({ length: 200 }, () => createOAuthState()));
    expect(seen.size).toBe(200);
  });

  it("accepts a callback that echoes the state it was sent", () => {
    const state = createOAuthState();
    expect(isValidOAuthState(state, state)).toBe(true);
  });

  it("rejects a forged callback", () => {
    // The attack the state parameter exists to stop: someone else's code,
    // delivered to our callback, replacing this server's vendor credential.
    expect(isValidOAuthState(createOAuthState(), createOAuthState())).toBe(false);
  });

  it("rejects a callback with no state at all", () => {
    const state = createOAuthState();
    expect(isValidOAuthState(undefined, state)).toBe(false);
    expect(isValidOAuthState("", state)).toBe(false);
  });

  it("rejects when no flow was started on this server", () => {
    expect(isValidOAuthState(createOAuthState(), undefined)).toBe(false);
    expect(isValidOAuthState(undefined, undefined)).toBe(false);
  });

  it("rejects a prefix of the expected value", () => {
    // A length mismatch must fail closed rather than throw out of
    // `timingSafeEqual`, which is what an unguarded comparison would do.
    const state = createOAuthState();
    expect(isValidOAuthState(state.slice(0, -1), state)).toBe(false);
    expect(isValidOAuthState(state + "x", state)).toBe(false);
  });

  it("names the cookie it stores the state in", () => {
    expect(UPSTOX_STATE_COOKIE).toBe("upstox_oauth_state");
  });
});

describe("the Upstox token store", () => {
  afterEach(() => {
    clearUpstoxAccessToken();
    vi.useRealTimers();
  });

  it("returns a token that is still valid", () => {
    setUpstoxAccessToken("token-abc", Date.now() + 60_000);
    expect(getUpstoxAccessToken()).toBe("token-abc");
  });

  it("treats an expired token as absent", () => {
    /*
      The expiry used to be stored and never consulted, so a dead token was
      handed to every request — Upstox answered 401, and the cookie fallback
      that might have worked was never reached.
    */
    setUpstoxAccessToken("token-abc", Date.now() - 1);
    expect(getUpstoxAccessToken()).toBeNull();
  });

  it("expires a token as the clock passes its deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T04:00:00Z"));

    setUpstoxAccessToken("token-abc", Date.now() + 60_000);
    expect(getUpstoxAccessToken()).toBe("token-abc");

    vi.advanceTimersByTime(60_001);
    expect(getUpstoxAccessToken()).toBeNull();
  });

  it("keeps a token with no recorded expiry", () => {
    // A manually set token carries no deadline; absent is not the same as past.
    setUpstoxAccessToken("token-abc", null);
    expect(getUpstoxAccessToken()).toBe("token-abc");
  });

  it("clears on request", () => {
    setUpstoxAccessToken("token-abc", Date.now() + 60_000);
    clearUpstoxAccessToken();
    expect(getUpstoxAccessToken()).toBeNull();
  });
});
