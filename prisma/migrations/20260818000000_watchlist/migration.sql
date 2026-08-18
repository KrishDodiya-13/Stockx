-- Per-user watchlist.
--
-- Replaces a `localStorage` list, which was shared by everyone using the same
-- browser and lost on any other device. Scoped to an account so the existing
-- `requireAccount()` guard covers it, with no second access-control path.
--
-- Written by hand rather than generated, matching the rest of this directory,
-- so the constraints below are part of the migration rather than something the
-- application is trusted to remember.

CREATE TABLE "watchlist_items" (
  "id"           TEXT NOT NULL,
  "accountId"    TEXT NOT NULL,
  "instrumentId" TEXT NOT NULL,
  "symbol"       TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- Deleting an account takes its watchlist with it, as for holdings and orders.
ALTER TABLE "watchlist_items"
  ADD CONSTRAINT "watchlist_items_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The duplicate guard. Application code checks before inserting, but two taps
-- on the star arriving together would both pass that check; only the database
-- can refuse the second one.
CREATE UNIQUE INDEX "watchlist_items_accountId_instrumentId_key"
  ON "watchlist_items"("accountId", "instrumentId");

CREATE INDEX "watchlist_items_accountId_idx" ON "watchlist_items"("accountId");

-- An empty symbol would render a blank row that cannot be identified or
-- removed from the UI.
ALTER TABLE "watchlist_items"
  ADD CONSTRAINT "watchlist_items_symbol_not_blank"
  CHECK (length(btrim("symbol")) > 0);

ALTER TABLE "watchlist_items"
  ADD CONSTRAINT "watchlist_items_instrument_not_blank"
  CHECK (length(btrim("instrumentId")) > 0);
