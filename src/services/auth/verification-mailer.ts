import "server-only";

/**
 * Issue a verification token and mail it.
 *
 * Split out from both callers — sign-up and the resend route — because they
 * need identical behaviour and identical failure handling, and because it
 * keeps `route.ts` free of the URL construction.
 *
 * ── Failure never propagates ───────────────────────────────────────────────
 *
 * A mail provider outage must not turn a successful sign-up into a 500: the
 * account exists, the money is in it, and the user can ask for another email.
 * Throwing here would roll the user back into thinking registration failed
 * when it did not.
 */

import { serverEnv } from "@/config/env";
import {
  VERIFICATION_TTL_LABEL,
  issueVerificationToken,
} from "@/services/auth/email-verification";
import { buildVerificationEmail } from "@/services/email/email-verification-email";
import { sendEmail } from "@/services/email/send-email";

/** Build the absolute link for a token. Origin from config, never from `Host`. */
export function verificationUrl(token: string): string {
  return `${serverEnv.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
}

/** Issue a fresh token for this user and send it. Never throws. */
export async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  try {
    const token = await issueVerificationToken(userId);

    await sendEmail(
      buildVerificationEmail({
        to: email,
        verifyUrl: verificationUrl(token),
        expiresInLabel: VERIFICATION_TTL_LABEL,
      }),
    );
  } catch (error) {
    // Logged without the address and without the token.
    console.error("[auth] verification email could not be sent", error);
  }
}

/** Mail an already-issued token. Used by the resend route. Never throws. */
export async function mailVerificationToken(email: string, token: string): Promise<void> {
  try {
    await sendEmail(
      buildVerificationEmail({
        to: email,
        verifyUrl: verificationUrl(token),
        expiresInLabel: VERIFICATION_TTL_LABEL,
      }),
    );
  } catch (error) {
    console.error("[auth] verification email could not be sent", error);
  }
}
