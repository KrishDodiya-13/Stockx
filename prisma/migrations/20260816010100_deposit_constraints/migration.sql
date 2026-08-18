-- Extend the transaction sign-matches-type invariant to cover DEPOSIT, and add
-- a database-level backstop for the lifetime deposit cap. Both are already
-- enforced in `/api/account/deposit`, but the same principle as the rest of
-- this file applies: the database should refuse an impossible row rather than
-- trust that every future write path remembers the rule.

ALTER TABLE "transactions" DROP CONSTRAINT "transactions_amount_sign_matches_type";
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_sign_matches_type"
  CHECK (
    ("type" = 'OPENING_BALANCE' AND "amount" > 0)
    OR ("type" = 'DEPOSIT' AND "amount" > 0)
    OR ("type" = 'BUY' AND "amount" < 0)
    OR ("type" = 'SELL' AND "amount" > 0)
  );

-- ₹10,00,000 in paise. Cumulative capital ever deposited (startingCapital)
-- may never exceed this, no matter how many top-ups an account has taken.
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_starting_capital_within_cap"
  CHECK ("startingCapital" <= 100000000);
