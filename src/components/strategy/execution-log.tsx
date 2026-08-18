"use client";

import { AnimatePresence, motion } from "framer-motion";

import type { ExecutionRecord } from "@/components/strategy/strategy-runner-client";
import { Panel, PanelHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { priceToRupees, type PriceE4 } from "@/lib/money";

const OUTCOME_STYLE: Record<ExecutionRecord["outcome"], string> = {
  EXECUTED: "border-up/40 text-up",
  REJECTED: "border-down/40 text-down",
  SKIPPED: "border-line text-ink-tertiary",
  INFO: "border-accent/40 text-accent",
};

/**
 * The execution log.
 *
 * Shows every attempt, not only the successful ones — a rule that fired but
 * whose order was refused for insufficient cash is precisely what a user needs
 * to see, and hiding it would make the strategy look as though it never
 * triggered at all.
 *
 * New entries animate in so a trigger is noticeable without the page jumping.
 * The animation is entrance-only and skipped under reduced motion.
 */
export function ExecutionLog({
  executions,
  live,
}: {
  executions: readonly ExecutionRecord[];
  live: boolean;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <Panel>
      <PanelHeader
        title="Execution log"
        description="Every rule trigger, including orders that were refused"
        action={
          live ? (
            <span className="flex items-center gap-2 text-[0.625rem] uppercase tracking-[0.14em] text-ink-tertiary">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-up" />
              Watching
            </span>
          ) : null
        }
      />

      {executions.length === 0 ? (
        <EmptyState
          title="Nothing has triggered yet"
          description="When an active strategy's conditions are met, the rule and the order it produced appear here."
          className="py-12"
        />
      ) : (
        <ul aria-live="polite" aria-relevant="additions">
          <AnimatePresence initial={false}>
            {executions.map((execution) => (
              <motion.li
                key={execution.id}
                layout={!reducedMotion}
                initial={reducedMotion ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="border-b border-line-subtle px-5 py-3.5 last:border-b-0 md:px-6"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={cn(
                      "inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[0.625rem] font-medium tracking-[0.08em]",
                      OUTCOME_STYLE[execution.outcome],
                    )}
                  >
                    {execution.outcome}
                  </span>

                  <span className="text-[0.875rem] font-medium">{execution.strategyName}</span>
                  <span className="text-[0.75rem] text-ink-tertiary">{execution.symbol}</span>

                  <span className="tabular ml-auto text-[0.6875rem] text-ink-tertiary">
                    {formatTime(execution.createdAt)}
                  </span>
                </div>

                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-secondary">
                  {execution.detail}
                </p>

                {execution.price !== null && execution.quantity !== null ? (
                  <p className="tabular mt-1 text-[0.6875rem] text-ink-tertiary">
                    {execution.side} {execution.quantity} @ ₹
                    {priceToRupees(execution.price as PriceE4).toFixed(2)}
                  </p>
                ) : null}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}
