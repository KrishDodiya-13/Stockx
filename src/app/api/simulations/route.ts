import { NextResponse } from "next/server";

import { badRequest, jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { bigIntToNumber, numberToBigInt, prisma } from "@/lib/prisma";
import { INSTRUMENT_BY_ID } from "@/services/market-data";

export const dynamic = "force-dynamic";

/**
 * Saved risk simulations.
 *
 * Only inputs are stored. Derived figures are recomputed by `calculateRisk`
 * wherever a simulation is displayed, so a saved plan can never disagree with
 * the engine.
 */
export async function GET() {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;
    const rows = await prisma.riskSimulation.findMany({
      where: { accountId: accountId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json(
      jsonSafe({
        simulations: rows.map((row) => ({
          id: row.id,
          name: row.name,
          instrumentId: row.instrumentId,
          symbol: row.symbol,
          capital: bigIntToNumber(row.capital),
          entryPrice: bigIntToNumber(row.entryPrice),
          targetPrice: row.targetPrice === null ? null : bigIntToNumber(row.targetPrice),
          stopPrice: row.stopPrice === null ? null : bigIntToNumber(row.stopPrice),
          quantity: row.quantity,
          notes: row.notes,
          createdAt: row.createdAt.getTime(),
        })),
      }),
    );
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const body = (await request.json()) as Record<string, unknown>;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length === 0) return badRequest("`name` is required.");
    if (name.length > 120) return badRequest("`name` may not exceed 120 characters.");

    const capital = Number(body.capital);
    const entryPrice = Number(body.entryPrice);
    const quantity = Number(body.quantity);

    if (!Number.isFinite(capital) || capital <= 0) return badRequest("`capital` must be above zero.");
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      return badRequest("`entryPrice` must be above zero.");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return badRequest("`quantity` must be a whole number above zero.");
    }

    const targetPrice =
      body.targetPrice === null || body.targetPrice === undefined ? null : Number(body.targetPrice);
    const stopPrice =
      body.stopPrice === null || body.stopPrice === undefined ? null : Number(body.stopPrice);

    if (targetPrice !== null && (!Number.isFinite(targetPrice) || targetPrice <= 0)) {
      return badRequest("`targetPrice` must be above zero when provided.");
    }
    if (stopPrice !== null && (!Number.isFinite(stopPrice) || stopPrice <= 0)) {
      return badRequest("`stopPrice` must be above zero when provided.");
    }

    const instrumentId = typeof body.instrumentId === "string" ? body.instrumentId : null;
    const instrument = instrumentId ? (INSTRUMENT_BY_ID.get(instrumentId) ?? null) : null;

    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;
    const created = await prisma.riskSimulation.create({
      data: {
        accountId: accountId,
        name,
        instrumentId: instrument?.id ?? null,
        symbol: instrument?.symbol ?? null,
        capital: numberToBigInt(capital),
        entryPrice: numberToBigInt(entryPrice),
        targetPrice: targetPrice === null ? null : numberToBigInt(targetPrice),
        stopPrice: stopPrice === null ? null : numberToBigInt(stopPrice),
        quantity,
        notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : null,
      },
      select: { id: true },
    });

    return NextResponse.json(jsonSafe({ id: created.id }), { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
