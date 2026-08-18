/**
 * Sessions and request authorisation.
 *
 * Every API route that touches account data resolves the caller through
 * `requireAccount`. Nothing accepts an account id from the client — the account
 * is derived from a signed session cookie the client cannot forge, which is
 * what makes "you cannot read another user's portfolio" true by construction
 * rather than by remembering to filter.
 *
 * Server-only.
 */

import { cookies } from "next/headers";

import { DEFAULT_INITIAL_DEPOSIT_RUPEES } from "@/domain/constants";
import { numberToBigInt, prisma } from "@/lib/prisma";
import { rupeesToPaise, type Paise } from "@/lib/money";
import { createSessionToken, hashSessionToken } from "@/services/auth/password";

export const SESSION_COOKIE = "parallel_session";

/** Sessions last a fortnight; long enough to be convenient, short enough to expire. */
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface AuthenticatedUser {
  readonly userId: string;
  readonly accountId: string;
  readonly email: string;
  readonly name: string | null;
}

/**
 * Issue a session and set its cookie.
 *
 * The cookie is `httpOnly` so script cannot read it, `sameSite: lax` so it is
 * not sent on cross-site POSTs (which is the CSRF protection for the mutating
 * routes), and `secure` outside development.
 */
export async function createSession(userId: string, userAgent?: string): Promise<void> {
  const token = createSessionToken();

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: userAgent?.slice(0, 400),
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** Delete the current session and clear its cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    // deleteMany, not delete: an already-removed session must not throw.
    await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }

  store.delete(SESSION_COOKIE);
}

/**
 * Resolve the caller, or null when unauthenticated.
 *
 * An expired session is treated as absent and deleted on sight, so expiry is
 * enforced on read rather than depending on a cleanup job.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          accounts: { select: { id: true }, take: 1, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  const account = session.user.accounts[0];
  if (!account) return null;

  return {
    userId: session.user.id,
    accountId: account.id,
    email: session.user.email,
    name: session.user.name,
  };
}

/**
 * Create a user's first funded account.
 *
 * `initialDeposit` is chosen by the user at sign-up (validated against
 * `MIN_INITIAL_DEPOSIT`/`MAX_TOTAL_DEPOSIT` by the caller — this function
 * trusts the amount it is given). Funding and the opening ledger entry commit
 * together — an account that existed without its opening balance row would
 * make cash unreconcilable from the moment it was created.
 *
 * The default only applies to the legacy safety net in the sign-in path below,
 * for accounts that predate user-chosen deposits.
 */
export async function createAccountForUser(
  userId: string,
  initialDeposit: Paise = rupeesToPaise(DEFAULT_INITIAL_DEPOSIT_RUPEES),
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: {
        userId,
        cashBalance: numberToBigInt(initialDeposit),
        startingCapital: numberToBigInt(initialDeposit),
      },
      select: { id: true },
    });

    await tx.transaction.create({
      data: {
        accountId: account.id,
        type: "OPENING_BALANCE",
        amount: numberToBigInt(initialDeposit),
        balanceAfter: numberToBigInt(initialDeposit),
        description: "Opening virtual capital",
      },
    });

    return account.id;
  });
}

/** Remove expired sessions. Safe to call opportunistically. */
export async function pruneExpiredSessions(): Promise<void> {
  await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}
