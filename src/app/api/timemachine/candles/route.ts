import { NextResponse } from "next/server";

import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";

import { badRequest, jsonSafe, serverError } from "@/app/api/_lib/api-helpers";
import type { CandleInterval } from "@/domain/market";
import { INSTRUMENT_BY_ID } from "@/services/market-data";
import { getServerMarketDataService } from "@/services/market-data/server";

export const dynamic = "force-dynamic";

const INTERVALS: readonly CandleInterval[] = ["1m", "5m", "15m", "1h", "1d"];

/** Never hand out more than this in one request, whatever is asked for. */
const MAX_BARS_PER_REQUEST = 400;

/**
 * Historical candles for a Time Machine session, clamped to the session clock.
 *
 * The client sends where the session started and how many bars it has advanced.
 * The server returns *only* the bars up to that point — it never returns the
 * bar after the cursor, so future prices do not reach the browser at all rather
 * than being fetched and hidden in the UI.
 *
 * This route is deliberately independent of the database: a session is a
 * sandbox and needs no account.
 *
 * What this does not claim: someone can still call the ordinary historical
 * price endpoints by hand. That data is public within the app. The guarantee
 * here is that a running session is never *given* data it has not reached.
 */
export async function GET(request: Request) {
  /*
    Rate limited: this route proxies an upstream vendor call made with this
    app's own credential, so an unauthenticated caller could otherwise burn the
    account's quota. Read-tier, because a legitimate client polls it.
  */
  const limit = checkRateLimit(rateLimitKey(request, "tm-candles"), LIMITS.read);
  if (!limit.allowed) return tooManyRequests(limit);

  try {
    const params = new URL(request.url).searchParams;

    const instrumentId = params.get("instrumentId") ?? "";
    const instrument = INSTRUMENT_BY_ID.get(instrumentId);
    if (!instrument) return badRequest(`Unknown instrument: ${instrumentId || "(missing)"}`);

    /*
      `start` is required, and its absence must be an error rather than a
      default.

      `Number(null)` is 0, which is a finite number and not in the future — so a
      request with no `start` used to be accepted as a session beginning at the
      Unix epoch, and happily returned four hundred bars stamped 1st January
      1970. Nothing rejected it and nothing looked wrong in the response.

      That mattered beyond the odd dates: a test written against the wrong
      parameter still appeared to confirm the no-future-data guarantee, because
      every 1970 bar is trivially before any cursor. A silent default turned a
      malformed request into a plausible-looking answer, which is the worst way
      for an API to be wrong.
    */
    const rawStart = params.get("start");
    if (rawStart === null || rawStart.trim() === "") {
      return badRequest("`start` is required, in epoch milliseconds.");
    }

    const start = Number(rawStart);
    if (!Number.isFinite(start)) return badRequest("`start` must be epoch milliseconds.");

    // 1st January 2000. Earlier than any market history this app serves, and
    // late enough to catch a zero or a seconds-instead-of-milliseconds value.
    const EARLIEST_START = 946_684_800_000;
    if (start < EARLIEST_START) {
      return badRequest("`start` is before any available market history.");
    }

    if (start > Date.now()) {
      // A session cannot begin in the future; allowing it would make the whole
      // "no future data" guarantee meaningless.
      return badRequest("`start` cannot be in the future.");
    }

    // An unrecognised interval is refused rather than quietly becoming 1m: the
    // caller asked for something specific and would otherwise be handed bars at
    // a resolution they did not request, with nothing to indicate the swap.
    const rawInterval = params.get("interval");
    if (rawInterval !== null && !INTERVALS.includes(rawInterval as CandleInterval)) {
      return badRequest(`\`interval\` must be one of: ${INTERVALS.join(", ")}.`);
    }
    const interval: CandleInterval = (rawInterval as CandleInterval | null) ?? "1m";

    /*
      How far the session has advanced, in bars. This is the clamp: the response
      contains bars [0, cursor], and never bar cursor + 1.
    */
    const cursor = Math.max(0, Math.trunc(Number(params.get("cursor") ?? 0)));
    const requested = Math.min(cursor, MAX_BARS_PER_REQUEST);

    /**
     * The session's intended length in bars. Used only to measure how much
     * history actually exists — never to widen what is returned.
     */
    const limit = Math.min(
      Math.max(1, Math.trunc(Number(params.get("limit") ?? MAX_BARS_PER_REQUEST))),
      MAX_BARS_PER_REQUEST,
    );

    const stepMs = intervalToMs(interval);

    // The furthest the session could ever reach: its intended length, or the
    // present, whichever comes first.
    const windowEnd = Math.min(start + limit * stepMs, Date.now());
    // The furthest it has reached so far.
    const revealedTo = Math.min(start + requested * stepMs, windowEnd);

    if (windowEnd <= start) {
      return NextResponse.json(jsonSafe({ candles: [], availableBars: 0, sessionEnd: null }));
    }

    const service = getServerMarketDataService();

    /*
      Fetched for the whole intended window so the *count* of available bars is
      known — a session whose length is invented rather than measured will run
      past the end of its data and hang.

      Only the count crosses the wire. The candles themselves are sliced to the
      cursor below, so no future price is ever sent, and defensively re-filtered
      in case a provider ignores its `to` bound.
    */
    const windowCandles = await service.getCandles({
      instrumentId,
      interval,
      from: start,
      to: windowEnd,
    });

    const clamped = windowCandles
      .filter((candle) => candle.time <= revealedTo)
      .slice(0, requested);

    return NextResponse.json(
      jsonSafe({
        candles: clamped,
        // How many bars this session can run for. Reveals its *length*, never
        // its prices — which is what lets the client end the session cleanly.
        availableBars: windowCandles.length,
        interval,
        symbol: instrument.symbol,
        sessionEnd: windowEnd,
      }),
    );
  } catch (error) {
    return serverError(error);
  }
}

function intervalToMs(interval: CandleInterval): number {
  switch (interval) {
    case "1m":
      return 60_000;
    case "5m":
      return 300_000;
    case "15m":
      return 900_000;
    case "1h":
      return 3_600_000;
    case "1d":
      return 86_400_000;
  }
}
