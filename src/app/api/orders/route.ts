import { NextResponse } from "next/server";

import { badRequest, jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import type { OrderSide, OrderType, PlaceOrderRequest } from "@/domain/trading";
import { rupeesToPrice, type PriceE4 } from "@/lib/money";
import { INSTRUMENT_BY_ID } from "@/services/market-data";
import { getOrders, placeOrder } from "@/services/trading/order-service";
import { getServerMarketDataService } from "@/services/market-data/server";

export const dynamic = "force-dynamic";

interface OrderBody {
  instrumentId?: unknown;
  side?: unknown;
  type?: unknown;
  quantity?: unknown;
  limitPrice?: unknown;
}

/**
 * Place an order.
 *
 * The execution price is taken from the market-data service **on the server**,
 * never from the request body. A client-supplied price would let anyone fill at
 * a price of their choosing, which would make every simulated result
 * meaningless.
 */
export async function POST(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    // Authenticate before parsing: an anonymous caller should learn nothing
    // about which request bodies this route considers well-formed.
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;

    const limit = checkRateLimit(
      rateLimitKey(request, "order", auth.user.userId),
      LIMITS.order,
    );
    if (!limit.allowed) return tooManyRequests(limit);

    const body = (await request.json()) as OrderBody;

    const instrumentId = typeof body.instrumentId === "string" ? body.instrumentId : null;
    if (!instrumentId) return badRequest("`instrumentId` is required.");

    const instrument = INSTRUMENT_BY_ID.get(instrumentId);
    if (!instrument) return badRequest(`Unknown instrument: ${instrumentId}`);

    /*
      Indices are not tradable.

      SENSEX, NIFTY 50 and NIFTY BANK are levels computed from a basket; they
      have no shares and no order book, so there is nothing to fill. The UI
      already offers no ticket for them, but the check belongs here as well —
      a route that only refuses what its own buttons refuse is not a rule, it
      is a coincidence.
    */
    if (instrument.kind !== "equity") {
      return badRequest(
        `${instrument.name} is a market index, not a tradable instrument. Indices cannot be bought or sold.`,
      );
    }

    const side = body.side === "BUY" || body.side === "SELL" ? (body.side as OrderSide) : null;
    if (!side) return badRequest("`side` must be BUY or SELL.");

    const type =
      body.type === "MARKET" || body.type === "LIMIT" ? (body.type as OrderType) : null;
    if (!type) return badRequest("`type` must be MARKET or LIMIT.");

    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return badRequest("`quantity` must be a whole number of shares above zero.");
    }

    let limitPrice: PriceE4 | null = null;
    if (type === "LIMIT") {
      const raw = Number(body.limitPrice);
      if (!Number.isFinite(raw) || raw <= 0) {
        return badRequest("`limitPrice` must be a positive number for a limit order.");
      }
      limitPrice = rupeesToPrice(raw);
    }

    // Server-side price. Authoritative.
    const service = getServerMarketDataService();
    const quote = await service.getQuote(instrumentId);

    const orderRequest: PlaceOrderRequest = {
      instrumentId,
      symbol: instrument.symbol,
      side,
      type,
      quantity,
      limitPrice,
      marketPrice: quote?.price ?? null,
      source: "MANUAL",
    };

    const result = await placeOrder(accountId, orderRequest);

    // A rejection is a valid outcome that was recorded, not a transport error;
    // 422 distinguishes "we understood and refused" from "malformed request".
    return NextResponse.json(jsonSafe(result), { status: result.ok ? 200 : 422 });
  } catch (error) {
    return serverError(error);
  }
}

/** Order history, newest first. */
export async function GET() {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;
    return NextResponse.json(jsonSafe({ orders: await getOrders(accountId) }));
  } catch (error) {
    return serverError(error);
  }
}
