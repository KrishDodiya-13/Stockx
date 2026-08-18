import { NextResponse } from "next/server";

import { jsonSafe, requireDatabase, serverError } from "@/app/api/_lib/api-helpers";
import { requireAccount } from "@/app/api/_lib/guard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;

  try {
    const { id } = await context.params;
    const auth = await requireAccount();
    if (!auth.ok) return auth.response;
    const accountId = auth.user.accountId;

    const result = await prisma.riskSimulation.deleteMany({
      where: { id, accountId: accountId },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { error: "not_found", message: "Simulation not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(jsonSafe({ ok: true }));
  } catch (error) {
    return serverError(error);
  }
}
