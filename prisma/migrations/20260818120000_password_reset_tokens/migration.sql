-- Password reset tokens.
--
-- Adds one table. Nothing existing is altered or dropped, so this is safe to
-- run against a populated production database: no user row, session, account
-- or trade is touched.
--
-- Written by hand to match the rest of this directory, so the constraints
-- below are part of the migration rather than something the application is
-- trusted to remember.

CREATE TABLE "password_reset_tokens" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,

  -- SHA-256 of the emailed token, base64url. The raw token exists only in the
  -- email and in the user's URL bar; it is never written here or logged.
  "tokenHash" TEXT NOT NULL,

  "expiresAt" TIMESTAMP(3) NOT NULL,

  -- Non-null once spent. The row is kept rather than deleted so a replayed
  -- link is refused as used rather than silently looking like it expired.
  "usedAt"    TIMESTAMP(3),

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- Deleting a user takes their pending resets with them, as for sessions.
ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One token addresses at most one row. Unique rather than merely indexed so a
-- collision is refused by the database instead of resolving to whichever row
-- happened to be returned first.
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key"
  ON "password_reset_tokens"("tokenHash");

-- Invalidating a user's other outstanding tokens on a successful reset reads
-- by userId; expiry sweeps read by expiresAt.
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- A token that expires at or before it was created could never be used, and
-- would mean the TTL was computed wrongly.
ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_expiry_after_creation"
  CHECK ("expiresAt" > "createdAt");

-- A blank hash would match a blank token and let an empty link reset a
-- password. Only the database can refuse that unconditionally.
ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_hash_not_blank"
  CHECK (length(btrim("tokenHash")) > 0);
