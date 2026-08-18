import { NextResponse } from "next/server";

import { badRequest, jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { MIN_INITIAL_DEPOSIT_RUPEES } from "@/domain/constants";
import { formatCurrency } from "@/lib/format";
import { rupeesToPaise } from "@/lib/money";
import { depositFunds, DepositLimitExceeded } from "@/services/trading/order-service";

export const dynamic = "force-dynamic";

interface DepositBody {
  /** Rupees, not paise — the one place a client sends a raw money amount. */
  amount?: unknown;
}

/**
 * Add virtual funds to the caller's own account.
 *
 * The account is resolved from the session, exactly like every other
 * account-scoped route — a deposit request can never name someone else's
 * account. `depositFunds` enforces the lifetime cap; this route only handles
 * the amount as a plain number of rupees and turns the two known failure
 * modes into readable messages.
 */
export async function POST(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(
      rateLimitKey(request, "deposit", auth.user.userId),
      LIMITS.deposit,
    );
    if (!limit.allowed) return tooManyRequests(limit);

    const body = (await request.json()) as DepositBody;
    const rupees = typeof body.amount === "number" ? body.amount : Number(body.amount);

    if (!Number.isFinite(rupees) || rupees < MIN_INITIAL_DEPOSIT_RUPEES) {
      return badRequest(
        `Enter an amount of at least ${formatCurrency(rupeesToPaise(MIN_INITIAL_DEPOSIT_RUPEES), { whole: true })}.`,
      );
    }

    try {
      const result = await depositFunds(auth.user.accountId, rupeesToPaise(rupees));
      return NextResponse.json(jsonSafe({ ok: true, ...result }));
    } catch (error) {
      if (error instanceof DepositLimitExceeded) {
        return badRequest(
          error.remaining <= 0
            ? "You have already reached the ₹10,00,000 lifetime deposit limit."
            : `You can add at most ${formatCurrency(error.remaining, { whole: true })} more before reaching the ₹10,00,000 limit.`,
        );
      }
      throw error;
    }
  } catch (error) {
    return serverError(error);
  }
}
