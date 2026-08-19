-- Google sign-in, email verification, and password reset by one-time code.
--
-- Three features, one migration, because they share a single change to `users`
-- and splitting them would mean three deploys to reach a consistent schema.
--
-- Nothing is dropped and no row is deleted. The only destructive-looking
-- statements are renames, which preserve their data, and one backfill that
-- exists precisely so that existing people are not locked out.
--
-- Written by hand to match the rest of this directory.

-- ---------------------------------------------------------------------------
-- 1. Email verification state on the existing user
-- ---------------------------------------------------------------------------

ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- Everyone who already had an account keeps it.
--
-- Sign-in now requires a verified address. Without this backfill, every
-- existing user would be refused at the next sign-in for failing a check that
-- did not exist when they registered — which would be this migration breaking
-- production, not securing it. Their address is treated as proven as of the
-- day they created the account.
UPDATE "users" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;

CREATE TABLE "email_verification_tokens" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A 256-bit token can carry a global unique index: a collision is impossible
-- in practice, and uniqueness means one link addresses exactly one row.
CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key"
  ON "email_verification_tokens"("tokenHash");
CREATE INDEX "email_verification_tokens_userId_idx"
  ON "email_verification_tokens"("userId");
CREATE INDEX "email_verification_tokens_expiresAt_idx"
  ON "email_verification_tokens"("expiresAt");

ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_expiry_after_creation"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_hash_not_blank"
  CHECK (length(btrim("tokenHash")) > 0);

-- ---------------------------------------------------------------------------
-- 2. Linked third-party identities
-- ---------------------------------------------------------------------------

CREATE TABLE "oauth_accounts" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "provider"          TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "oauth_accounts"
  ADD CONSTRAINT "oauth_accounts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One Google identity cannot be claimed by two users. The application checks
-- before linking, but two callbacks arriving together would both pass that
-- check; only the database can refuse the second.
CREATE UNIQUE INDEX "oauth_accounts_provider_providerAccountId_key"
  ON "oauth_accounts"("provider", "providerAccountId");
CREATE INDEX "oauth_accounts_userId_idx" ON "oauth_accounts"("userId");

ALTER TABLE "oauth_accounts"
  ADD CONSTRAINT "oauth_accounts_provider_not_blank"
  CHECK (length(btrim("provider")) > 0 AND length(btrim("providerAccountId")) > 0);

-- ---------------------------------------------------------------------------
-- 3. Password reset moves from an emailed link to a six-digit code
-- ---------------------------------------------------------------------------
--
-- The table is renamed and altered rather than dropped and recreated. It holds
-- only ephemeral reset material, so either would be safe for the data, but a
-- rename keeps the foreign key, the primary key and the row history intact and
-- makes the intent obvious in the history: this is the same thing, changed.

ALTER TABLE "password_reset_tokens" RENAME TO "password_reset_otps";

ALTER TABLE "password_reset_tokens_pkey" RENAME TO "password_reset_otps_pkey";
ALTER INDEX "password_reset_tokens_userId_idx" RENAME TO "password_reset_otps_userId_idx";
ALTER INDEX "password_reset_tokens_expiresAt_idx" RENAME TO "password_reset_otps_expiresAt_idx";

ALTER TABLE "password_reset_otps" RENAME COLUMN "tokenHash" TO "codeHash";

-- The unique index has to go.
--
-- Six digits is a million values, so two users holding the same code at once
-- is ordinary rather than impossible, and a unique index would refuse to issue
-- the second one. Lookup is by user and then comparison, never by hash alone.
DROP INDEX "password_reset_tokens_tokenHash_key";

-- What makes a six-digit secret defensible: a bounded number of guesses.
ALTER TABLE "password_reset_otps" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "password_reset_otps"
  ADD CONSTRAINT "password_reset_otps_attempts_not_negative"
  CHECK ("attempts" >= 0);

-- The renamed table's old CHECK constraints follow the table, but their names
-- still say "tokens"; renamed so the schema reads consistently.
ALTER TABLE "password_reset_otps"
  RENAME CONSTRAINT "password_reset_tokens_expiry_after_creation"
  TO "password_reset_otps_expiry_after_creation";

ALTER TABLE "password_reset_otps"
  RENAME CONSTRAINT "password_reset_tokens_hash_not_blank"
  TO "password_reset_otps_hash_not_blank";

ALTER TABLE "password_reset_otps"
  RENAME CONSTRAINT "password_reset_tokens_userId_fkey"
  TO "password_reset_otps_userId_fkey";
