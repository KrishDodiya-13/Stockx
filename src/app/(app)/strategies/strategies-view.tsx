"use client";

import { useCallback, useEffect, useState } from "react";

import {
  StrategyBuilder,
  draftFrom,
  emptyDraft,
  type StrategyDraft,
} from "@/components/strategy/strategy-builder";
import { ExecutionLog } from "@/components/strategy/execution-log";
import { useStrategyRunner } from "@/components/strategy/strategy-runner-client";
import { Panel, PanelHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  STRATEGY_STATUS_LABEL,
  canTransition,
  describeStrategyLine,
  isTerminal,
  type Strategy,
  type StrategyStatus,
} from "@/domain/strategy";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { handleSessionExpiry } from "@/lib/session-expiry";

type View = "list" | "edit";

/** Actions offered per status, derived from the transition table. */
const TRANSITION_LABEL: Partial<Record<StrategyStatus, string>> = {
  ACTIVE: "Activate",
  PAUSED: "Pause",
  COMPLETED: "Mark complete",
  CANCELLED: "Cancel",
};

export function StrategiesView({ initialView = "list" }: { initialView?: View } = {}) {
  const { toast } = useToast();

  const [strategies, setStrategies] = useState<readonly Strategy[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unconfigured">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const [view, setView] = useState<View>(initialView);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StrategyDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  const hasActive = strategies.some((strategy) => strategy.status === "ACTIVE");
  // The engine only runs while there is something to run and the list is open.
  const runner = useStrategyRunner(state === "ready" && hasActive && view === "list");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/strategies", { cache: "no-store" });

      if (handleSessionExpiry(response)) return;
      const payload = (await response.json()) as {
        strategies?: Strategy[];
        error?: string;
        message?: string;
      };

      if (response.status === 503 && payload.error === "database_not_configured") {
        setState("unconfigured");
        setMessage(payload.message ?? null);
        return;
      }
      if (!response.ok) {
        setState("error");
        setMessage(payload.message ?? "Could not load strategies.");
        return;
      }

      setStrategies(payload.strategies ?? []);
      setState("ready");
    } catch {
      setState("error");
      setMessage("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const body = {
        name: draft.name,
        instrumentId: draft.instrumentId,
        notes: draft.notes || null,
        rules: draft.rules,
      };

      const response = await fetch(
        editingId ? `/api/strategies/${editingId}` : "/api/strategies",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (handleSessionExpiry(response)) return;

      const payload = (await response.json()) as { message?: string };

      if (!response.ok) {
        toast({
          title: "Could not save",
          description: payload.message ?? "The strategy was rejected.",
          tone: "error",
        });
        return;
      }

      toast({ title: editingId ? "Strategy updated" : "Strategy saved as draft", tone: "success" });
      await load();
      setView("list");
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  async function transition(strategy: Strategy, next: StrategyStatus): Promise<void> {
    const response = await fetch(`/api/strategies/${strategy.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });

    if (handleSessionExpiry(response)) return;

    const payload = (await response.json()) as {
      message?: string;
      issues?: { message: string }[];
    };

    if (!response.ok) {
      toast({
        title: "Status unchanged",
        description:
          payload.issues?.[0]?.message ?? payload.message ?? "The transition was rejected.",
        tone: "error",
      });
      return;
    }

    toast({ title: `Strategy ${STRATEGY_STATUS_LABEL[next].toLowerCase()}`, tone: "success" });
    await load();
  }

  async function remove(strategy: Strategy): Promise<void> {
    const response = await fetch(`/api/strategies/${strategy.id}`, { method: "DELETE" });

    if (handleSessionExpiry(response)) return;
    if (response.ok) {
      toast({ title: "Strategy deleted", tone: "neutral" });
      await load();
    }
  }

  // --- states --------------------------------------------------------------

  if (state === "unconfigured") {
    return (
      <Panel className="mt-10">
        <EmptyState
          title="Strategies need a database"
          description={
            message ??
            "Set DATABASE_URL and run the Prisma migration. Strategies are stored per account, so they persist across sessions."
          }
        />
      </Panel>
    );
  }

  if (state === "loading") return <SkeletonRows rows={4} className="mt-10" />;

  if (state === "error") {
    return (
      <Panel className="mt-10">
        <EmptyState
          title="Could not load your strategies"
          description={message ?? "Try refreshing the page."}
        />
      </Panel>
    );
  }

  if (view === "edit") {
    return (
      <div className="mt-10">
        <button
          type="button"
          onClick={() => {
            setView("list");
            setEditingId(null);
          }}
          className="mb-6 text-[0.8125rem] text-ink-secondary transition-colors hover:text-ink"
        >
          ← All strategies
        </button>

        <StrategyBuilder
          draft={draft}
          status={
            editingId
              ? (strategies.find((s) => s.id === editingId)?.status ?? "DRAFT")
              : "DRAFT"
          }
          onChange={setDraft}
          onSave={() => void save()}
          saving={saving}
        />
      </div>
    );
  }

  return (
    <div className="mt-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h2 className="eyebrow">
          {strategies.length} {strategies.length === 1 ? "strategy" : "strategies"}
        </h2>
        <button
          type="button"
          onClick={() => {
            setDraft(emptyDraft());
            setEditingId(null);
            setView("edit");
          }}
          className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[0.8125rem] font-medium text-ink-inverse transition-all duration-300 hover:-translate-y-px"
        >
          New strategy
        </button>
      </div>

      {strategies.length === 0 ? (
        <Panel>
          <EmptyState
            title="You haven't built a strategy yet"
            description="A strategy is a list of IF/THEN rules — an entry, one or more targets, and a stop. Build one and it saves as a draft you can review before activating."
          />
        </Panel>
      ) : (
        <ul className="space-y-4">
          {strategies.map((strategy) => (
            <li key={strategy.id}>
              <Panel>
                <PanelHeader
                  title={
                    <span className="flex flex-wrap items-center gap-3">
                      {strategy.name}
                      <StatusBadge status={strategy.status} />
                    </span>
                  }
                  description={`${strategy.symbol} · ${strategy.rules.length} ${strategy.rules.length === 1 ? "rule" : "rules"} · updated ${formatDate(strategy.updatedAt)}`}
                />

                <div className="px-5 py-4 md:px-6">
                  <ol className="space-y-1.5">
                    {strategy.rules.map((rule) => (
                      <li key={rule.id} className="text-[0.8125rem] text-ink-secondary">
                        <span className="tabular mr-3 text-[0.6875rem] text-ink-tertiary">
                          {String(rule.order + 1).padStart(2, "0")}
                        </span>
                        {describeStrategyLine(rule)}
                      </li>
                    ))}
                  </ol>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {(["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as const)
                      .filter((next) => canTransition(strategy.status, next))
                      .map((next) => (
                        <button
                          key={next}
                          type="button"
                          onClick={() => void transition(strategy, next)}
                          className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] text-ink-secondary transition-colors hover:border-ink hover:text-ink"
                        >
                          {TRANSITION_LABEL[next]}
                        </button>
                      ))}

                    <button
                      type="button"
                      onClick={() => {
                        setDraft(draftFrom(strategy));
                        setEditingId(strategy.id);
                        setView("edit");
                      }}
                      className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] text-ink-secondary transition-colors hover:border-ink hover:text-ink"
                    >
                      {strategy.status === "DRAFT" || strategy.status === "PAUSED"
                        ? "Edit"
                        : "View"}
                    </button>

                    {/*
                      COMPLETED and CANCELLED are terminal, so a finished
                      strategy can never be re-armed — that immutability is
                      deliberate, since re-running a record in place would
                      rewrite the history the DNA and replay surfaces read.

                      But "run this again" is the obvious next thought after a
                      strategy completes, and without this button the only way
                      to act on it was to retype every rule. Duplicating opens
                      the builder pre-filled and saves as a new DRAFT, leaving
                      the finished record untouched.
                    */}
                    {isTerminal(strategy.status) ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDraft({
                            ...draftFrom(strategy),
                            name: `${strategy.name} (copy)`,
                          });
                          setEditingId(null);
                          setView("edit");
                        }}
                        className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] text-ink-secondary transition-colors hover:border-ink hover:text-ink"
                      >
                        Duplicate
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => void remove(strategy)}
                      className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] text-ink-tertiary transition-colors hover:border-down hover:text-down"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}

      {hasActive || runner.executions.length > 0 ? (
        <div className="mt-6">
          <ExecutionLog executions={runner.executions} live={hasActive && runner.available} />
        </div>
      ) : null}

      <div className="mt-8 max-w-2xl space-y-2 text-xs leading-relaxed text-ink-tertiary">
        <p>
          Active strategies are evaluated roughly every {Math.round(4)} seconds{" "}
          <strong className="text-ink-secondary">while this page is open</strong>. There is no
          background worker in this build, so strategies do not run when the app is closed.
        </p>
        <p>
          Triggered rules place orders through the same paper trading engine a manual ticket uses —
          they are validated against your virtual cash and holdings, and every order is simulated
          with virtual money.
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: StrategyStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[0.625rem] font-medium tracking-[0.08em]",
        status === "ACTIVE" && "border-up/40 text-up",
        status === "DRAFT" && "border-line text-ink-tertiary",
        status === "PAUSED" && "border-accent/40 text-accent",
        status === "COMPLETED" && "border-line-strong text-ink-secondary",
        status === "CANCELLED" && "border-down/40 text-down",
      )}
    >
      {STRATEGY_STATUS_LABEL[status].toUpperCase()}
    </span>
  );
}
