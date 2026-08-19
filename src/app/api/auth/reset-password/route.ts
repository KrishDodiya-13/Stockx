import { NextResponse } from "next/server";

import { databaseUnavailable } from "@/app/api/_lib/api-helpers";
import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/prisma";
import { resetPasswordWithOtp } from "@/services/auth/password-reset";

export const dynamic = "force-dynamic";

interface ResetPasswordBody {
  email?: unknown;
  code?: unknown;
  password?: unknown;
}

/**
 * Step three of the reset: spend the code and write the new password.
 *
 * The new password is hashed with the same `hashPassword` used at sign-up, so
 * a reset password and a registered one are indistinguishable in storage. The
 * code is spent in the same transaction as the write, and every session for
 * that user is destroyed — a reset is what someone does when they believe they
 * are compromised.
 *
 * Validation is repeated here rather than trusted from the browser. The
 * client-side checks exist to give immediate feedback; these are the rule. A
 * request built with curl never runs the first.
 *
 * Neither the code nor the password is ever logged.
 */
export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return databaseUnavailable();

  try {
    const body = (await request.json().catch(() => ({}))) as ResetPasswordBody;

    const email = typeof body.email === "string" ? body.email : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (code.length === 0) {
      return NextResponse.json(
        { error: "bad_request", message: "Enter the code from your email." },
        { status: 400 },
      );
    }

    const limit = checkRateLimit(
      rateLimitKey(request, "password-reset-submit"),
      LIMITS.passwordResetSubmit,
    );
    if (!limit.allowed) return tooManyRequests(limit);

    const outcome = await resetPasswordWithOtp(email, code, password);

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.reason, message: outcome.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      message: "Your password has been changed. Sign in with your new password.",
    });
  } catch (error) {
    console.error("[auth] password reset failed", error);
    return NextResponse.json(
      { error: "server_error", message: "Could not reset your password." },
      { status: 500 },
    );
  }
}
