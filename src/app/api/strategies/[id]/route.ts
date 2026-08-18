import { NextResponse } from "next/server";

import { badRequest, jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { parseStrategyInput } from "@/app/api/strategies/parse";
import { canTransition, isEditable, type StrategyStatus } from "@/domain/strategy";
import { INSTRUMENT_BY_ID } from "@/services/market-data";
import { validateStrategy } from "@/services/strategy/strategy-engine";
import { resetStrategyRunState } from "@/services/strategy/strategy-runner";
import {
  deleteStrategy,
  getStrategy,
  setStrategyStatus,
  updateStrategy,
} from "@/services/strategy/strategy-repository";

export const dynamic = "force-dynamic";

const STATUSES: readonly StrategyStatus[] = [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
];

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const { id } = await context.params;
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;
    const strategy = await getStrategy(accountId, id);

    if (!strategy) {
      return NextResponse.json(
        { error: "not_found", message: "Strategy not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(
      jsonSafe({ strategy, validation: validateStrategy(strategy) }),
    );
  } catch (error) {
    return serverError(error);
  }
}

/**
 * Update a strategy's content, its status, or both.
 *
 * Two rules are enforced here rather than trusted to the client:
 *
 *  - Content may only change while the strategy is editable (DRAFT or PAUSED).
 *    Rewriting a running strategy's rules underneath it would mean the thing
 *    that executed is not the thing recorded.
 *
 *  - A transition to ACTIVE requires passing validation. This is the gate that
 *    keeps an incoherent strategy — one selling more than it buys — from ever
 *    reaching the execution engine.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const { id } = await context.params;
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;

    const existing = await getStrategy(accountId, id);
    if (!existing) {
      return NextResponse.json(
        { error: "not_found", message: "Strategy not found." },
        { status: 404 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    let current = existing;

    // --- content ----------------------------------------------------------
    if (body.rules !== undefined || body.name !== undefined) {
      if (!isEditable(existing.status)) {
        return NextResponse.json(
          {
            error: "not_editable",
            message: `A ${existing.status.toLowerCase()} strategy cannot be edited. Pause it first.`,
          },
          { status: 409 },
        );
      }

      const parsed = parseStrategyInput({
        name: body.name ?? existing.name,
        instrumentId: body.instrumentId ?? existing.instrumentId,
        notes: body.notes ?? existing.notes,
        rules: body.rules ?? existing.rules,
      });
      if (!parsed.ok) return badRequest(parsed.message);

      const instrument = INSTRUMENT_BY_ID.get(parsed.value.instrumentId);
      if (!instrument) return badRequest(`Unknown instrument: ${parsed.value.instrumentId}`);

      const updated = await updateStrategy(accountId, id, {
        ...parsed.value,
        symbol: instrument.symbol,
      });
      if (updated) current = updated;
    }

    // --- status -----------------------------------------------------------
    if (typeof body.status === "string") {
      const next = body.status as StrategyStatus;

      if (!STATUSES.includes(next)) return badRequest(`Unknown status: ${body.status}`);

      if (next !== current.status) {
        if (!canTransition(current.status, next)) {
          return NextResponse.json(
            {
              error: "invalid_transition",
              message: `A strategy cannot move from ${current.status} to ${next}.`,
            },
            { status: 409 },
          );
        }

        if (next === "ACTIVE") {
          const validation = validateStrategy(current);
          if (!validation.canActivate) {
            return NextResponse.json(
              {
                error: "validation_failed",
                message: "This strategy cannot be activated until its errors are resolved.",
                issues: validation.issues,
              },
              { status: 422 },
            );
          }
        }

        /*
          Activating starts a fresh run: clear every rule's fired marker and
          the high-water price. Without this, re-activating a strategy whose
          rules had all fired would leave it permanently inert — it would look
          active while being incapable of ever triggering again.
        */
        if (next === "ACTIVE") await resetStrategyRunState(id);

        const updated = await setStrategyStatus(accountId, id, next);
        if (updated) current = updated;
      }
    }

    return NextResponse.json(jsonSafe({ strategy: current, validation: validateStrategy(current) }));
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const { id } = await context.params;
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;
    const deleted = await deleteStrategy(accountId, id);

    if (!deleted) {
      return NextResponse.json(
        { error: "not_found", message: "Strategy not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
