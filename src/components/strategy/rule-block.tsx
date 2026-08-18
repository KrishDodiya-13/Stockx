"use client";

import {
  ACTIONS,
  ACTION_BY_TYPE,
  CONDITIONS,
  CONDITION_BY_TYPE,
  RULE_KIND_LABEL,
  type Action,
  type ActionType,
  type Condition,
  type ConditionType,
  type Rule,
  type RuleKind,
} from "@/domain/strategy";
import { Select, type SelectOption } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { priceToRupees, rupeesToPrice, type PriceE4 } from "@/lib/money";

const KIND_OPTIONS: readonly SelectOption<RuleKind>[] = (
  ["ENTRY", "TARGET", "STOP", "TRAILING_STOP", "CUSTOM"] as const
).map((kind) => ({ value: kind, label: RULE_KIND_LABEL[kind] }));

/** Conditions grouped, so the list reads by category rather than as 18 items. */
const CONDITION_OPTIONS: readonly SelectOption<ConditionType>[] = CONDITIONS.map((meta) => ({
  value: meta.type,
  label: meta.label,
  hint: `${meta.group} · ${meta.hint}`,
}));

const ACTION_OPTIONS: readonly SelectOption<ActionType>[] = ACTIONS.map((meta) => ({
  value: meta.type,
  label: meta.type === "SELL_PERCENT" ? "Sell percentage" : meta.label,
  hint: meta.hint,
}));

export interface RuleBlockProps {
  rule: Rule;
  index: number;
  total: number;
  disabled: boolean;
  onChange: (rule: Rule) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

/**
 * One IF/THEN block.
 *
 * Laid out to read as a sentence — IF <condition> AND <condition> THEN
 * <action> — because the point of a no-code builder is that the rule can be
 * checked by reading it, not by decoding a diagram.
 *
 * The block is the unit of execution order: its position in the stack is the
 * order it runs in, which is why reordering is a first-class control rather
 * than something hidden in a menu.
 */
export function RuleBlock({
  rule,
  index,
  total,
  disabled,
  onChange,
  onRemove,
  onMove,
}: RuleBlockProps) {
  const isTrailing = rule.kind === "TRAILING_STOP";

  const setCondition = (id: string, patch: Partial<Condition>): void =>
    onChange({
      ...rule,
      conditions: rule.conditions.map((condition) =>
        condition.id === id ? { ...condition, ...patch } : condition,
      ),
    });

  const setAction = (id: string, patch: Partial<Action>): void =>
    onChange({
      ...rule,
      actions: rule.actions.map((action) => (action.id === id ? { ...action, ...patch } : action)),
    });

  return (
    <li className="relative">
      {/* Connector to the next block — the visual thread of execution order. */}
      {index < total - 1 ? (
        <span aria-hidden className="absolute left-7 top-full h-4 w-px bg-line" />
      ) : null}

      <div
        className={cn(
          "border border-line bg-base transition-opacity duration-200",
          !rule.enabled && "opacity-55",
        )}
      >
        {/* --- header ---------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              rule.kind === "ENTRY" && "bg-ink",
              rule.kind === "TARGET" && "bg-up",
              (rule.kind === "STOP" || rule.kind === "TRAILING_STOP") && "bg-down",
              rule.kind === "CUSTOM" && "bg-accent",
            )}
          />
          <span className="tabular text-[0.6875rem] text-ink-tertiary">
            {String(index + 1).padStart(2, "0")}
          </span>

          <div className="w-40">
            <Select
              options={KIND_OPTIONS}
              value={rule.kind}
              onValueChange={(kind) =>
                onChange({
                  ...rule,
                  kind,
                  // A trailing stop needs a trail distance; give it a sensible
                  // default rather than leaving the rule invalid on switch.
                  trailPercent: kind === "TRAILING_STOP" ? (rule.trailPercent ?? 5) : null,
                })
              }
              disabled={disabled}
            />
          </div>

          <div className="ml-auto flex items-center gap-1">
            <IconButton
              label={`Move rule ${index + 1} earlier`}
              disabled={disabled || index === 0}
              onClick={() => onMove(-1)}
            >
              <path d="M4 8.5 7 5.5l3 3" />
            </IconButton>
            <IconButton
              label={`Move rule ${index + 1} later`}
              disabled={disabled || index === total - 1}
              onClick={() => onMove(1)}
            >
              <path d="M4 5.5 7 8.5l3-3" />
            </IconButton>
            <IconButton
              label={rule.enabled ? `Disable rule ${index + 1}` : `Enable rule ${index + 1}`}
              disabled={disabled}
              onClick={() => onChange({ ...rule, enabled: !rule.enabled })}
              pressed={!rule.enabled}
            >
              {rule.enabled ? (
                <path d="M2 7s2-3.5 5-3.5S12 7 12 7s-2 3.5-5 3.5S2 7 2 7Z" />
              ) : (
                <path d="M2.5 2.5l9 9M2 7s2-3.5 5-3.5S12 7 12 7s-2 3.5-5 3.5S2 7 2 7Z" />
              )}
            </IconButton>
            <IconButton
              label={`Remove rule ${index + 1}`}
              disabled={disabled}
              onClick={onRemove}
            >
              <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" />
            </IconButton>
          </div>
        </div>

        {/* --- IF -------------------------------------------------------- */}
        <div className="space-y-3 px-4 py-4">
          {isTrailing ? (
            <div className="flex flex-wrap items-end gap-3">
              <span className="eyebrow w-10 pb-3.5">IF</span>
              <span className="pb-3.5 text-[0.875rem] text-ink-secondary">
                Price falls
              </span>
              <div className="w-28">
                <Input
                  numeric
                  inputMode="decimal"
                  trailing="%"
                  aria-label="Trail distance"
                  value={rule.trailPercent ?? ""}
                  onChange={(event) =>
                    onChange({ ...rule, trailPercent: Number(event.target.value) || null })
                  }
                  disabled={disabled}
                />
              </div>
              <span className="pb-3.5 text-[0.875rem] text-ink-secondary">
                below the highest price since entry
              </span>
            </div>
          ) : (
            rule.conditions.map((condition, conditionIndex) => {
              const meta = CONDITION_BY_TYPE.get(condition.type);

              return (
                <div key={condition.id} className="flex flex-wrap items-end gap-3">
                  {/* The IF/AND label sits above the row on a phone, beside it
                      on a wider screen — a 2.5rem gutter is wasted width at
                      375px. */}
                  <span className="eyebrow w-full shrink-0 sm:w-10 sm:pb-3.5">
                    {conditionIndex === 0 ? "IF" : rule.operator}
                  </span>

                  {/*
                    Full width on a phone: a 13rem minimum inside a flex-wrap
                    row leaves the condition select sharing a line with its
                    value field on a 375px screen, and neither is usable.
                  */}
                  <div className="w-full sm:min-w-[13rem] sm:flex-1">
                    <Select
                      options={CONDITION_OPTIONS}
                      value={condition.type}
                      onValueChange={(type) => {
                        const next = CONDITION_BY_TYPE.get(type);
                        setCondition(condition.id, {
                          type,
                          period: next?.needsPeriod ? (next.defaultPeriod ?? 14) : null,
                        });
                      }}
                      disabled={disabled}
                    />
                  </div>

                  {meta?.needsPeriod ? (
                    <div className="w-24">
                      <Input
                        numeric
                        inputMode="numeric"
                        leading="n"
                        aria-label="Period"
                        value={condition.period ?? ""}
                        onChange={(event) =>
                          setCondition(condition.id, {
                            period: Number(event.target.value) || null,
                          })
                        }
                        disabled={disabled}
                      />
                    </div>
                  ) : null}

                  {meta && meta.type !== "MACD_CROSSES_ABOVE" && meta.type !== "MACD_CROSSES_BELOW" ? (
                    <div className="w-32">
                      <Input
                        numeric
                        inputMode="decimal"
                        leading={meta.valueKind === "price" ? "₹" : undefined}
                        trailing={meta.valueKind === "percent" ? "%" : undefined}
                        aria-label={`${meta.label} value`}
                        value={displayValue(condition, meta.valueKind)}
                        onChange={(event) =>
                          setCondition(condition.id, {
                            value: storeValue(event.target.value, meta.valueKind),
                          })
                        }
                        disabled={disabled}
                      />
                    </div>
                  ) : null}

                  {conditionIndex > 0 ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        onChange({
                          ...rule,
                          conditions: rule.conditions.filter((c) => c.id !== condition.id),
                        })
                      }
                      className="mb-3 text-[0.6875rem] text-ink-tertiary transition-colors hover:text-down disabled:opacity-40"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              );
            })
          )}

          {!isTrailing ? (
            <div className="flex flex-wrap items-center gap-3 sm:pl-[3.25rem]">
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange({
                    ...rule,
                    conditions: [
                      ...rule.conditions,
                      {
                        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        type: "PRICE_ABOVE",
                        value: rupeesToPrice(100),
                        period: null,
                      },
                    ],
                  })
                }
                className="rounded-full border border-line px-3 py-1 text-[0.6875rem] text-ink-secondary transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
              >
                + Condition
              </button>

              {rule.conditions.length > 1 ? (
                <div className="flex items-center gap-1.5">
                  {(["AND", "OR"] as const).map((operator) => (
                    <button
                      key={operator}
                      type="button"
                      disabled={disabled}
                      aria-pressed={rule.operator === operator}
                      onClick={() => onChange({ ...rule, operator })}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[0.625rem] tracking-[0.08em] transition-colors",
                        rule.operator === operator
                          ? "border-ink text-ink"
                          : "border-line text-ink-tertiary hover:text-ink-secondary",
                      )}
                    >
                      {operator}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* --- THEN ------------------------------------------------------ */}
        <div className="space-y-3 border-t border-line-subtle px-4 py-4">
          {rule.actions.map((action, actionIndex) => {
            const meta = ACTION_BY_TYPE.get(action.type);

            return (
              <div key={action.id} className="flex flex-wrap items-end gap-3">
                <span className="eyebrow w-full shrink-0 sm:w-10 sm:pb-3.5">
                  {actionIndex === 0 ? "THEN" : "AND"}
                </span>

                <div className="w-full sm:min-w-[11rem] sm:flex-1">
                  <Select
                    options={ACTION_OPTIONS}
                    value={action.type}
                    onValueChange={(type) => {
                      const next = ACTION_BY_TYPE.get(type);
                      setAction(action.id, {
                        type,
                        quantity: next?.needsQuantity ? (action.quantity ?? 1) : null,
                      });
                    }}
                    disabled={disabled}
                  />
                </div>

                {meta?.needsQuantity ? (
                  <div className="w-32">
                    <Input
                      numeric
                      inputMode="numeric"
                      trailing={meta.unit === "percent" ? "%" : "sh"}
                      aria-label={`${meta.label} quantity`}
                      value={action.quantity ?? ""}
                      onChange={(event) =>
                        setAction(action.id, { quantity: Number(event.target.value) || null })
                      }
                      disabled={disabled}
                    />
                  </div>
                ) : null}

                {actionIndex > 0 ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        ...rule,
                        actions: rule.actions.filter((a) => a.id !== action.id),
                      })
                    }
                    className="mb-3 text-[0.6875rem] text-ink-tertiary transition-colors hover:text-down disabled:opacity-40"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            );
          })}

          <div className="sm:pl-[3.25rem]">
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...rule,
                  actions: [
                    ...rule.actions,
                    {
                      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      type: "SELL_PERCENT",
                      quantity: 50,
                    },
                  ],
                })
              }
              className="rounded-full border border-line px-3 py-1 text-[0.6875rem] text-ink-secondary transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
            >
              + Action
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * Prices are stored as PriceE4 but edited in rupees; percentages and volumes
 * are stored as entered. Converting at the input boundary keeps the stored
 * value in the same units the engine evaluates.
 */
function displayValue(condition: Condition, kind: string): string | number {
  if (kind === "price") return priceToRupees(condition.value as PriceE4);
  return condition.value;
}

function storeValue(raw: string, kind: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return kind === "price" ? rupeesToPrice(Math.max(0, parsed)) : parsed;
}

function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      // `touch-target` widens the tappable area to ~44px on a coarse pointer
      // without changing the 28px visual size the desktop toolbar depends on.
      className="touch-target flex size-7 items-center justify-center rounded-full text-ink-tertiary transition-colors duration-200 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      <svg
        viewBox="0 0 14 14"
        aria-hidden
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}
