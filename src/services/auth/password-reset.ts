import "server-only";

/**
 * Password reset, by one-time code.
 *
 * ── Why a code rather than a link ──────────────────────────────────────────
 *
 * A link carries a 256-bit secret and needs no guess limit; a six-digit code
 * carries about 20 bits and is only safe because three things hold together:
 * it expires in ten minutes, it dies after a small number of wrong guesses,
 * and it is scoped to one account so an attacker gets a few tries at a chosen
 * target rather than unlimited tries across everyone. All three are enforced
 * below. Remove any one and six digits would be indefensible.
 *
 * ── The rules this module keeps ────────────────────────────────────────────
 *
 * 1. A caller learns nothing about whether an address is registered.
 *    `requestPasswordResetOtp` returns the same shape either way.
 * 2. A code is single-use, time-limited and attempt-limited, enforced in the
 *    database rather than by statement order.
 * 3. Issuing a new code kills the previous one, so a forwarded or shoulder-
 *    surfed code stops working the moment the user asks for another.
 * 4. The code is never stored, never logged, and never returned to anyone but
 *    the mailer.
 *
 * Server-only.
 */

import { prisma } from "@/lib/prisma";
import {
  createOtpCode,
  digestsMatch,
  hashOtpCode,
  hashPassword,
  validatePassword,
} from "@/services/auth/password";

/**
 * How long a code lives.
 *
 * Ten minutes. Short, because a six-digit secret sitting in an inbox is worth
 * far less time than a 256-bit one, and because the flow is meant to be
 * completed in one sitting with the email open beside it.
 */
export const OTP_TTL_MS = 10 * 60 * 1000;

/** The wording used in the email, kept beside the TTL so they cannot drift. */
export const OTP_TTL_LABEL = "10 minutes";

/**
 * Wrong guesses allowed before the code is burned.
 *
 * Five. Enough to survive a typo and a misread digit; far short of making a
 * million-value space worth attacking, since a burned code forces the attacker
 * back through the email they cannot read.
 */
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Minimum spacing between codes for one account.
 *
 * The IP rate limiter is per-process and resets on restart; this cooldown
 * lives in the database, so it holds across instances and restarts. Its real
 * job is to stop the form being used to mailbomb someone whose address is
 * known.
 */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

export interface OtpRequest {
  /**
   * The code, to be emailed. Null when no email should be sent — no such user,
   * an account with no password, or a code issued moments ago.
   *
   * The route must not vary its response on this. It exists so the route knows
   * whether to call the mailer, not so it can report what happened.
   */
  readonly code: string | null;
  readonly email: string;
}

/**
 * Issue a reset code.
 *
 * Always resolves. An unknown address is not an error and not a distinguishable
 * outcome — it simply produces no code.
 */
export async function requestPasswordResetOtp(email: string): Promise<OtpRequest> {
  const normalised = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalised },
    select: { id: true, passwordHash: true },
  });

  // No user, or an account with no password to reset (a Google-only account,
  // or a pre-auth row). Both produce silence rather than a different answer.
  if (!user || !user.passwordHash) return { code: null, email: normalised };

  const recent = await prisma.passwordResetOtp.findFirst({
    where: {
      userId: user.id,
      usedAt: null,
      createdAt: { gt: new Date(Date.now() - OTP_RESEND_COOLDOWN_MS) },
    },
    select: { id: true },
  });

  if (recent) return { code: null, email: normalised };

  const code = createOtpCode();

  /*
    Issuing a new code retires every older one, in the same transaction that
    creates it. Two live codes for one account would double an attacker's
    guessing budget for free, and would make "I requested a new one" fail to
    mean what the user expects it to mean.
  */
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetOtp.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await tx.passwordResetOtp.create({
      data: {
        userId: user.id,
        codeHash: hashOtpCode(user.id, code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
  });

  return { code, email: normalised };
}

export type OtpFailure = "invalid" | "expired" | "used" | "too-many-attempts";

export type OtpCheck =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly reason: OtpFailure; readonly message: string };

/**
 * One message for every way a code can fail to be the right one.
 *
 * A distinct message for "no code outstanding" versus "wrong digits" would
 * tell a stranger whether the address they typed has a reset in progress —
 * which is a slower version of the enumeration the generic response prevents.
 */
const INVALID_MESSAGE = "That code is not correct. Check the email and try again.";

/**
 * Check a code, counting the attempt.
 *
 * `spend` decides whether a correct code is consumed. The verify step passes
 * false, because the user still has a password to choose and burning the code
 * there would strand them; the reset step passes true.
 *
 * A wrong guess is recorded whether or not the caller intends to spend it, so
 * the attempt budget cannot be sidestepped by only ever calling the step that
 * does not consume.
 */
async function checkOtp(email: string, code: string, spend: boolean): Promise<OtpCheck> {
  const normalised = email.trim().toLowerCase();

  if (!/^\d+$/.test(code)) {
    return { ok: false, reason: "invalid", message: INVALID_MESSAGE };
  }

  const user = await prisma.user.findUnique({
    where: { email: normalised },
    select: { id: true },
  });
  if (!user) return { ok: false, reason: "invalid", message: INVALID_MESSAGE };

  const record = await prisma.passwordResetOtp.findFirst({
    where: { userId: user.id, usedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, expiresAt: true, attempts: true },
  });

  if (!record) return { ok: false, reason: "invalid", message: INVALID_MESSAGE };

  if (record.expiresAt.getTime() <= Date.now()) {
    return {
      ok: false,
      reason: "expired",
      message: "That code has expired. Request a new one.",
    };
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    return {
      ok: false,
      reason: "too-many-attempts",
      message: "Too many incorrect attempts. Request a new code.",
    };
  }

  // Compared as digests, in constant time. Comparing the codes themselves with
  // `===` would leak how many leading digits were right, one guess at a time.
  if (!digestsMatch(record.codeHash, hashOtpCode(user.id, code))) {
    const spent = await prisma.passwordResetOtp.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });

    /*
      At the cap the code is dead, but the row is left unspent on purpose.

      Marking it used would be equally safe — the check above refuses it before
      any comparison either way — but it would make the *next* attempt look
      like "no reset in progress", and the user would be told the code is
      wrong when the truth is that they have run out of guesses. Keeping the
      row lets the message say the one useful thing: request a new code.
    */
    if (spent.attempts >= OTP_MAX_ATTEMPTS) {
      return {
        ok: false,
        reason: "too-many-attempts",
        message: "Too many incorrect attempts. Request a new code.",
      };
    }

    return { ok: false, reason: "invalid", message: INVALID_MESSAGE };
  }

  if (spend) {
    /*
      Conditional on the row still being unspent. Two submissions arriving
      together both reach here; only one can match a row with `usedAt` null,
      and the loser is told the code is used rather than being allowed to
      write a password the winner has already replaced.
    */
    const claimed = await prisma.passwordResetOtp.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (claimed.count === 0) {
      return {
        ok: false,
        reason: "used",
        message: "That code has already been used. Request a new one.",
      };
    }
  }

  return { ok: true, userId: user.id };
}

/**
 * Verify a code without consuming it.
 *
 * The middle step of the flow: it tells the page whether to show the
 * new-password fields, and costs the user an attempt if they mistype.
 */
export function verifyPasswordResetOtp(email: string, code: string): Promise<OtpCheck> {
  return checkOtp(email, code, false);
}

export type ResetOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: OtpFailure | "weak"; readonly message: string };

/**
 * Complete the reset: check the code, spend it, write the password.
 *
 * The password is validated *before* the code is spent, so a password the
 * server refuses does not cost the user their code — they can correct it and
 * submit again with the same one.
 */
export async function resetPasswordWithOtp(
  email: string,
  code: string,
  newPassword: string,
): Promise<ResetOutcome> {
  const strength = validatePassword(newPassword);
  if (!strength.ok) {
    return {
      ok: false,
      reason: "weak",
      message: strength.message ?? "That password is not strong enough.",
    };
  }

  const check = await checkOtp(email, code, true);
  if (!check.ok) return check;

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: check.userId },
      data: {
        passwordHash,
        /*
          Completing a reset proves control of the mailbox, which is the same
          thing email verification proves. An account that was never verified
          therefore becomes verified here — otherwise someone could reset their
          password successfully and still be refused at sign-in.
        */
        emailVerifiedAt: new Date(),
      },
    });

    // Any other code outstanding for this user dies with it.
    await tx.passwordResetOtp.updateMany({
      where: { userId: check.userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    /*
      Sign out everywhere.

      A reset is what someone does when they believe their account is
      compromised, so leaving the intruder's session valid would defeat it.
      This is also why no session is issued here: the user signs in again with
      the password they just chose, through the ordinary form.
    */
    await tx.session.deleteMany({ where: { userId: check.userId } });
  });

  return { ok: true };
}

/** Remove spent and expired codes. Safe to call opportunistically. */
export async function prunePasswordResetOtps(): Promise<void> {
  await prisma.passwordResetOtp.deleteMany({
    where: { OR: [{ expiresAt: { lte: new Date() } }, { usedAt: { not: null } }] },
  });
}
