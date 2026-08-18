import { NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/lib/prisma";

/**
 * Shared route helpers.
 *
 * The database-not-configured case is handled centrally because it is the
 * expected state for a fresh checkout: without it, every trading route would
 * throw an opaque Prisma connection error instead of telling the developer to
 * run the two setup commands.
 */

export interface ApiError {
  error: string;
  message: string;
}

export function databaseUnavailable(): NextResponse<ApiError> {
  return NextResponse.json(
    {
      error: "database_not_configured",
      message:
        "No database is configured. Set DATABASE_URL in .env.local, then run `npx prisma migrate dev` to create the schema.",
    },
    { status: 503 },
  );
}

export function badRequest(message: string): NextResponse<ApiError> {
  return NextResponse.json({ error: "bad_request", message }, { status: 400 });
}

export function serverError(error: unknown): NextResponse<ApiError> {
  console.error("[api] unhandled error", error);

  const message =
    error instanceof Error && /connect|ECONNREFUSED|P1001|P1003/i.test(error.message)
      ? "Could not reach the database. Check that PostgreSQL is running and DATABASE_URL is correct."
      : "Something went wrong handling this request.";

  return NextResponse.json({ error: "server_error", message }, { status: 500 });
}

/** Guard every trading route with this. */
export function requireDatabase(): NextResponse<ApiError> | null {
  return isDatabaseConfigured() ? null : databaseUnavailable();
}

/**
 * BigInt is not JSON-serialisable and Prisma returns it for every money column.
 * Money is converted to a number of paise at the repository boundary, so this
 * is a backstop for anything that slips through.
 */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? Number(item) : item)),
  ) as T;
}
