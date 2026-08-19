import { NextResponse } from "next/server";

import { databaseUnavailable } from "@/app/api/_lib/api-helpers";
import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/prisma";
import { verifyEmailToken } from "@/services/auth/email-verification";

export const dynamic = "force-dynamic";

interface VerifyBody {
  token?: unknown;
}

/**
 * Confirm an email address from the token in the link.
 *
 * POST rather than GET, even though it arrives from a link: mail clients and
 * corporate scanners prefetch GET links, and a GET that mutates would let a
 * scanner verify an address nobody ever opened. The page reads the token from
 * the URL and posts it, so the state change is a deliberate act by the browser.
 */
export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return databaseUnavailable();

  try {
    const body = (await request.json().catch(() => ({}))) as VerifyBody;
    const token = typeof body.token === "string" ? body.token : "";

    const limit = checkRateLimit(
      rateLimitKey(request, "verify-email"),
      LIMITS.passwordResetSubmit,
    );
    if (!limit.allowed) return tooManyRequests(limit);

    const outcome = await verifyEmailToken(token);

    if (!outcome.ok) {
      // 410 for a link that is gone, which the page uses to offer a resend.
      return NextResponse.json({ error: outcome.reason, message: outcome.message }, { status: 410 });
    }

    return NextResponse.json({
      ok: true,
      alreadyVerified: outcome.alreadyVerified,
      message: outcome.alreadyVerified
        ? "This email address is already confirmed. You can sign in."
        : "Your email address is confirmed. You can sign in now.",
    });
  } catch (error) {
    console.error("[auth] email verification failed", error);
    return NextResponse.json(
      { error: "server_error", message: "Could not confirm that link." },
      { status: 500 },
    );
  }
}
