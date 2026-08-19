import { NextResponse } from "next/server";

import { databaseUnavailable } from "@/app/api/_lib/api-helpers";
import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/prisma";
import { resendVerification } from "@/services/auth/email-verification";
import { mailVerificationToken } from "@/services/auth/verification-mailer";
import { validateEmail } from "@/services/auth/password";

export const dynamic = "force-dynamic";

/**
 * Send another confirmation email.
 *
 * ── One response, always ───────────────────────────────────────────────────
 *
 * Unknown address, already-confirmed address, cooldown still running, provider
 * outage: all return the same 200 and the same wording. "Already confirmed"
 * feels harmless to disclose, but it confirms the address is registered, which
 * is the same enumeration this wording exists to prevent.
 *
 * Two limits apply: this route's IP counter, and a per-account cooldown in the
 * database that survives restarts and applies across instances.
 */
const GENERIC_MESSAGE =
  "If that address needs confirming, a new link is on its way.";

interface ResendBody {
  email?: unknown;
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return databaseUnavailable();

  try {
    const body = (await request.json().catch(() => ({}))) as ResendBody;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!validateEmail(email)) {
      return NextResponse.json(
        { error: "bad_request", message: "Enter a valid email address." },
        { status: 400 },
      );
    }

    const limit = checkRateLimit(
      rateLimitKey(request, "verification-resend"),
      LIMITS.verificationResend,
    );
    if (!limit.allowed) return tooManyRequests(limit);

    const { token } = await resendVerification(email);
    if (token) await mailVerificationToken(email, token);

    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  } catch (error) {
    // Logged without the address. The response stays generic even here: a 500
    // on a real address and a 200 on an unknown one is the same oracle.
    console.error("[auth] verification resend failed", error);
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }
}
