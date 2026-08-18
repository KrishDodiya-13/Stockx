import { NextResponse } from "next/server";

import { badRequest, jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { parseStrategyInput } from "@/app/api/strategies/parse";
import { INSTRUMENT_BY_ID } from "@/services/market-data";
import { createStrategy, listStrategies } from "@/services/strategy/strategy-repository";

export const dynamic = "force-dynamic";

/** All strategies for the account, most recently updated first. */
export async function GET() {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;
    return NextResponse.json(jsonSafe({ strategies: await listStrategies(accountId) }));
  } catch (error) {
    return serverError(error);
  }
}

/**
 * Create a strategy.
 *
 * Always created as DRAFT. Activation is a separate, validated transition —
 * creating and arming a strategy in one request would let an invalid one go
 * live before anyone had a chance to check it.
 */
export async function POST(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const body: unknown = await request.json();
    const parsed = parseStrategyInput(body);
    if (!parsed.ok) return badRequest(parsed.message);

    const instrument = INSTRUMENT_BY_ID.get(parsed.value.instrumentId);
    if (!instrument) return badRequest(`Unknown instrument: ${parsed.value.instrumentId}`);

    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;
    const strategy = await createStrategy(accountId, {
      ...parsed.value,
      symbol: instrument.symbol,
    });

    return NextResponse.json(jsonSafe({ strategy }), { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
