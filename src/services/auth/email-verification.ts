import "server-only";

/**
 * Email verification.
 *
 * A signup writes a user and an unverified address; this issues the link that
 * proves the address belongs to whoever registered it, and marks the account
 * verified when that link is opened.
 *
 * Built on the same primitives as everything else in this directory: a random
 * 256-bit token, stored only as a SHA-256 digest, expiring and single-use.
 *
 * ── What "unverified" costs the account ────────────────────────────────────
 *
 * Sign-in refuses it. That is the only consequence, and it is deliberate: the
 * account, its opening balance and its ledger row are all created at signup as
 * before, so nothing about the trading engine has to know this feature exists.
 *
 * Server-only.
 */

import { prisma } from "@/lib/prisma";
import { createLinkToken, hashLinkToken } from "@/services/auth/password";

/**
 * How long a verification link lives.
 *
 * A day. Much longer than a reset code, because the cost of it expiring is
 * only an inconvenience — the user asks for another — and people sign up in
 * the evening and read their email in the morning.
 */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export const VERIFICATION_TTL_LABEL = "24 hours";

/**
 * Minimum spacing between verification emails for one account.
 *
 * The same reasoning as the reset cooldown: a limit that survives a restart
 * and applies across instances, so the resend button cannot be used to
 * mailbomb an address.
 */
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Issue a verification token for a user.
 *
 * Returns the raw token for the mailer. Retires any outstanding token first,
 * so the newest email is the one that works — otherwise a user who clicked
 * "resend" would have two live links and no way to know which to use.
 */
export async function issueVerificationToken(userId: string): Promise<string> {
  const token = createLinkToken();

  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    await tx.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashLinkToken(token),
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
      },
    });
  });

  return token;
}

export interface ResendRequest {
  /**
   * The token to email, or null when nothing should be sent — no such user,
   * already verified, or asked again within the cooldown.
   *
   * As with password reset, the route must not vary its response on this.
   */
  readonly token: string | null;
  readonly email: string;
}

/**
 * Re-issue a verification email on request.
 *
 * Always resolves, and gives the caller nothing it could use to tell a
 * registered address from an unregistered one — including the "already
 * verified" case, which would otherwise confirm an account exists.
 */
export async function resendVerification(email: string): Promise<ResendRequest> {
  const normalised = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalised },
    select: { id: true, emailVerifiedAt: true },
  });

  if (!user || user.emailVerifiedAt) return { token: null, email: normalised };

  const recent = await prisma.emailVerificationToken.findFirst({
    where: {
      userId: user.id,
      usedAt: null,
      createdAt: { gt: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS) },
    },
    select: { id: true },
  });

  if (recent) return { token: null, email: normalised };

  return { token: await issueVerificationToken(user.id), email: normalised };
}

export type VerificationOutcome =
  | { readonly ok: true; readonly alreadyVerified: boolean }
  | { readonly ok: false; readonly reason: "invalid" | "expired"; readonly message: string };

/**
 * Verify an address from a token.
 *
 * A token that has already been spent, but whose user is verified, reports
 * success rather than failure: the person clicked their link twice, or a mail
 * client prefetched it, and telling them "invalid link" for an account that is
 * demonstrably verified would send them to support over nothing.
 */
export async function verifyEmailToken(token: string): Promise<VerificationOutcome> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "invalid", message: INVALID_MESSAGE };
  }

  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashLinkToken(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { emailVerifiedAt: true } },
    },
  });

  if (!record) return { ok: false, reason: "invalid", message: INVALID_MESSAGE };

  if (record.usedAt !== null) {
    return record.user.emailVerifiedAt
      ? { ok: true, alreadyVerified: true }
      : { ok: false, reason: "invalid", message: INVALID_MESSAGE };
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return {
      ok: false,
      reason: "expired",
      message: "That verification link has expired. Request a new one below.",
    };
  }

  await prisma.$transaction(async (tx) => {
    /*
      Spend the token conditionally, as the reset flow does. Two clicks
      arriving together — a person and their mail client's link prefetcher —
      both pass the checks above, and only one may do the work.
    */
    const spent = await tx.emailVerificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (spent.count === 0) return;

    await tx.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
  });

  return { ok: true, alreadyVerified: false };
}

const INVALID_MESSAGE =
  "That verification link is not valid. Request a new one below.";

/** Remove spent and expired tokens. Safe to call opportunistically. */
export async function pruneVerificationTokens(): Promise<void> {
  await prisma.emailVerificationToken.deleteMany({
    where: { OR: [{ expiresAt: { lte: new Date() } }, { usedAt: { not: null } }] },
  });
}
