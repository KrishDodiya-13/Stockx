-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TradeSource" AS ENUM ('MANUAL', 'STRATEGY');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('OPENING_BALANCE', 'BUY', 'SELL');

-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('ENTRY', 'TARGET', 'STOP', 'TRAILING_STOP', 'CUSTOM');

-- CreateEnum
CREATE TYPE "LogicOperator" AS ENUM ('AND', 'OR');

-- CreateEnum
CREATE TYPE "ConditionType" AS ENUM ('PRICE_ABOVE', 'PRICE_BELOW', 'PRICE_REACHES', 'PERCENT_INCREASE', 'PERCENT_DECREASE', 'VOLUME_ABOVE', 'RSI_ABOVE', 'RSI_BELOW', 'MACD_CROSSES_ABOVE', 'MACD_CROSSES_BELOW', 'PRICE_ABOVE_MA', 'PRICE_BELOW_MA', 'BOLLINGER_UPPER_BREAK', 'BOLLINGER_LOWER_BREAK', 'PORTFOLIO_PNL_ABOVE', 'PORTFOLIO_PNL_BELOW', 'POSITION_PNL_ABOVE', 'POSITION_PNL_BELOW');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('BUY', 'SELL', 'SELL_PERCENT', 'SELL_ALL');

-- CreateEnum
CREATE TYPE "ExecutionOutcome" AS ENUM ('EXECUTED', 'REJECTED', 'SKIPPED', 'INFO');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Paper account',
    "cashBalance" BIGINT NOT NULL,
    "startingCapital" BIGINT NOT NULL,
    "realisedPnl" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holdings" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "averagePrice" BIGINT NOT NULL,
    "investedValue" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "quantity" INTEGER NOT NULL,
    "totalBought" INTEGER NOT NULL DEFAULT 0,
    "totalSold" INTEGER NOT NULL DEFAULT 0,
    "averageEntryPrice" BIGINT NOT NULL,
    "realisedPnl" BIGINT NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "type" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "quantity" INTEGER NOT NULL,
    "filledQuantity" INTEGER NOT NULL DEFAULT 0,
    "limitPrice" BIGINT,
    "averageFillPrice" BIGINT,
    "statusReason" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "positionId" TEXT,
    "instrumentId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" BIGINT NOT NULL,
    "value" BIGINT NOT NULL,
    "realisedPnl" BIGINT NOT NULL DEFAULT 0,
    "source" "TradeSource" NOT NULL DEFAULT 'MANUAL',
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "tradeId" TEXT,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "notes" TEXT,
    "status" "StrategyStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "highWaterPrice" BIGINT,
    "lastEvaluatedAt" TIMESTAMP(3),

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_simulations" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instrumentId" TEXT,
    "symbol" TEXT,
    "capital" BIGINT NOT NULL,
    "entryPrice" BIGINT NOT NULL,
    "targetPrice" BIGINT,
    "stopPrice" BIGINT,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtests" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strategyId" TEXT,
    "strategyName" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "fromTime" BIGINT NOT NULL,
    "toTime" BIGINT NOT NULL,
    "interval" TEXT NOT NULL,
    "initialCapital" BIGINT NOT NULL,
    "finalEquity" BIGINT NOT NULL,
    "totalReturn" BIGINT NOT NULL,
    "totalReturnPercent" DOUBLE PRECISION NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    "winCount" INTEGER NOT NULL,
    "lossCount" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "profitFactor" DOUBLE PRECISION,
    "maxDrawdown" BIGINT NOT NULL,
    "maxDrawdownPercent" DOUBLE PRECISION NOT NULL,
    "averageTrade" BIGINT NOT NULL,
    "bestTrade" BIGINT,
    "worstTrade" BIGINT,
    "trades" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_rules" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL DEFAULT 'CUSTOM',
    "sortOrder" INTEGER NOT NULL,
    "operator" "LogicOperator" NOT NULL DEFAULT 'AND',
    "trailPercent" DOUBLE PRECISION,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "firedAt" TIMESTAMP(3),
    "fireCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "strategy_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_conditions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "type" "ConditionType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "period" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "strategy_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_actions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "type" "ActionType" NOT NULL,
    "quantity" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "strategy_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_executions" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "ruleId" TEXT,
    "outcome" "ExecutionOutcome" NOT NULL,
    "side" "OrderSide",
    "quantity" INTEGER,
    "price" BIGINT,
    "orderId" TEXT,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE INDEX "holdings_accountId_idx" ON "holdings"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "holdings_accountId_instrumentId_key" ON "holdings"("accountId", "instrumentId");

-- CreateIndex
CREATE INDEX "positions_accountId_status_idx" ON "positions"("accountId", "status");

-- CreateIndex
CREATE INDEX "positions_accountId_instrumentId_idx" ON "positions"("accountId", "instrumentId");

-- CreateIndex
CREATE INDEX "orders_accountId_placedAt_idx" ON "orders"("accountId", "placedAt");

-- CreateIndex
CREATE INDEX "orders_accountId_status_idx" ON "orders"("accountId", "status");

-- CreateIndex
CREATE INDEX "trades_accountId_executedAt_idx" ON "trades"("accountId", "executedAt");

-- CreateIndex
CREATE INDEX "trades_accountId_instrumentId_idx" ON "trades"("accountId", "instrumentId");

-- CreateIndex
CREATE INDEX "transactions_accountId_createdAt_idx" ON "transactions"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "strategies_accountId_status_idx" ON "strategies"("accountId", "status");

-- CreateIndex
CREATE INDEX "strategies_accountId_instrumentId_idx" ON "strategies"("accountId", "instrumentId");

-- CreateIndex
CREATE INDEX "risk_simulations_accountId_createdAt_idx" ON "risk_simulations"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "backtests_accountId_createdAt_idx" ON "backtests"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "strategy_rules_strategyId_sortOrder_idx" ON "strategy_rules"("strategyId", "sortOrder");

-- CreateIndex
CREATE INDEX "strategy_conditions_ruleId_idx" ON "strategy_conditions"("ruleId");

-- CreateIndex
CREATE INDEX "strategy_actions_ruleId_idx" ON "strategy_actions"("ruleId");

-- CreateIndex
CREATE INDEX "strategy_executions_strategyId_createdAt_idx" ON "strategy_executions"("strategyId", "createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_simulations" ADD CONSTRAINT "risk_simulations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtests" ADD CONSTRAINT "backtests_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_rules" ADD CONSTRAINT "strategy_rules_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_conditions" ADD CONSTRAINT "strategy_conditions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "strategy_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_actions" ADD CONSTRAINT "strategy_actions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "strategy_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_executions" ADD CONSTRAINT "strategy_executions_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_executions" ADD CONSTRAINT "strategy_executions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "strategy_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

