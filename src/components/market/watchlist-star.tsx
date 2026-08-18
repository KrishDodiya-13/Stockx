"use client";

import { useToast } from "@/components/ui/toast";
import { useWatchlist } from "@/hooks/use-watchlist";
import { cn } from "@/lib/cn";

/**
 * The compact star, for use inside a table row.
 *
 * The same state as the full `WatchlistButton` on the detail page — both read
 * the one store, so starring here lights the star there without a reload.
 *
 * `stopPropagation` matters: these sit inside rows that are themselves links to
 * the instrument, and starring should not navigate away from the list you are
 * curating.
 */
export function WatchlistStar({
  instrumentId,
  symbol,
  className,
}: {
  instrumentId: string;
  symbol: string;
  className?: string;
}) {
  const { has, toggle, loaded } = useWatchlist();
  const { toast } = useToast();
  const watching = has(instrumentId);

  return (
    <button
      type="button"
      aria-pressed={watching}
      aria-label={watching ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      title={watching ? "In your watchlist" : "Add to watchlist"}
      // Disabled until the list is known, so the first click cannot toggle
      // against a state that has not loaded yet.
      disabled={!loaded}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggle(instrumentId).then((added) => {
          toast({
            title: added ? `${symbol} added to watchlist` : `${symbol} removed from watchlist`,
            tone: added ? "success" : "neutral",
            duration: 2200,
          });
        });
      }}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full",
        "transition-colors duration-200 disabled:opacity-40",
        watching ? "text-accent" : "text-ink-tertiary hover:text-ink",
        className,
      )}
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden
        className="size-4"
        fill={watching ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <path
          d="M8 2.5 9.8 6.2l4.1.6-3 2.9.7 4.1L8 11.9l-3.6 1.9.7-4.1-3-2.9 4.1-.6L8 2.5Z"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
