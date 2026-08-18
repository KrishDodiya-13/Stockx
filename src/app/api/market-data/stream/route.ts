import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { isMarketOpen, marketPhase } from "@/services/market-data/market-hours";
import { hasLiveFeed } from "@/services/market-data/providers/upstox/instrument-keys";
import { tickToQuote, upstoxFeed, type LiveTick } from "@/services/market-data/providers/upstox/feed";
import { serverEnv } from "@/config/env";

/**
 * Server-sent stream of live prices.
 *
 * ── Why this route exists ──────────────────────────────────────────────────
 *
 * Upstox's feed is a websocket that requires a bearer token. If the browser
 * opened that socket itself, the token would have to be shipped to the browser
 * — visible in the network tab, in `window`, and in any extension the user has
 * installed. So the socket terminates on the server (`upstox/feed.ts`) and this
 * route re-broadcasts the decoded prices over SSE.
 *
 * What crosses the wire to the browser is a price and a timestamp. The token
 * does not appear in this response, in its headers, or in any error it returns.
 *
 * ── Why SSE and not a websocket ────────────────────────────────────────────
 *
 * The data only flows one way — the client's subscription list arrives in the
 * query string, and everything after that is server-to-client. SSE gives that
 * with automatic browser-side reconnection and no second protocol to keep
 * alive.
 *
 * ── This is market data only ───────────────────────────────────────────────
 *
 * Upstox is the price source. Orders are simulated entirely inside this app
 * against virtual cash and never reach Upstox — see `services/trading`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Comment frames keep proxies from closing an idle connection. */
const HEARTBEAT_MS = 15_000;

/** One client may not subscribe to more than the universe is worth. */
const MAX_INSTRUMENTS = 200;

export async function GET(request: Request) {
  const limit = checkRateLimit(rateLimitKey(request, "market-stream"), LIMITS.write);
  if (!limit.allowed) return tooManyRequests(limit);

  const requested = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_INSTRUMENTS);

  // Only instruments Upstox can actually feed. The rest get no events at all,
  // rather than a simulated price dressed up as a live one.
  const live = requested.filter(hasLiveFeed);
  const wanted = new Set(live);

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The client vanished between the check and the write.
          cleanup();
        }
      };

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        unsubscribe?.();
        unsubscribe = null;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      request.signal.addEventListener("abort", cleanup);

      /*
        Bring the socket up and subscribe. Cheap to call per connection: the
        feed dedupes both the connection and the subscriptions, so a hundred
        browser tabs still produce exactly one Upstox socket.
      */
      const status = upstoxFeed.ensure(live);

      send("status", {
        state: status.state,
        detail: status.detail,
        // A connected socket is not a working feed. The client shows LIVE only
        // when a tick has actually been decoded.
        receiving: status.receiving,
        // Never `status` verbatim, and never the token — only these fields.
        marketOpen: isMarketOpen(),
        phase: marketPhase(new Date()),
        live: live.length,
        unsupported: requested.filter((id) => !wanted.has(id)),
        configured: Boolean(serverEnv.upstoxAccessToken),
      });

      // Whatever the feed already knows, so a fresh tab paints immediately
      // instead of waiting for the next trade to print.
      const snapshot = upstoxFeed.snapshot().filter((tick) => wanted.has(tick.instrumentId));
      if (snapshot.length > 0) send("quotes", snapshot.map(tickToQuote));

      unsubscribe = upstoxFeed.onTick((tick: LiveTick) => {
        if (!wanted.has(tick.instrumentId)) return;
        send("quotes", [tickToQuote(tick)]);
      });

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);
    },

    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer text/event-stream by default, which turns a
      // live feed into a batch delivered minutes late.
      "X-Accel-Buffering": "no",
    },
  });
}
