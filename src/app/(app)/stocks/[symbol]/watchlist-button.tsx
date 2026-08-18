"use client";

import { useToast } from "@/components/ui/toast";
import { useWatchlist } from "@/hooks/use-watchlist";
import { cn } from "@/lib/cn";

export function WatchlistButton({
  instrumentId,
  symbol,
  className,
}: {
  instrumentId: string;
  symbol: string;
  className?: string;
}) {
  const { has, toggle } = useWatchlist();
  const { toast } = useToast();
  const watching = has(instrumentId);

  return (
    <button
      type="button"
      aria-pressed={watching}
      onClick={() => {
        // The toast reports what the store settled on, so a rejected write is
        // never announced as a success.
        void toggle(instrumentId).then((added) => {
          toast({
            title: added ? `${symbol} added to watchlist` : `${symbol} removed from watchlist`,
            tone: added ? "success" : "neutral",
            duration: 2600,
          });
        });
      }}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-[0.8125rem]",
        "transition-colors duration-200",
        watching
          ? "border-ink text-ink"
          : "border-line text-ink-secondary hover:border-line-strong hover:text-ink",
        className,
      )}
    >
      <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
        {watching ? (
          <path d="M8 2.5 9.8 6.2l4.1.6-3 2.9.7 4.1L8 11.9l-3.6 1.9.7-4.1-3-2.9 4.1-.6L8 2.5Z" fill="currentColor" />
        ) : (
          <path
            d="M8 2.5 9.8 6.2l4.1.6-3 2.9.7 4.1L8 11.9l-3.6 1.9.7-4.1-3-2.9 4.1-.6L8 2.5Z"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {watching ? "In watchlist" : "Add to watchlist"}
    </button>
  );
}
