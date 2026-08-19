import { NextResponse } from "next/server";

import { databaseUnavailable } from "@/app/api/_lib/api-helpers";
import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/prisma";
import { verifyPasswordResetOtp } from "@/services/auth/password-reset";

export const dynamic = "force-dynamic";

interface VerifyOtpBody {
  email?: unknown;
  code?: unknown;
}

/**
 * Step two of the reset: check the code without spending it.
 *
 * Spending it here would strand the user — they would have proved the code and
 * then have no code left to set a password with. It still costs an attempt, so
 * this endpoint cannot be used to guess for free while the reset endpoint
 * carries the cap.
 *
 * The code is never logged, and neither is the address.
 */
export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return databaseUnavailable();

  try {
    const body = (await request.json().catch(() => ({}))) as VerifyOtpBody;
    const email = typeof body.email === "string" ? body.email : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";

    const limit = checkRateLimit(
      rateLimitKey(request, "password-reset-verify"),
      LIMITS.passwordResetSubmit,
    );
    if (!limit.allowed) return tooManyRequests(limit);

    const outcome = await verifyPasswordResetOtp(email, code);

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.reason, message: outcome.message }, { status: 400 });
    }

    // Deliberately nothing but an acknowledgement: no user id, no name, no
    // indication of anything beyond "that code is the current one".
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[auth] otp verification failed", error);
    return NextResponse.json(
      { error: "server_error", message: "Could not check that code." },
      { status: 500 },
    );
  }
}
