import { NextResponse } from "next/server";

import { badRequest, jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { requireAccount } from "@/app/api/_lib/guard";
import {
  NotTradable,
  UnknownInstrument,
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
} from "@/services/watchlist/watchlist-service";

/**
 * The current user's watchlist.
 *
 * The account is always resolved from the session, never read from the request,
 * so there is no parameter a caller could change to reach someone else's list.
 *
 * Every verb returns the full list after the change. The client then renders
 * server truth rather than its own guess about what the mutation did, which is
 * what keeps two open tabs from disagreeing.
 */
export const dynamic = "force-dynamic";

interface WatchlistBody {
  readonly instrumentId?: unknown;
}

async function readInstrumentId(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as WatchlistBody;
    return typeof body.instrumentId === "string" && body.instrumentId.trim() !== ""
      ? body.instrumentId.trim()
      : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;

    return NextResponse.json(jsonSafe({ watchlist: await getWatchlist(auth.user.accountId) }));
  } catch (error) {
    return serverError(error);
  }
}

/** Follow an instrument. Adding one already present is a no-op, not an error. */
export async function POST(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  const limit = checkRateLimit(rateLimitKey(request, "watchlist"), LIMITS.write);
  if (!limit.allowed) return tooManyRequests(limit);

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;

    const instrumentId = await readInstrumentId(request);
    if (!instrumentId) return badRequest("`instrumentId` is required.");

    const watchlist = await addToWatchlist(auth.user.accountId, instrumentId);
    return NextResponse.json(jsonSafe({ watchlist }));
  } catch (error) {
    // A symbol that is not in the registry is the caller's mistake, not a
    // server fault — 400 rather than 500.
    if (error instanceof UnknownInstrument) return badRequest(error.message);
    // Starring an index is also the caller's mistake, and for the same reason.
    if (error instanceof NotTradable) return badRequest(error.message);
    return serverError(error);
  }
}

/**
 * Stop following an instrument.
 *
 * This deletes one watchlist row and nothing else. Holdings, positions, orders
 * and trades live in their own tables with no foreign key to this one, so a
 * position the user owns survives un-starring it.
 */
export async function DELETE(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  const limit = checkRateLimit(rateLimitKey(request, "watchlist"), LIMITS.write);
  if (!limit.allowed) return tooManyRequests(limit);

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;

    // Accepted in the body or the query string: `fetch` with method DELETE and
    // a body is awkward from some callers.
    const fromQuery = new URL(request.url).searchParams.get("instrumentId");
    const instrumentId = fromQuery?.trim() || (await readInstrumentId(request));
    if (!instrumentId) return badRequest("`instrumentId` is required.");

    const watchlist = await removeFromWatchlist(auth.user.accountId, instrumentId);
    return NextResponse.json(jsonSafe({ watchlist }));
  } catch (error) {
    return serverError(error);
  }
}
