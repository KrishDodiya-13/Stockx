-- Financial integrity constraints.
--
-- Everything asserted here is already enforced by the trading engine and by the
-- serializable transaction in `placeOrder`. These constraints exist because
-- application-level validation protects against the code paths you thought of,
-- and the database protects against the ones you did not — a future migration
-- script, a manual fix in psql, or a new route written by someone who did not
-- read the engine.
--
-- Every one of these is an invariant that, if violated, means virtual money was
-- created or destroyed. The correct response is to refuse the write, not to
-- store an impossible row and reconcile later.
--
-- Prisma cannot express CHECK constraints in schema.prisma, which is why this
-- is a hand-written migration rather than generated.

-- Cash may never go negative: an account cannot spend virtual money it does not
-- have. This is the database-level form of the buying-power check.
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_cash_balance_non_negative" CHECK ("cashBalance" >= 0);

-- Funding is fixed and positive. A zero starting capital would also make every
-- return percentage a division by zero.
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_starting_capital_positive" CHECK ("startingCapital" > 0);

-- Shorting is not supported, so a holding is never negative. A holding that
-- reaches zero is deleted rather than kept, hence > 0.
ALTER TABLE "holdings"
  ADD CONSTRAINT "holdings_quantity_positive" CHECK ("quantity" > 0);

-- A share cannot have been bought at a negative or zero price, and invested
-- value is a cost, never a credit.
ALTER TABLE "holdings"
  ADD CONSTRAINT "holdings_average_price_positive" CHECK ("averagePrice" > 0);
ALTER TABLE "holdings"
  ADD CONSTRAINT "holdings_invested_value_non_negative" CHECK ("investedValue" >= 0);

-- A position holds between zero and everything it ever bought, and cannot have
-- sold more than it bought.
ALTER TABLE "positions"
  ADD CONSTRAINT "positions_quantity_non_negative" CHECK ("quantity" >= 0);
ALTER TABLE "positions"
  ADD CONSTRAINT "positions_totals_non_negative"
  CHECK ("totalBought" >= 0 AND "totalSold" >= 0);
ALTER TABLE "positions"
  ADD CONSTRAINT "positions_cannot_sell_more_than_bought"
  CHECK ("totalSold" <= "totalBought");
ALTER TABLE "positions"
  ADD CONSTRAINT "positions_quantity_reconciles"
  CHECK ("quantity" = "totalBought" - "totalSold");

-- An order for zero or a negative number of shares is meaningless, and it can
-- never fill more than it asked for.
--
-- REJECTED is excused deliberately: the engine records *why* an order was
-- refused, and "you asked for zero shares" is one of the reasons. Rejecting the
-- row as well would hide the rejection from the user's order history, which is
-- the one place it needs to appear.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_quantity_positive"
  CHECK ("quantity" > 0 OR "status" = 'REJECTED');
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_filled_within_quantity"
  CHECK ("filledQuantity" >= 0 AND "filledQuantity" <= "quantity");
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_limit_price_positive"
  CHECK ("limitPrice" IS NULL OR "limitPrice" > 0);
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_fill_price_positive"
  CHECK ("averageFillPrice" IS NULL OR "averageFillPrice" > 0);

-- A fill is always a positive number of shares at a positive price, and its
-- value is a positive amount of cash.
ALTER TABLE "trades"
  ADD CONSTRAINT "trades_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "trades"
  ADD CONSTRAINT "trades_price_positive" CHECK ("price" > 0);
ALTER TABLE "trades"
  ADD CONSTRAINT "trades_value_positive" CHECK ("value" > 0);

-- A purchase realises nothing — it establishes cost. Only a sale can book P&L,
-- so a buy with non-zero realised P&L is money appearing from nowhere.
ALTER TABLE "trades"
  ADD CONSTRAINT "trades_buy_realises_nothing"
  CHECK ("side" <> 'BUY' OR "realisedPnl" = 0);

-- The ledger balance can never be negative, for the same reason cash cannot.
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_balance_after_non_negative" CHECK ("balanceAfter" >= 0);

-- Opening balance funds the account, a buy debits, a sale credits. A buy that
-- increases cash, or a sale that decreases it, is a sign error.
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_sign_matches_type"
  CHECK (
    ("type" = 'OPENING_BALANCE' AND "amount" > 0)
    OR ("type" = 'BUY' AND "amount" < 0)
    OR ("type" = 'SELL' AND "amount" > 0)
  );

-- A simulated position is a real position: positive size at a positive price.
ALTER TABLE "risk_simulations"
  ADD CONSTRAINT "risk_simulations_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "risk_simulations"
  ADD CONSTRAINT "risk_simulations_capital_positive" CHECK ("capital" > 0);
ALTER TABLE "risk_simulations"
  ADD CONSTRAINT "risk_simulations_entry_price_positive" CHECK ("entryPrice" > 0);
ALTER TABLE "risk_simulations"
  ADD CONSTRAINT "risk_simulations_target_price_positive"
  CHECK ("targetPrice" IS NULL OR "targetPrice" > 0);
ALTER TABLE "risk_simulations"
  ADD CONSTRAINT "risk_simulations_stop_price_positive"
  CHECK ("stopPrice" IS NULL OR "stopPrice" > 0);

-- Backtest counts are counts, and wins plus losses cannot exceed the trades
-- they are drawn from. (They can be fewer: a flat round trip is neither.)
ALTER TABLE "backtests"
  ADD CONSTRAINT "backtests_counts_non_negative"
  CHECK ("tradeCount" >= 0 AND "winCount" >= 0 AND "lossCount" >= 0);
ALTER TABLE "backtests"
  ADD CONSTRAINT "backtests_wins_and_losses_within_trades"
  CHECK ("winCount" + "lossCount" <= "tradeCount");
ALTER TABLE "backtests"
  ADD CONSTRAINT "backtests_window_ordered" CHECK ("toTime" > "fromTime");
ALTER TABLE "backtests"
  ADD CONSTRAINT "backtests_initial_capital_positive" CHECK ("initialCapital" > 0);

-- A trailing stop trails by a positive percentage below 100 — a 100% trail
-- would mean a stop at zero, which can never trigger.
ALTER TABLE "strategy_rules"
  ADD CONSTRAINT "strategy_rules_trail_percent_range"
  CHECK ("trailPercent" IS NULL OR ("trailPercent" > 0 AND "trailPercent" < 100));

-- A fired rule has a fire count, and a rule that has never fired has neither.
ALTER TABLE "strategy_rules"
  ADD CONSTRAINT "strategy_rules_fire_count_non_negative" CHECK ("fireCount" >= 0);

-- An action's quantity is a share count or a percentage; either way, positive.
-- SELL_ALL carries no quantity at all.
ALTER TABLE "strategy_actions"
  ADD CONSTRAINT "strategy_actions_quantity_positive"
  CHECK ("quantity" IS NULL OR "quantity" > 0);
ALTER TABLE "strategy_actions"
  ADD CONSTRAINT "strategy_actions_sell_percent_within_range"
  CHECK ("type" <> 'SELL_PERCENT' OR ("quantity" IS NOT NULL AND "quantity" <= 100));

-- An indicator look-back of zero or fewer bars has no meaning.
ALTER TABLE "strategy_conditions"
  ADD CONSTRAINT "strategy_conditions_period_positive"
  CHECK ("period" IS NULL OR "period" > 0);

-- A session that expires before it was created is already invalid.
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_expires_after_creation" CHECK ("expiresAt" > "createdAt");
