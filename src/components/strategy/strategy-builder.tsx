"use client";

import { useMemo, useState } from "react";

import { RuleBlock } from "@/components/strategy/rule-block";
import { Select } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { Panel, PanelHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import {
  isEditable,
  type Rule,
  type RuleKind,
  type Strategy,
  type StrategyStatus,
} from "@/domain/strategy";
import { validateStrategy } from "@/services/strategy/strategy-engine";
import { cn } from "@/lib/cn";
import { EQUITY_OPTIONS, INSTRUMENT_SEARCH_PLACEHOLDER } from "@/lib/instrument-options";
import { rupeesToPrice } from "@/lib/money";

const SYMBOL_OPTIONS = EQUITY_OPTIONS;

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${Date.now()}-${sequence++}`;

/** A starting rule for each kind, so a new block is immediately meaningful. */
function makeRule(kind: RuleKind, order: number): Rule {
  const base = {
    id: nextId("r"),
    kind,
    order,
    operator: "AND" as const,
    enabled: true,
    trailPercent: kind === "TRAILING_STOP" ? 5 : null,
  };

  if (kind === "TRAILING_STOP") {
    return { ...base, conditions: [], actions: [{ id: nextId("a"), type: "SELL_ALL", quantity: null }] };
  }

  if (kind === "STOP") {
    return {
      ...base,
      conditions: [{ id: nextId("c"), type: "PRICE_BELOW", value: rupeesToPrice(97), period: null }],
      actions: [{ id: nextId("a"), type: "SELL_ALL", quantity: null }],
    };
  }

  if (kind === "TARGET") {
    return {
      ...base,
      conditions: [{ id: nextId("c"), type: "PRICE_ABOVE", value: rupeesToPrice(102), period: null }],
      actions: [{ id: nextId("a"), type: "SELL_PERCENT", quantity: 50 }],
    };
  }

  return {
    ...base,
    conditions: [{ id: nextId("c"), type: "PRICE_ABOVE", value: rupeesToPrice(100), period: null }],
    actions: [{ id: nextId("a"), type: kind === "ENTRY" ? "BUY" : "SELL", quantity: 100 }],
  };
}

/** The example from the specification, as a one-click starting point. */
function exampleRules(): Rule[] {
  return [
    {
      id: nextId("r"), kind: "ENTRY", order: 0, operator: "AND", enabled: true, trailPercent: null,
      conditions: [{ id: nextId("c"), type: "PRICE_REACHES", value: rupeesToPrice(100), period: null }],
      actions: [{ id: nextId("a"), type: "BUY", quantity: 100 }],
    },
    {
      id: nextId("r"), kind: "TARGET", order: 1, operator: "AND", enabled: true, trailPercent: null,
      conditions: [{ id: nextId("c"), type: "PRICE_ABOVE", value: rupeesToPrice(102), period: null }],
      actions: [{ id: nextId("a"), type: "SELL", quantity: 50 }],
    },
    {
      id: nextId("r"), kind: "TARGET", order: 2, operator: "AND", enabled: true, trailPercent: null,
      conditions: [{ id: nextId("c"), type: "PRICE_ABOVE", value: rupeesToPrice(105), period: null }],
      actions: [{ id: nextId("a"), type: "SELL", quantity: 50 }],
    },
    {
      id: nextId("r"), kind: "STOP", order: 3, operator: "AND", enabled: true, trailPercent: null,
      conditions: [{ id: nextId("c"), type: "PRICE_BELOW", value: rupeesToPrice(97), period: null }],
      actions: [{ id: nextId("a"), type: "SELL_ALL", quantity: null }],
    },
  ];
}

export interface StrategyDraft {
  name: string;
  instrumentId: string;
  notes: string;
  rules: Rule[];
}

export function emptyDraft(): StrategyDraft {
  return {
    name: "",
    instrumentId: SYMBOL_OPTIONS[0]?.value ?? "",
    notes: "",
    rules: [makeRule("ENTRY", 0)],
  };
}

export function draftFrom(strategy: Strategy): StrategyDraft {
  return {
    name: strategy.name,
    instrumentId: strategy.instrumentId,
    notes: strategy.notes ?? "",
    rules: [...strategy.rules],
  };
}

/**
 * The strategy builder.
 *
 * A vertical stack of IF/THEN blocks rather than a free-form node canvas. In a
 * trading plan the single most important fact is *what runs first*, and a stack
 * makes execution order the primary axis of the layout; a graph would bury it
 * in edge routing and demand manual arrangement for no analytical gain.
 *
 * Validation runs live from the same `validateStrategy` the API enforces on
 * activation, so the builder can never report a strategy as sound that the
 * server would then reject.
 */
export function StrategyBuilder({
  draft,
  status,
  onChange,
  onSave,
  saving,
}: {
  draft: StrategyDraft;
  status: StrategyStatus;
  onChange: (draft: StrategyDraft) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const { toast } = useToast();
  const [showIssues, setShowIssues] = useState(true);
  const locked = !isEditable(status);

  const validation = useMemo(
    () => validateStrategy({ rules: draft.rules }),
    [draft.rules],
  );

  const errors = validation.issues.filter((issue) => issue.severity === "error");
  const warnings = validation.issues.filter((issue) => issue.severity === "warning");

  const setRules = (rules: Rule[]): void =>
    onChange({ ...draft, rules: rules.map((rule, index) => ({ ...rule, order: index })) });

  const addRule = (kind: RuleKind): void => {
    if (locked) return;
    setRules([...draft.rules, makeRule(kind, draft.rules.length)]);
  };

  const moveRule = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= draft.rules.length) return;

    const next = [...draft.rules];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    setRules(next);
  };

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader
          title="Strategy"
          description={locked ? `A ${status.toLowerCase()} strategy cannot be edited` : undefined}
        />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 md:px-6">
          <Input
            label="Name"
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            placeholder="Momentum breakout"
            disabled={locked}
          />
          <Select
            label="Instrument"
            options={SYMBOL_OPTIONS}
            value={draft.instrumentId}
            onValueChange={(instrumentId) => onChange({ ...draft, instrumentId })}
            disabled={locked}
            searchable
            searchPlaceholder={INSTRUMENT_SEARCH_PLACEHOLDER}
            emptyMessage="No instruments found"
          />
        </div>
      </Panel>

      {/* --- rule stack ----------------------------------------------------- */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="eyebrow">Rules — run top to bottom</h2>
          {draft.rules.length === 0 && !locked ? (
            <button
              type="button"
              onClick={() => setRules(exampleRules())}
              className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] text-ink-secondary transition-colors hover:border-ink hover:text-ink"
            >
              Start from the worked example
            </button>
          ) : null}
        </div>

        <ol className="space-y-4">
          {draft.rules.map((rule, index) => (
            <RuleBlock
              key={rule.id}
              rule={rule}
              index={index}
              total={draft.rules.length}
              disabled={locked}
              onChange={(next) =>
                setRules(draft.rules.map((r) => (r.id === rule.id ? next : r)))
              }
              onRemove={() => setRules(draft.rules.filter((r) => r.id !== rule.id))}
              onMove={(direction) => moveRule(index, direction)}
            />
          ))}
        </ol>

        {!locked ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {(["ENTRY", "TARGET", "STOP", "TRAILING_STOP", "CUSTOM"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => addRule(kind)}
                className="rounded-full border border-line px-3.5 py-1.5 text-[0.75rem] text-ink-secondary transition-colors duration-200 hover:border-ink hover:text-ink"
              >
                + {kind === "TRAILING_STOP" ? "Trailing stop" : kind.charAt(0) + kind.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* --- validation ----------------------------------------------------- */}
      {validation.issues.length > 0 && showIssues ? (
        <Panel>
          <PanelHeader
            title={errors.length > 0 ? "Issues to resolve" : "Worth checking"}
            description={
              errors.length > 0
                ? "These must be fixed before the strategy can be activated"
                : "These do not block activation"
            }
            action={
              <button
                type="button"
                onClick={() => setShowIssues(false)}
                className="text-[0.6875rem] text-ink-tertiary hover:text-ink"
              >
                Hide
              </button>
            }
          />
          <ul className="px-5 py-4 md:px-6">
            {[...errors, ...warnings].map((issue, index) => (
              <li key={`${issue.code}-${index}`} className="flex gap-3 py-2 text-[0.875rem]">
                <span
                  aria-hidden
                  className={cn(
                    "mt-[0.5em] size-1 shrink-0 rounded-full",
                    issue.severity === "error" ? "bg-down" : "bg-accent",
                  )}
                />
                <span className="text-ink-secondary">
                  {issue.message}
                  <span className="ml-2 text-[0.6875rem] uppercase tracking-[0.1em] text-ink-tertiary">
                    {issue.severity}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {!locked ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving || draft.name.trim().length === 0}
            onClick={() => {
              if (draft.name.trim().length === 0) {
                toast({ title: "Give the strategy a name first", tone: "warning" });
                return;
              }
              onSave();
            }}
            className={cn(
              "inline-flex h-11 items-center rounded-full bg-ink px-6 text-sm font-medium text-ink-inverse",
              "transition-all duration-300 hover:-translate-y-px disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {saving ? "Saving…" : "Save strategy"}
          </button>

          <span className="text-[0.75rem] text-ink-tertiary">
            Saved as a draft — activating is a separate step
          </span>
        </div>
      ) : null}
    </div>
  );
}
