import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface EmptyStateProps {
  /** What is missing, as a short sentence — not a single word. */
  title: string;
  /** Why it is missing and what fills it. */
  description: string;
  /** The one action that resolves the emptiness, if there is one. */
  action?: ReactNode;
  /** A small mark. Kept abstract; empty states should not be cartoons. */
  icon?: ReactNode;
  className?: string;
}

/**
 * Empty state.
 *
 * An empty screen is a design surface, not an error. Every one of these says
 * what is missing, why, and what to do about it.
 */
export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-20 text-center md:py-28",
        className,
      )}
    >
      <span aria-hidden className="text-ink-tertiary">
        {icon ?? <DefaultMark />}
      </span>
      <h3 className="mt-7 max-w-sm text-lg font-medium tracking-[-0.02em]">{title}</h3>
      <p className="mt-3 max-w-sm text-[0.875rem] leading-relaxed text-ink-secondary">
        {description}
      </p>
      {action ? <div className="mt-8">{action}</div> : null}
    </div>
  );
}

/** Three bars at rest — the product mark, flattened. */
function DefaultMark() {
  return (
    <svg viewBox="0 0 40 24" className="h-6 w-10" aria-hidden>
      <rect x="0" y="11" width="10" height="2" rx="1" fill="currentColor" opacity="0.5" />
      <rect x="15" y="11" width="10" height="2" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="30" y="11" width="10" height="2" rx="1" fill="currentColor" opacity="0.15" />
    </svg>
  );
}

/**
 * The empty state for a surface whose engine is not built yet. Distinct from
 * `EmptyState` because "nothing here yet" and "not built yet" are different
 * messages, and conflating them misleads.
 */
export function ComingSoonState({
  title,
  description,
  capabilities,
  className,
}: {
  title: string;
  description: string;
  capabilities: readonly string[];
  className?: string;
}) {
  return (
    <div className={cn("py-16 md:py-24", className)}>
      <div className="max-w-xl">
        <span className="eyebrow">In development</span>
        <h3 className="mt-6 text-display-m">{title}</h3>
        <p className="mt-6 text-base leading-relaxed text-ink-secondary">{description}</p>
      </div>

      <ul className="mt-12 grid max-w-3xl gap-px border border-line bg-line sm:grid-cols-2">
        {capabilities.map((capability) => (
          <li key={capability} className="flex items-baseline gap-3 bg-base p-5">
            <span aria-hidden className="size-1 shrink-0 translate-y-[-0.15em] rounded-full bg-ink-tertiary" />
            <span className="text-[0.875rem] text-ink-secondary">{capability}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
