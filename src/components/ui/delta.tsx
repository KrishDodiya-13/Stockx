import { cn } from "@/lib/cn";
import { directionOf, formatPercent, type Direction } from "@/lib/format";

export const DIRECTION_TEXT: Record<Direction, string> = {
  up: "text-up",
  down: "text-down",
  flat: "text-flat",
};

/**
 * Percentage change with the direction colour applied consistently.
 *
 * Null is an unknown change, not a flat one: it prints "--" without an arrow.
 */
export function Delta({
  percent,
  className,
  showArrow = true,
}: {
  percent: number | null;
  className?: string;
  showArrow?: boolean;
}) {
  const known = percent !== null && Number.isFinite(percent);
  const direction = directionOf(percent);

  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1",
        known ? DIRECTION_TEXT[direction] : "text-ink-tertiary",
        className,
      )}
    >
      {showArrow && known && direction !== "flat" ? (
        <span aria-hidden className="text-[0.75em] leading-none">
          {direction === "up" ? "▲" : "▼"}
        </span>
      ) : null}
      {formatPercent(percent, { signed: true })}
    </span>
  );
}
