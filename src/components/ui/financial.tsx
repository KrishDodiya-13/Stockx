import type { ReactNode } from "react";

import { Cell } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import {
  directionOf,
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatQuantity,
  type Direction,
} from "@/lib/format";
import type { Paise, PriceE4 } from "@/lib/money";

/**
 * Financial number components.
 *
 * Every figure on every screen renders through one of these. Two properties
 * they guarantee that ad-hoc markup does not:
 *
 *  - Tabular figures, so digits never shift horizontally as values update.
 *  - One mapping from sign to colour, so green always means the same thing.
 */

export const DIRECTION_CLASS: Record<Direction, string> = {
  up: "text-up",
  down: "text-down",
  flat: "text-ink",
};

type NumberSize = "sm" | "md" | "lg" | "xl" | "display";

const SIZE_CLASS: Record<NumberSize, string> = {
  sm: "text-[0.8125rem]",
  md: "text-[0.9375rem]",
  lg: "text-xl md:text-2xl",
  xl: "text-3xl md:text-4xl",
  display: "text-numeric-xl font-medium",
};

/** A rupee amount. Colours by sign only when `signed` is set. */
export function Money({
  value,
  size = "md",
  signed = false,
  whole = false,
  compact = false,
  className,
}: {
  value: Paise;
  size?: NumberSize;
  /** Colour by sign and force a leading +/−. For P&L, not for balances. */
  signed?: boolean;
  whole?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const text = compact ? formatCompactCurrency(value) : formatCurrency(value, { whole, signed });

  return (
    <span
      className={cn(
        "tabular",
        SIZE_CLASS[size],
        signed && DIRECTION_CLASS[directionOf(value)],
        className,
      )}
    >
      {signed && value > 0 && compact ? "+" : ""}
      {text}
    </span>
  );
}

/** A per-share price. A null value — not carried by the feed — shows "--". */
export function Price({
  value,
  size = "md",
  direction,
  className,
}: {
  value: PriceE4 | null;
  size?: NumberSize;
  /** Colour by an externally known direction (e.g. the day's change). */
  direction?: Direction;
  className?: string;
}) {
  return (
    <span
      className={cn("tabular", SIZE_CLASS[size], direction && DIRECTION_CLASS[direction], className)}
    >
      {formatPrice(value)}
    </span>
  );
}

/**
 * A percentage change, always signed and always coloured.
 *
 * A null value is a change the market data does not carry — an instrument with
 * no previous close — and renders as "--" in the neutral colour, with no
 * arrow. It must never be coalesced to 0 by a caller: "flat" is a claim about
 * the market, and this component would state it in green-or-red typography as
 * though it had been measured.
 */
export function PercentChange({
  value,
  size = "md",
  showArrow = false,
  className,
}: {
  value: number | null;
  size?: NumberSize;
  showArrow?: boolean;
  className?: string;
}) {
  const known = value !== null && Number.isFinite(value);
  const direction = directionOf(value);

  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1",
        SIZE_CLASS[size],
        known ? DIRECTION_CLASS[direction] : "text-ink-tertiary",
        className,
      )}
      title={known ? undefined : "No previous close available for this instrument"}
    >
      {showArrow && known && direction !== "flat" ? (
        <span aria-hidden className="text-[0.7em] leading-none">
          {direction === "up" ? "▲" : "▼"}
        </span>
      ) : null}
      {formatPercent(value, { signed: true })}
    </span>
  );
}

/** A share count. */
export function Quantity({ value, className }: { value: number; className?: string }) {
  return <span className={cn("tabular", className)}>{formatQuantity(value)}</span>;
}

/**
 * A labelled figure — the standard readout for portfolio value, cash, P&L and
 * every other headline number.
 */
export function StatTile({
  label,
  value,
  sub,
  loading = false,
  className,
}: {
  label: string;
  /** Pass a `Money` / `Price` / `PercentChange` element. */
  value: ReactNode;
  sub?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <Cell className={className}>
      <p className="eyebrow">{label}</p>
      <div className="mt-3.5">
        {loading ? <Skeleton className="h-7 w-32" /> : value}
      </div>
      {sub && !loading ? (
        <p className="mt-2 text-[0.6875rem] text-ink-tertiary">{sub}</p>
      ) : null}
    </Cell>
  );
}
