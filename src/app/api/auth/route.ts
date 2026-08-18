import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { databaseUnavailable } from "@/app/api/_lib/api-helpers";
import { LIMITS, checkRateLimit, rateLimitKey, tooManyRequests } from "@/app/api/_lib/rate-limit";
import { MAX_TOTAL_DEPOSIT_RUPEES, MIN_INITIAL_DEPOSIT_RUPEES } from "@/domain/constants";
import { formatCurrency } from "@/lib/format";
import { rupeesToPaise } from "@/lib/money";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  hashPassword,
  validateEmail,
  validatePassword,
  verifyPassword,
} from "@/services/auth/password";
import {
  createAccountForUser,
  createSession,
  destroySession,
  getCurrentUser,
} from "@/services/auth/session";

export const dynamic = "force-dynamic";

/**
 * A structurally valid record no password hashes to.
 *
 * Compared against when the email is unknown, purely so that path costs the
 * same scrypt work as a real one. Built at module load from a random secret
 * that is then discarded, so it is not a constant an attacker can recognise in
 * the source and is not a hash of anything anyone could type.
 */
const DECOY_HASH_PROMISE = hashPassword(randomBytes(32).toString("base64"));

/** Who am I? Used by the client to decide between signed-in and signed-out UI. */
export async function GET() {
  if (!isDatabaseConfigured()) return databaseUnavailable();

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null });

  // Deliberately minimal: no ids beyond what the UI needs, no account internals.
  return NextResponse.json({ user: { email: user.email, name: user.name } });
}

interface AuthBody {
  action?: unknown;
  email?: unknown;
  password?: unknown;
  name?: unknown;
  /** Rupees, not paise — this is the one place the client sends a raw amount. */
  initialDeposit?: unknown;
}

/**
 * Validate the sign-up deposit amount.
 *
 * Accepted in rupees (not paise) because that is what the sign-up form
 * collects from the user directly, unlike every other money value in the
 * system, which is computed server-side.
 */
function validateInitialDeposit(value: unknown): { ok: true; rupees: number } | { ok: false; message: string } {
  const rupees = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(rupees)) {
    return { ok: false, message: "Enter how much virtual capital to start with." };
  }
  if (rupees < MIN_INITIAL_DEPOSIT_RUPEES) {
    return {
      ok: false,
      message: `The minimum starting deposit is ${formatCurrency(rupeesToPaise(MIN_INITIAL_DEPOSIT_RUPEES), { whole: true })}.`,
    };
  }
  if (rupees > MAX_TOTAL_DEPOSIT_RUPEES) {
    return {
      ok: false,
      message: `The maximum starting deposit is ${formatCurrency(rupeesToPaise(MAX_TOTAL_DEPOSIT_RUPEES), { whole: true })}.`,
    };
  }

  return { ok: true, rupees };
}

/**
 * Sign up, sign in, sign out.
 *
 * ── Why the failure messages are identical ─────────────────────────────────
 *
 * A wrong password and an unknown email return the same message and the same
 * status. Distinguishing them turns the sign-in form into an oracle for which
 * addresses are registered.
 *
 * The unknown-email path still performs a hash comparison against a dummy
 * value, so the two cases also take comparable time — otherwise the timing
 * difference leaks exactly what the shared message was hiding.
 */
export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return databaseUnavailable();

  try {
    const body = (await request.json()) as AuthBody;
    const action = body.action;

    if (action === "signout") {
      await destroySession();
      return NextResponse.json({ ok: true });
    }

    if (action !== "signin" && action !== "signup") {
      return NextResponse.json(
        { error: "bad_request", message: "`action` must be signin, signup or signout." },
        { status: 400 },
      );
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!validateEmail(email)) {
      return NextResponse.json(
        { error: "bad_request", message: "Enter a valid email address." },
        { status: 400 },
      );
    }

    const rule = action === "signup" ? LIMITS.signUp : LIMITS.signIn;
    const limit = checkRateLimit(rateLimitKey(request, action), rule);
    if (!limit.allowed) return tooManyRequests(limit);

    // --- sign up ----------------------------------------------------------
    if (action === "signup") {
      const strength = validatePassword(password);
      if (!strength.ok) {
        return NextResponse.json(
          { error: "weak_password", message: strength.message },
          { status: 400 },
        );
      }

      const deposit = validateInitialDeposit(body.initialDeposit);
      if (!deposit.ok) {
        return NextResponse.json(
          { error: "invalid_deposit", message: deposit.message },
          { status: 400 },
        );
      }

      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        // Registration necessarily reveals that an address is taken; there is
        // no way to create a unique account without doing so.
        return NextResponse.json(
          { error: "email_taken", message: "An account already exists for that email." },
          { status: 409 },
        );
      }

      const user = await prisma.user.create({
        data: {
          email,
          name: typeof body.name === "string" ? body.name.trim().slice(0, 80) || null : null,
          passwordHash: await hashPassword(password),
        },
        select: { id: true },
      });

      await createAccountForUser(user.id, rupeesToPaise(deposit.rupees));
      await createSession(user.id, request.headers.get("user-agent") ?? undefined);

      return NextResponse.json({ ok: true }, { status: 201 });
    }

    // --- sign in ----------------------------------------------------------
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, accounts: { select: { id: true }, take: 1 } },
    });

    /*
      Always run a comparison, even with no user. Returning early here would
      make "unknown email" measurably faster than "wrong password", which
      reintroduces the enumeration the shared message prevents.

      The decoy must be a *well-formed* record, or `verifyPassword` rejects it
      on a cheap structural check and never reaches scrypt — which would restore
      the very timing difference this exists to remove.
    */
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await DECOY_HASH_PROMISE),
    );

    if (!user || !user.passwordHash || !valid) {
      return NextResponse.json(
        { error: "invalid_credentials", message: "That email and password do not match." },
        { status: 401 },
      );
    }

    // An account created before this phase may have no account row yet.
    if (user.accounts.length === 0) await createAccountForUser(user.id);

    await createSession(user.id, request.headers.get("user-agent") ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[auth] failed", error);
    return NextResponse.json(
      { error: "server_error", message: "Could not complete that request." },
      { status: 500 },
    );
  }
}
