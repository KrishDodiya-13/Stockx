import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A record rendered as a card, for narrow screens.
 *
 * The alternative — a wide table inside a horizontal scroller — is the
 * definition of shrinking a desktop component: the columns still exist, the
 * user just has to drag sideways to find them, and the most important figure is
 * usually the one off-screen.
 *
 * A card promotes the two things that matter (what it is, what it did) and
 * arranges the rest as labelled pairs beneath. Same data, different shape.
 *
 * Used with `sm:hidden` alongside a `hidden sm:table` — one source of records,
 * two presentations.
 */
export function RecordCard({
  title,
  subtitle,
  value,
  valueTone,
  meta,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** The headline figure — the reason someone is scanning this list. */
  value?: ReactNode;
  valueTone?: "up" | "down";
  /** Secondary label/value pairs. */
  meta?: readonly { label: string; value: ReactNode }[];
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-line-subtle px-5 py-4 last:border-b-0", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-[0.9375rem] font-medium">{title}</div>
          {subtitle ? (
            <div className="mt-0.5 truncate text-[0.6875rem] text-ink-tertiary">{subtitle}</div>
          ) : null}
        </div>

        {value ? (
          <div
            className={cn(
              "tabular shrink-0 text-right text-[0.9375rem]",
              valueTone === "up" && "text-up",
              valueTone === "down" && "text-down",
            )}
          >
            {value}
          </div>
        ) : null}
      </div>

      {meta && meta.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          {meta.map((item) => (
            <div key={item.label} className="flex items-baseline justify-between gap-2">
              <dt className="text-[0.6875rem] text-ink-tertiary">{item.label}</dt>
              <dd className="tabular text-[0.75rem]">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/**
 * Wrapper that swaps a table for cards below the `sm` breakpoint.
 *
 * Both children render the same records; only one is in the accessibility tree
 * at a time, because `hidden` removes the other entirely rather than merely
 * hiding it visually — a screen reader must not encounter both.
 */
export function ResponsiveRecords({
  table,
  cards,
}: {
  table: ReactNode;
  cards: ReactNode;
}) {
  return (
    <>
      <div className="hidden sm:block">{table}</div>
      <div className="sm:hidden">{cards}</div>
    </>
  );
}
