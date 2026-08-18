import { PRODUCT_NAME } from "@/domain/constants";
import { cn } from "@/lib/cn";

/**
 * The brand mark: three bars at unequal heights, reading as a price column.
 *
 * Deliberately not a generic chart-arrow or candlestick glyph. It sits at the
 * same optical weight as the wordmark beside it and carries no colour of its
 * own — `currentColor` throughout, so it inherits whatever the surface needs.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cn("size-4", className)} aria-hidden>
      <rect x="2" y="4" width="3" height="12" rx="1.5" fill="currentColor" />
      <rect x="8" y="1" width="3" height="18" rx="1.5" fill="currentColor" opacity="0.45" />
      <rect x="14" y="7" width="3" height="9" rx="1.5" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

/**
 * The wordmark.
 *
 * One definition for the mark-plus-name pair, which previously existed as four
 * near-identical copies — header, sidebar, topbar, sign-in — that would have
 * drifted the moment the treatment changed.
 *
 * The treatment is entirely typographic: weight, tracking and space. No
 * gradient, no glow, no enclosing shape, and never larger than the navigation
 * around it. Restraint is what reads as expensive here; a logo competing with
 * the headline would undercut both.
 *
 * `tracking-[-0.015em]` closes the caps very slightly — enough to bind the six
 * letters into one shape, short of the crowding that tight tracking causes
 * around the K and X.
 */
export function Wordmark({
  className,
  markClassName,
  /** Hide the name below `sm`, for the cramped mobile topbar. */
  responsiveName = false,
}: {
  className?: string;
  markClassName?: string;
  responsiveName?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2.5 font-semibold", className)}>
      <BrandMark className={markClassName} />
      <span
        className={cn(
          "tracking-[-0.015em]",
          responsiveName && "sr-only sm:not-sr-only",
        )}
      >
        {PRODUCT_NAME}
      </span>
    </span>
  );
}
