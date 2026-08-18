/**
 * Strategy persistence.
 *
 * Maps between the database rows and the domain model. Server-only.
 *
 * Writes replace a strategy's rules wholesale rather than diffing them: a
 * strategy is a small, self-contained document, and reconciling added, removed
 * and reordered rules individually would be far more code and far more ways to
 * leave the tree inconsistent. The replacement happens inside a transaction so
 * a strategy is never left with half its rules.
 */

import type {
  ActionType,
  ConditionType,
  LogicOperator,
  Rule,
  RuleKind,
  Strategy,
  StrategyStatus,
} from "@/domain/strategy";
import { prisma } from "@/lib/prisma";

/** Shape accepted when creating or updating. Ids are assigned by the database. */
export interface StrategyInput {
  readonly name: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly notes: string | null;
  readonly rules: readonly RuleInput[];
}

export interface RuleInput {
  readonly kind: RuleKind;
  readonly operator: LogicOperator;
  readonly trailPercent: number | null;
  readonly enabled: boolean;
  readonly conditions: readonly { type: ConditionType; value: number; period: number | null }[];
  readonly actions: readonly { type: ActionType; quantity: number | null }[];
}

const RULE_INCLUDE = {
  rules: {
    orderBy: { sortOrder: "asc" },
    include: {
      conditions: { orderBy: { sortOrder: "asc" } },
      actions: { orderBy: { sortOrder: "asc" } },
    },
  },
} as const;

export async function listStrategies(accountId: string): Promise<readonly Strategy[]> {
  const rows = await prisma.strategy.findMany({
    where: { accountId },
    orderBy: { updatedAt: "desc" },
    include: RULE_INCLUDE,
  });

  return rows.map(toStrategy);
}

export async function getStrategy(
  accountId: string,
  strategyId: string,
): Promise<Strategy | null> {
  const row = await prisma.strategy.findFirst({
    where: { id: strategyId, accountId },
    include: RULE_INCLUDE,
  });

  return row ? toStrategy(row) : null;
}

export async function createStrategy(
  accountId: string,
  input: StrategyInput,
): Promise<Strategy> {
  const created = await prisma.strategy.create({
    data: {
      accountId,
      name: input.name,
      instrumentId: input.instrumentId,
      symbol: input.symbol,
      notes: input.notes,
      status: "DRAFT",
      rules: {
        create: input.rules.map((rule, index) => ruleCreateData(rule, index)),
      },
    },
    include: RULE_INCLUDE,
  });

  return toStrategy(created);
}

/** Replace a strategy's content. Status is changed separately. */
export async function updateStrategy(
  accountId: string,
  strategyId: string,
  input: StrategyInput,
): Promise<Strategy | null> {
  const existing = await prisma.strategy.findFirst({
    where: { id: strategyId, accountId },
    select: { id: true },
  });
  if (!existing) return null;

  const updated = await prisma.$transaction(async (tx) => {
    // Cascade deletes conditions and actions with their rules.
    await tx.strategyRule.deleteMany({ where: { strategyId } });

    return tx.strategy.update({
      where: { id: strategyId },
      data: {
        name: input.name,
        instrumentId: input.instrumentId,
        symbol: input.symbol,
        notes: input.notes,
        rules: { create: input.rules.map((rule, index) => ruleCreateData(rule, index)) },
      },
      include: RULE_INCLUDE,
    });
  });

  return toStrategy(updated);
}

export async function setStrategyStatus(
  accountId: string,
  strategyId: string,
  status: StrategyStatus,
): Promise<Strategy | null> {
  const existing = await prisma.strategy.findFirst({
    where: { id: strategyId, accountId },
    select: { id: true },
  });
  if (!existing) return null;

  const updated = await prisma.strategy.update({
    where: { id: strategyId },
    data: {
      status,
      // Stamp the lifecycle moments once, when they first happen.
      ...(status === "ACTIVE" ? { activatedAt: new Date() } : {}),
      ...(status === "COMPLETED" || status === "CANCELLED" ? { completedAt: new Date() } : {}),
    },
    include: RULE_INCLUDE,
  });

  return toStrategy(updated);
}

export async function deleteStrategy(accountId: string, strategyId: string): Promise<boolean> {
  const result = await prisma.strategy.deleteMany({ where: { id: strategyId, accountId } });
  return result.count > 0;
}

// --- mapping ---------------------------------------------------------------

function ruleCreateData(rule: RuleInput, index: number) {
  return {
    kind: rule.kind,
    sortOrder: index,
    operator: rule.operator,
    trailPercent: rule.trailPercent,
    enabled: rule.enabled,
    conditions: {
      create: rule.conditions.map((condition, order) => ({
        type: condition.type,
        value: condition.value,
        period: condition.period,
        sortOrder: order,
      })),
    },
    actions: {
      create: rule.actions.map((action, order) => ({
        type: action.type,
        quantity: action.quantity,
        sortOrder: order,
      })),
    },
  };
}

interface StrategyRow {
  id: string;
  name: string;
  instrumentId: string;
  symbol: string;
  notes: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
  completedAt: Date | null;
  rules: {
    id: string;
    kind: string;
    sortOrder: number;
    operator: string;
    trailPercent: number | null;
    enabled: boolean;
    conditions: { id: string; type: string; value: number; period: number | null }[];
    actions: { id: string; type: string; quantity: number | null }[];
  }[];
}

function toStrategy(row: StrategyRow): Strategy {
  return {
    id: row.id,
    name: row.name,
    instrumentId: row.instrumentId,
    symbol: row.symbol,
    notes: row.notes,
    status: row.status as StrategyStatus,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    activatedAt: row.activatedAt?.getTime() ?? null,
    completedAt: row.completedAt?.getTime() ?? null,
    rules: row.rules.map(
      (rule): Rule => ({
        id: rule.id,
        kind: rule.kind as RuleKind,
        order: rule.sortOrder,
        operator: rule.operator as LogicOperator,
        trailPercent: rule.trailPercent,
        enabled: rule.enabled,
        conditions: rule.conditions.map((condition) => ({
          id: condition.id,
          type: condition.type as ConditionType,
          value: condition.value,
          period: condition.period,
        })),
        actions: rule.actions.map((action) => ({
          id: action.id,
          type: action.type as ActionType,
          quantity: action.quantity,
        })),
      }),
    ),
  };
}
