import { NextResponse } from "next/server";

import { jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { getExecutions, runStrategyCycle } from "@/services/strategy/strategy-runner";

export const dynamic = "force-dynamic";

/**
 * Run one evaluation cycle across all active strategies.
 *
 * Safe to call repeatedly and concurrently: each rule is claimed with an atomic
 * conditional update, so overlapping calls cannot double-execute. That is what
 * lets the browser drive this today and a scheduler drive it later with no
 * change to the engine.
 */
export async function POST(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;

    // Generous — the client polls this while a strategy is live — but bounded,
    // so a runaway tab cannot drive an unlimited number of evaluation cycles.
    const limit = checkRateLimit(
      rateLimitKey(request, "strategy-run", auth.user.userId),
      LIMITS.strategyRun,
    );
    if (!limit.allowed) return tooManyRequests(limit);

    const result = await runStrategyCycle(accountId);
    return NextResponse.json(jsonSafe({ result }));
  } catch (error) {
    return serverError(error);
  }
}

/** The execution log, newest first. */
export async function GET() {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;
    return NextResponse.json(jsonSafe({ executions: await getExecutions(accountId) }));
  } catch (error) {
    return serverError(error);
  }
}
