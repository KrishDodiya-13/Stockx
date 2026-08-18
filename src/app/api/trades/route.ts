import { NextResponse } from "next/server";

import { jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { getTrades } from "@/services/trading/order-service";

export const dynamic = "force-dynamic";

/** Executed trades, newest first. */
export async function GET() {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;
    return NextResponse.json(jsonSafe({ trades: await getTrades(accountId) }));
  } catch (error) {
    return serverError(error);
  }
}
