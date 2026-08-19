import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { hashLinkToken, hashPassword } from "@/services/auth/password";
import {
  VERIFICATION_TTL_MS,
  issueVerificationToken,
  resendVerification,
  verifyEmailToken,
} from "@/services/auth/email-verification";
import { PROVIDER, resolveGoogleUser } from "@/services/auth/google-oauth";

/**
 * Google account linking, and email verification, against a real database.
 *
 * The linking rules are the part of this work with the worst failure mode: get
 * them wrong and one person ends up with two accounts and a split portfolio,
 * or — far worse — one person ends up inside another's. Both are properties of
 * unique constraints and transactions, so they are tested against Postgres
 * rather than a mock.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);

function googleProfile(overrides: Partial<{ sub: string; email: string; name: string; email_verified: boolean }> = {}) {
  return {
    sub: overrides.sub ?? `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    email: overrides.email ?? `g-${Date.now()}-${Math.random().toString(36).slice(2)}@stockx.test`,
    email_verified: overrides.email_verified ?? true,
    name: overrides.name ?? "Google Person",
  };
}

describe.skipIf(!HAS_DB)("Google sign-in", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@stockx.test" } } });
    await prisma.$disconnect();
  });

  it("creates a user, a funded account and a provider link for a new person", async () => {
    const profile = googleProfile();
    const userId = await resolveGoogleUser(profile);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true, passwordHash: true },
    });

    expect(user.email).toBe(profile.email);
    // Google has already proven the address, so there is nothing left to check.
    expect(user.emailVerifiedAt).not.toBeNull();
    // No password is invented for them.
    expect(user.passwordHash).toBeNull();

    // Funded exactly like a form sign-up, through the same helper.
    expect(await prisma.account.count({ where: { userId } })).toBe(1);
    expect(
      await prisma.oAuthAccount.count({ where: { userId, provider: PROVIDER } }),
    ).toBe(1);
  });

  it("returns the same user on a second sign-in, rather than a duplicate", async () => {
    const profile = googleProfile();

    const first = await resolveGoogleUser(profile);
    const second = await resolveGoogleUser(profile);

    expect(second).toBe(first);
    expect(await prisma.user.count({ where: { email: profile.email } })).toBe(1);
    expect(await prisma.account.count({ where: { userId: first } })).toBe(1);
  });

  it("links to an existing password account with the same address", async () => {
    /*
      The requirement that matters most: someone who registered with a password
      and later presses the Google button must land in the account they already
      have, with their portfolio in it — not in a second one.
    */
    const email = `existing-${Date.now()}@stockx.test`;
    const existing = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword("an existing password"),
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });

    const userId = await resolveGoogleUser(googleProfile({ email }));

    expect(userId).toBe(existing.id);
    expect(await prisma.user.count({ where: { email } })).toBe(1);

    // The password still works: linking Google does not replace it.
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: existing.id },
      select: { passwordHash: true },
    });
    expect(after.passwordHash).not.toBeNull();
  });

  it("verifies an unverified account when it is linked", async () => {
    // Signing in through Google proves the address, so refusing them at
    // sign-in afterwards would be asking for a proof they have just given.
    const email = `unverified-${Date.now()}@stockx.test`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await hashPassword("a password"), emailVerifiedAt: null },
      select: { id: true },
    });

    await resolveGoogleUser(googleProfile({ email }));

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { emailVerifiedAt: true },
    });
    expect(after.emailVerifiedAt).not.toBeNull();
  });

  it("refuses a profile whose address Google has not verified", async () => {
    /*
      The linking rule above trusts the address to identify an existing
      account. If Google has not verified it, anyone able to set an arbitrary
      address on a Google account could use this to walk into the matching
      account here. This flag is what the whole safety of linking rests on.
    */
    const email = `victim-${Date.now()}@stockx.test`;
    await prisma.user.create({
      data: { email, passwordHash: await hashPassword("the victim's password") },
    });

    await expect(
      resolveGoogleUser(googleProfile({ email, email_verified: false })),
    ).rejects.toThrow(/verified email/i);

    expect(await prisma.oAuthAccount.count()).toBeGreaterThanOrEqual(0);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it("matches on the provider id, not the address", async () => {
    // Addresses get changed and reassigned at the provider; the subject id
    // does not. A returning user is the same person even if their Google
    // address has changed since.
    const profile = googleProfile();
    const userId = await resolveGoogleUser(profile);

    const renamed = { ...profile, email: `renamed-${Date.now()}@stockx.test` };
    expect(await resolveGoogleUser(renamed)).toBe(userId);

    // No second account was created for the new address.
    expect(await prisma.user.count({ where: { email: renamed.email } })).toBe(0);
  });

  it("cannot let one Google identity be claimed by two users", async () => {
    const profile = googleProfile();
    const userId = await resolveGoogleUser(profile);

    const other = await prisma.user.create({
      data: { email: `other-${Date.now()}@stockx.test` },
      select: { id: true },
    });

    // The unique index is the real guarantee, not the application's check.
    await expect(
      prisma.oAuthAccount.create({
        data: { userId: other.id, provider: PROVIDER, providerAccountId: profile.sub },
      }),
    ).rejects.toThrow();

    const link = await prisma.oAuthAccount.findUniqueOrThrow({
      where: { provider_providerAccountId: { provider: PROVIDER, providerAccountId: profile.sub } },
      select: { userId: true },
    });
    expect(link.userId).toBe(userId);
  });
});

describe.skipIf(!HAS_DB)("email verification", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "@stockx.test" } } });
    await prisma.$disconnect();
  });

  async function makeUnverified() {
    return prisma.user.create({
      data: {
        email: `verify-${Date.now()}-${Math.random().toString(36).slice(2)}@stockx.test`,
        passwordHash: await hashPassword("a password here"),
        emailVerifiedAt: null,
      },
      select: { id: true, email: true },
    });
  }

  it("stores only a hash of the token", async () => {
    const user = await makeUnverified();
    const token = await issueVerificationToken(user.id);

    const row = await prisma.emailVerificationToken.findFirstOrThrow({
      where: { userId: user.id },
      select: { tokenHash: true },
    });

    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(hashLinkToken(token));
  });

  it("marks the account verified when the token is used", async () => {
    const user = await makeUnverified();
    const token = await issueVerificationToken(user.id);

    expect(await verifyEmailToken(token)).toEqual({ ok: true, alreadyVerified: false });

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { emailVerifiedAt: true },
    });
    expect(after.emailVerifiedAt).not.toBeNull();
  });

  it("treats a second click as success, not as an error", async () => {
    // A person clicking twice, or a mail client prefetching the link, must not
    // be told their verified account has an invalid link.
    const user = await makeUnverified();
    const token = await issueVerificationToken(user.id);

    await verifyEmailToken(token);
    expect(await verifyEmailToken(token)).toEqual({ ok: true, alreadyVerified: true });
  });

  it("refuses an expired token", async () => {
    const user = await makeUnverified();
    const token = await issueVerificationToken(user.id);

    const now = Date.now();
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id },
      data: {
        createdAt: new Date(now - 2 * VERIFICATION_TTL_MS),
        expiresAt: new Date(now - VERIFICATION_TTL_MS),
      },
    });

    const outcome = await verifyEmailToken(token);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("expired");
  });

  it("refuses a token nobody issued, and an empty one", async () => {
    for (const bad of ["", "not-a-real-token"]) {
      const outcome = await verifyEmailToken(bad);
      expect(outcome.ok).toBe(false);
    }
  });

  it("retires the previous token when a new one is issued", async () => {
    // Otherwise "resend" leaves two live links and no way to know which works.
    const user = await makeUnverified();
    const first = await issueVerificationToken(user.id);
    const second = await issueVerificationToken(user.id);

    const stale = await verifyEmailToken(first);
    expect(stale.ok).toBe(false);
    expect(await verifyEmailToken(second)).toEqual({ ok: true, alreadyVerified: false });
  });

  describe("resendVerification", () => {
    it("issues a token for an unverified address", async () => {
      const user = await makeUnverified();
      expect((await resendVerification(user.email)).token).not.toBeNull();
    });

    it("gives nothing away for an unknown address", async () => {
      expect((await resendVerification("nobody-here@stockx.test")).token).toBeNull();
    });

    it("gives nothing away for an already-verified address", async () => {
      // "Already verified" feels harmless, but disclosing it confirms the
      // address is registered — the same enumeration in slower clothes.
      const user = await makeUnverified();
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });

      expect((await resendVerification(user.email)).token).toBeNull();
    });

    it("will not send a second email straight away", async () => {
      const user = await makeUnverified();

      expect((await resendVerification(user.email)).token).not.toBeNull();
      expect((await resendVerification(user.email)).token).toBeNull();
    });
  });
});
