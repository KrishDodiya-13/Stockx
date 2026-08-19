import { NextResponse } from "next/server";

import { databaseUnavailable } from "@/app/api/_lib/api-helpers";
import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/prisma";
import { validateEmail } from "@/services/auth/password";
import { OTP_TTL_LABEL, requestPasswordResetOtp } from "@/services/auth/password-reset";
import { buildPasswordResetOtpEmail } from "@/services/email/password-reset-email";
import { sendEmail } from "@/services/email/send-email";

export const dynamic = "force-dynamic";

/**
 * Step one of the reset: email a six-digit code.
 *
 * A sibling route rather than another `action` on `/api/auth`. The
 * discriminator there covers the session lifecycle — sign in, sign up, sign
 * out — and all three end with a cookie being set or cleared. Password reset
 * sets no cookie, carries its own rate limits, and must never return a
 * differentiated response; folding it in would mean editing the one route
 * every existing login depends on, to gain nothing.
 *
 * ── One response, always ───────────────────────────────────────────────────
 *
 * Unknown address, known address, Google-only account, cooldown still running,
 * provider outage: all return the same 200 and the same wording. Anything else
 * turns this form into a membership oracle. The only exceptions are a
 * malformed email (which reveals nothing about the database) and the rate
 * limiter (which is about the caller, not the address).
 */
const GENERIC_MESSAGE =
  "If an account exists for this email, you will receive a password reset code.";

interface ForgotPasswordBody {
  email?: unknown;
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return databaseUnavailable();

  try {
    const body = (await request.json().catch(() => ({}))) as ForgotPasswordBody;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!validateEmail(email)) {
      return NextResponse.json(
        { error: "bad_request", message: "Enter a valid email address." },
        { status: 400 },
      );
    }

    const limit = checkRateLimit(
      rateLimitKey(request, "password-reset-request"),
      LIMITS.passwordResetRequest,
    );
    if (!limit.allowed) return tooManyRequests(limit);

    const { code } = await requestPasswordResetOtp(email);

    if (code) {
      /*
        A failed send is logged by `sendEmail` (without the code) and changes
        nothing here. Reporting it would say "this address is real and we tried
        to mail it", which is exactly what the shared message conceals.
      */
      await sendEmail(
        buildPasswordResetOtpEmail({ to: email, code, expiresInLabel: OTP_TTL_LABEL }),
      );
    }

    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  } catch (error) {
    // Logged without the address and without the code.
    console.error("[auth] password reset request failed", error);
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }
}
