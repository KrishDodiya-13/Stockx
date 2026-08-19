/**
 * Password hashing and session tokens.
 *
 * Uses Node's built-in `scrypt` — a memory-hard KDF designed for exactly this —
 * rather than adding a dependency. No fast hash (SHA, MD5) is used anywhere: a
 * fast hash is the wrong tool for passwords precisely because it is fast.
 *
 * Server-only. Every function here throws if reached from a browser bundle.
 */

import { randomBytes, scrypt, timingSafeEqual, createHash, type ScryptOptions } from "node:crypto";

/**
 * `promisify` resolves to scrypt's three-argument overload, which drops the
 * options object — and silently hashing at Node's defaults instead of the cost
 * parameters chosen below would be a real weakening, not a type nuisance. So the
 * wrapper is written out with the options preserved.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/**
 * Cost parameters.
 *
 * N=16384 is the widely cited interactive-login baseline: roughly 100ms and
 * 16MB per hash on ordinary hardware. High enough to make offline cracking
 * expensive, low enough that a sign-in does not feel broken.
 */
const SCRYPT_N = 16_384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Floors applied when reading a stored record.
 *
 * The exact current values are `KEY_LENGTH` and `SALT_LENGTH`, but verification
 * must keep working if those are raised later, so it accepts a range with a
 * floor rather than one fixed number. Below the floor the record is refused
 * outright — nothing legitimate produces a 4-byte hash.
 */
const MIN_KEY_LENGTH = 32;
const MIN_SALT_LENGTH = 8;

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("Password hashing must never run in the browser.");
  }
}

/**
 * Hash a password for storage.
 *
 * The salt is random per password and stored alongside the hash, so two users
 * with the same password get different hashes and a precomputed table is
 * useless. Parameters are embedded so they can be raised later without
 * invalidating existing hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  assertServer();

  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_r,
    SCRYPT_p,
    KEY_LENGTH,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Check a password against a stored hash.
 *
 * Compared with `timingSafeEqual`, so the time taken does not depend on how
 * many leading bytes matched — a plain `===` leaks that, one byte at a time.
 *
 * Returns false rather than throwing on a malformed record: a corrupt hash is a
 * failed login, not a server error that reveals the record exists.
 *
 * ── Why the key length is stored, not inferred ─────────────────────────────
 *
 * scrypt finishes with a single PBKDF2-HMAC-SHA256 pass, which makes its output
 * *prefix-stable*: the first 32 bytes of a 64-byte derivation are byte-for-byte
 * the first 32 bytes of a 32-byte derivation of the same inputs.
 *
 * So deriving `expected.length` bytes — taking the length from the record —
 * means a truncated record still verifies, and a record truncated to one byte
 * accepts one password in 256. The stored length is therefore treated as part
 * of the record and checked, not as a hint to be trusted.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  assertServer();

  try {
    const [scheme, n, r, p, keyLength, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt" || !n || !r || !p || !keyLength || !saltB64 || !hashB64) return false;

    const declaredLength = Number(keyLength);
    if (!Number.isInteger(declaredLength) || declaredLength < MIN_KEY_LENGTH) return false;

    const salt = Buffer.from(saltB64, "base64");
    if (salt.length < MIN_SALT_LENGTH) return false;

    const expected = Buffer.from(hashB64, "base64");
    if (expected.length !== declaredLength) return false;

    const derived = await scryptAsync(password.normalize("NFKC"), salt, declaredLength, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });

    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** 256 bits of entropy — not guessable, and not derived from anything. */
export function createSessionToken(): string {
  assertServer();
  return randomBytes(32).toString("base64url");
}

/**
 * The value actually stored for a session token.
 *
 * Sessions are stored hashed, so a database leak does not hand the attacker a
 * set of working sessions. SHA-256 is correct *here* — unlike a password, the
 * token already has full entropy, so there is nothing to brute-force and no
 * reason to pay scrypt's cost on every request.
 */
export function hashSessionToken(token: string): string {
  assertServer();
  return createHash("sha256").update(token).digest("base64url");
}

/**
 * A single-use token for an emailed link, and the value stored for it.
 *
 * Deliberately the same construction as the session token above, for the same
 * reason: 256 bits from the OS CSPRNG, stored only as a SHA-256 digest. The
 * token is not derived from the user id, the email, the clock, or anything
 * else an attacker could reconstruct — those are all *guessable* given one
 * leaked example, which is exactly the failure an emailed link cannot afford.
 *
 * SHA-256 rather than scrypt is right here for the same reason it is right for
 * sessions: the token already carries full entropy, so there is no low-entropy
 * secret to slow an attacker down over, and paying scrypt's cost on every link
 * click would buy nothing.
 */
export function createLinkToken(): string {
  assertServer();
  return randomBytes(32).toString("base64url");
}

export function hashLinkToken(token: string): string {
  assertServer();
  return createHash("sha256").update(token).digest("base64url");
}

/** Digits in a one-time code. Six is what people will retype from an email. */
export const OTP_LENGTH = 6;

/**
 * A six-digit one-time code.
 *
 * ── Why the modulo is rejected rather than taken ───────────────────────────
 *
 * `randomBytes(4) % 1000000` is the obvious construction and it is biased:
 * 2^32 is not a multiple of a million, so the low codes come up slightly more
 * often than the high ones. The bias is small, but it is free to avoid — draw
 * again when the sample lands in the short tail, and every code is equally
 * likely.
 *
 * ── Why six digits is enough here, and only here ───────────────────────────
 *
 * A million possibilities is nothing on its own. It is defensible because the
 * code lives for ten minutes, dies after a handful of wrong guesses, and is
 * scoped to one account — so an attacker gets a few tries at one target, not
 * unlimited tries at everyone. Remove any one of those three and six digits
 * would be indefensible.
 */
export function createOtpCode(): string {
  assertServer();

  const ceiling = 10 ** OTP_LENGTH;
  // The largest multiple of `ceiling` that fits in 2^32; samples at or above
  // it are discarded rather than folded back in.
  const limit = Math.floor(0xffffffff / ceiling) * ceiling;

  let sample = 0;
  do {
    sample = randomBytes(4).readUInt32BE(0);
  } while (sample >= limit);

  return String(sample % ceiling).padStart(OTP_LENGTH, "0");
}

/**
 * The value stored for a one-time code.
 *
 * Bound to the user id, which matters more than it looks. A bare SHA-256 of
 * six digits is a table of a million entries an attacker could precompute
 * once and reverse every code in a stolen database instantly. Mixing in the
 * (unguessable, per-row) user id means that table would have to be rebuilt per
 * account, which is the whole point of salting.
 */
export function hashOtpCode(userId: string, code: string): string {
  assertServer();
  return createHash("sha256").update(`${userId}:${code}`).digest("base64url");
}

/** Constant-time comparison of two stored digests. */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface PasswordRule {
  readonly ok: boolean;
  readonly message: string | null;
}

/**
 * Minimum password requirements.
 *
 * Length is the requirement that actually matters; composition rules mostly
 * push people toward `Password1!` patterns. A floor of 10 with a ceiling to
 * stop a megabyte password becoming a denial-of-service against scrypt.
 */
export function validatePassword(password: string): PasswordRule {
  if (password.length < 10) {
    return { ok: false, message: "Password must be at least 10 characters." };
  }
  if (password.length > 200) {
    return { ok: false, message: "Password may not exceed 200 characters." };
  }
  return { ok: true, message: null };
}

/** Conservative email shape check. Deliverability is not our business. */
export function validateEmail(email: string): boolean {
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
