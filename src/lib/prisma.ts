import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton.
 *
 * Next.js hot-reloads modules in development, which would otherwise open a new
 * connection pool on every edit until Postgres refuses more connections. The
 * client is cached on `globalThis` to survive reloads.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Whether a database is configured at all. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Money crosses the Prisma boundary as BigInt and lives in the app as a number
 * of paise. The conversion is checked rather than assumed: silently truncating
 * a balance past 2^53 would corrupt an account without any error.
 */
export function bigIntToNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Monetary value ${value} exceeds the safe integer range`);
  }
  return Number(value);
}

export function numberToBigInt(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Monetary value must be finite, received ${value}`);
  }
  return BigInt(Math.trunc(value));
}
