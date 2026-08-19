import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  OTP_LENGTH,
  createOtpCode,
  hashOtpCode,
  hashPassword,
  verifyPassword,
} from "@/services/auth/password";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  prunePasswordResetOtps,
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  verifyPasswordResetOtp,
} from "@/services/auth/password-reset";

/**
 * Password reset by one-time code, against a real database.
 *
 * Run against Postgres rather than a mock because the properties that matter —
 * a code can be spent once, guesses are capped, and spending it and writing
 * the password either both happen or neither does — are enforced by
 * constraints and transactions. A mocked Prisma client would agree happily
 * with a broken implementation of all three.
 *
 * ── The invariant behind every test here ───────────────────────────────────
 *
 * Six digits is only twenty bits. It is safe *because* of the expiry, the
 * attempt cap and the per-account scoping, so each of those is tested as a
 * security property rather than as a nicety.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);

const ORIGINAL_PASSWORD = "original correct horse";
const NEW_PASSWORD = "a brand new passphrase";

let email = "";
let userId = "";

async function makeUser(): Promise<{ id: string; email: string }> {
  const address = `otp-${Date.now()}-${Math.random().toString(36).slice(2)}@stockx.test`;
  return prisma.user.create({
    data: {
      email: address,
      passwordHash: await hashPassword(ORIGINAL_PASSWORD),
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true },
  });
}

/** Issue a code directly, so tests can hold the plaintext the email would carry. */
async function issueCode(
  forUserId = userId,
  overrides: { expired?: boolean; code?: string } = {},
) {
  const code = overrides.code ?? createOtpCode();
  const now = Date.now();

  await prisma.passwordResetOtp.create({
    data: {
      userId: forUserId,
      codeHash: hashOtpCode(forUserId, code),
      // An expired row is backdated wholesale: the table's CHECK requires the
      // expiry to fall after creation, as a real row always does.
      ...(overrides.expired
        ? {
            createdAt: new Date(now - 2 * OTP_TTL_MS),
            expiresAt: new Date(now - OTP_TTL_MS),
          }
        : { expiresAt: new Date(now + OTP_TTL_MS) }),
    },
  });

  return code;
}

/** A code guaranteed to differ from the one given. */
function wrongCode(actual: string): string {
  const shifted = (Number(actual) + 1) % 10 ** OTP_LENGTH;
  return String(shifted).padStart(OTP_LENGTH, "0");
}

describe.skipIf(!HAS_DB)("password reset by one-time code", () => {
  beforeEach(async () => {
    const user = await makeUser();
    userId = user.id;
    email = user.email;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@stockx.test" } } });
    await prisma.$disconnect();
  });

  // --- the code itself ----------------------------------------------------

  describe("code generation", () => {
    it("is six digits, zero-padded", () => {
      for (let i = 0; i < 200; i += 1) {
        expect(createOtpCode()).toMatch(/^\d{6}$/);
      }
    });

    it("is not predictable", () => {
      // 500 draws from a million values: a generator with any real structure
      // (a counter, a timestamp, a seeded PRNG) shows up as repeats here.
      const codes = new Set(Array.from({ length: 500 }, () => createOtpCode()));
      expect(codes.size).toBeGreaterThan(495);
    });

    it("is uniform across the range rather than clustered", () => {
      /*
        The rejection sampling exists to avoid modulo bias. With 6000 draws
        each decade of the range should hold roughly 600; a biased generator
        skews the low decades. Generous bounds — this is a smoke test for
        structural bias, not a statistics exam.
      */
      const buckets = new Array<number>(10).fill(0);
      for (let i = 0; i < 6_000; i += 1) {
        buckets[Math.floor(Number(createOtpCode()) / 100_000)]! += 1;
      }
      for (const count of buckets) {
        expect(count).toBeGreaterThan(450);
        expect(count).toBeLessThan(750);
      }
    });

    it("hashes differently for two users holding the same code", () => {
      // The hash is bound to the user id, so a stolen database cannot be
      // reversed with one precomputed table of a million digests.
      expect(hashOtpCode("user-a", "123456")).not.toBe(hashOtpCode("user-b", "123456"));
    });
  });

  it("never writes the code itself to the database", async () => {
    const { code } = await requestPasswordResetOtp(email);
    expect(code).not.toBeNull();

    const rows = await prisma.passwordResetOtp.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.codeHash).not.toBe(code);
    expect(rows[0]!.codeHash).toBe(hashOtpCode(userId, code!));
  });

  // --- requesting ---------------------------------------------------------

  describe("requestPasswordResetOtp", () => {
    it("issues a code for a known address", async () => {
      expect((await requestPasswordResetOtp(email)).code).toMatch(/^\d{6}$/);
    });

    it("returns the same shape for an unknown address, and writes nothing", async () => {
      const before = await prisma.passwordResetOtp.count();
      const result = await requestPasswordResetOtp("nobody-here@stockx.test");

      expect(result.code).toBeNull();
      expect(await prisma.passwordResetOtp.count()).toBe(before);
    });

    it("issues nothing for an account with no password, such as a Google-only one", async () => {
      const google = await prisma.user.create({
        data: { email: `google-${Date.now()}@stockx.test`, emailVerifiedAt: new Date() },
        select: { email: true },
      });

      expect((await requestPasswordResetOtp(google.email)).code).toBeNull();
    });

    it("will not send a second code straight away", async () => {
      expect((await requestPasswordResetOtp(email)).code).not.toBeNull();
      expect((await requestPasswordResetOtp(email)).code).toBeNull();
    });

    it("retires the previous code when a new one is issued", async () => {
      const first = await issueCode();
      // Bypass the cooldown by ageing the row, as a minute passing would.
      await prisma.passwordResetOtp.updateMany({
        where: { userId },
        data: { createdAt: new Date(Date.now() - 5 * 60_000) },
      });

      const second = await requestPasswordResetOtp(email);
      expect(second.code).not.toBeNull();

      // Two live codes would double an attacker's guessing budget for free.
      const old = await verifyPasswordResetOtp(email, first);
      expect(old.ok).toBe(false);
    });
  });

  // --- verifying ----------------------------------------------------------

  describe("verifyPasswordResetOtp", () => {
    it("accepts the current code without spending it", async () => {
      const code = await issueCode();

      expect((await verifyPasswordResetOtp(email, code)).ok).toBe(true);
      // Still usable: the user has a password to choose next.
      expect((await verifyPasswordResetOtp(email, code)).ok).toBe(true);
    });

    it("rejects a wrong code", async () => {
      const code = await issueCode();
      const outcome = await verifyPasswordResetOtp(email, wrongCode(code));

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("invalid");
    });

    it("rejects an expired code", async () => {
      const code = await issueCode(userId, { expired: true });
      const outcome = await verifyPasswordResetOtp(email, code);

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("expired");
    });

    it("rejects a code belonging to a different account", async () => {
      // Codes are scoped to a user, so a code seen elsewhere is worthless here
      // even while it is live.
      const other = await makeUser();
      const theirs = await issueCode(other.id);
      await issueCode();

      const outcome = await verifyPasswordResetOtp(email, theirs);
      expect(outcome.ok).toBe(false);
    });

    it("says nothing different for an address with no reset in progress", async () => {
      const noReset = await makeUser();
      const outcome = await verifyPasswordResetOtp(noReset.email, "123456");

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("invalid");
    });

    it("rejects non-numeric input without touching the attempt budget", async () => {
      const code = await issueCode();
      await verifyPasswordResetOtp(email, "abcdef");

      const row = await prisma.passwordResetOtp.findFirstOrThrow({ where: { userId } });
      expect(row.attempts).toBe(0);
      expect((await verifyPasswordResetOtp(email, code)).ok).toBe(true);
    });
  });

  // --- the attempt cap ----------------------------------------------------

  describe("attempt limiting", () => {
    it("counts wrong guesses", async () => {
      const code = await issueCode();

      await verifyPasswordResetOtp(email, wrongCode(code));
      await verifyPasswordResetOtp(email, wrongCode(code));

      const row = await prisma.passwordResetOtp.findFirstOrThrow({ where: { userId } });
      expect(row.attempts).toBe(2);
    });

    it("burns the code at the cap, so the correct one stops working too", async () => {
      /*
        The property that makes six digits defensible. Without it, a million
        guesses beats the code every time; with it, an attacker gets five and
        then needs the mailbox they cannot read.
      */
      const code = await issueCode();

      for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
        await verifyPasswordResetOtp(email, wrongCode(code));
      }

      // The correct code no longer works, and the message says why — running
      // out of guesses is a different problem from mistyping, and only one of
      // them is fixed by looking at the email again.
      const outcome = await verifyPasswordResetOtp(email, code);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("too-many-attempts");

      // And it cannot be used to reset either.
      const reset = await resetPasswordWithOtp(email, code, NEW_PASSWORD);
      expect(reset.ok).toBe(false);
    });

    it("cannot be sidestepped by guessing through the reset endpoint", async () => {
      // Both endpoints share one counter, so mixing them buys nothing.
      const code = await issueCode();

      for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
        await resetPasswordWithOtp(email, wrongCode(code), NEW_PASSWORD);
      }

      const outcome = await verifyPasswordResetOtp(email, code);
      expect(outcome.ok).toBe(false);
    });
  });

  // --- resetting ----------------------------------------------------------

  describe("resetPasswordWithOtp", () => {
    it("changes the password to one the sign-in path accepts", async () => {
      const code = await issueCode();
      expect(await resetPasswordWithOtp(email, code, NEW_PASSWORD)).toEqual({ ok: true });

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true },
      });

      await expect(verifyPassword(NEW_PASSWORD, user.passwordHash!)).resolves.toBe(true);
      await expect(verifyPassword(ORIGINAL_PASSWORD, user.passwordHash!)).resolves.toBe(false);
    });

    it("stores the new password with the same scheme as sign-up", async () => {
      const code = await issueCode();
      await resetPasswordWithOtp(email, code, NEW_PASSWORD);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true },
      });

      expect(user.passwordHash).toMatch(/^scrypt\$/);
      expect(user.passwordHash).not.toContain(NEW_PASSWORD);
    });

    it("refuses the same code a second time", async () => {
      const code = await issueCode();
      await resetPasswordWithOtp(email, code, NEW_PASSWORD);

      const replay = await resetPasswordWithOtp(email, code, "yet another password");
      expect(replay.ok).toBe(false);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true },
      });
      await expect(verifyPassword(NEW_PASSWORD, user.passwordHash!)).resolves.toBe(true);
    });

    it("enforces the password policy server-side without spending the code", async () => {
      const code = await issueCode();
      const outcome = await resetPasswordWithOtp(email, code, "short");

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("weak");

      // A typo in the password must not cost the user their code.
      expect((await verifyPasswordResetOtp(email, code)).ok).toBe(true);
    });

    it("refuses an expired code", async () => {
      const code = await issueCode(userId, { expired: true });
      const outcome = await resetPasswordWithOtp(email, code, NEW_PASSWORD);

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("expired");
    });

    it("signs the user out everywhere", async () => {
      await prisma.session.create({
        data: {
          userId,
          tokenHash: `session-${Date.now()}-${Math.random()}`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const code = await issueCode();
      await resetPasswordWithOtp(email, code, NEW_PASSWORD);

      expect(await prisma.session.count({ where: { userId } })).toBe(0);
    });

    it("marks the address verified, since the code proved the mailbox", async () => {
      await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: null } });

      const code = await issueCode();
      await resetPasswordWithOtp(email, code, NEW_PASSWORD);

      // Otherwise someone could complete a reset and still be refused sign-in
      // for not having proved the very thing they just proved.
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { emailVerifiedAt: true },
      });
      expect(user.emailVerifiedAt).not.toBeNull();
    });

    it("changes nothing when the code is wrong", async () => {
      const code = await issueCode();
      const before = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true },
      });

      await resetPasswordWithOtp(email, wrongCode(code), NEW_PASSWORD);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true },
      });
      expect(after.passwordHash).toBe(before.passwordHash);
    });

    it("lets exactly one of two simultaneous submissions win", async () => {
      const code = await issueCode();

      const [a, b] = await Promise.all([
        resetPasswordWithOtp(email, code, NEW_PASSWORD),
        resetPasswordWithOtp(email, code, NEW_PASSWORD),
      ]);

      // The loser must not report success: it wrote nothing, and the winner's
      // password is the one now stored.
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    });
  });

  describe("prunePasswordResetOtps", () => {
    it("removes spent and expired rows, and leaves live ones", async () => {
      const live = await issueCode();
      await issueCode(userId, { expired: true });

      await prunePasswordResetOtps();

      const remaining = await prisma.passwordResetOtp.findMany({ where: { userId } });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.codeHash).toBe(hashOtpCode(userId, live));
    });
  });
});
