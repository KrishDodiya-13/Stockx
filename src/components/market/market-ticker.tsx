"use client";

import { useMemo } from "react";

import { useQuotes } from "@/hooks/use-quote";
import { cn } from "@/lib/cn";
import { directionOf, formatPercent, formatPrice } from "@/lib/format";
import { DIRECTION_TEXT } from "@/components/ui/delta";
import { priceToRupees } from "@/lib/money";
import { INSTRUMENT_BY_ID } from "@/services/market-data";

const levelFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface MarketTickerProps {
  instrumentIds: readonly string[];
  className?: string;
  /** Seconds for one full loop. Longer = calmer. */
  durationSeconds?: number;
}

/**
 * Continuously scrolling price strip.
 *
 * The track is rendered twice and translated -50%, which loops seamlessly
 * without JS measuring anything. Hovering pauses it so a price can be read.
 *
 * An index is printed as a level, not as a currency amount. "₹81,724.60" for
 * SENSEX is simply wrong — an index has no unit and nothing is priced in it —
 * and it was the visible symptom of indices being carried through this strip
 * as though they were shares.
 */
export function MarketTicker({
  instrumentIds,
  className,
  durationSeconds = 70,
}: MarketTickerProps) {
  const ids = useMemo(() => instrumentIds, [instrumentIds]);
  const { quotes, state } = useQuotes(ids);

  const items = ids.map((id) => ({
    id,
    instrument: INSTRUMENT_BY_ID.get(id),
    quote: quotes.get(id) ?? null,
  }));

  return (
    <div
      className={cn("marquee relative overflow-hidden", className)}
      // The strip is decoration; the same prices are available as real content
      // elsewhere on the page.
      aria-hidden
    >
      <div
        className="marquee-track flex w-max"
        style={{ ["--marquee-duration" as string]: `${durationSeconds}s` }}
      >
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0">
            {items.map(({ id, instrument, quote }) => (
              <div
                key={`${copy}-${id}`}
                className="flex items-baseline gap-2.5 border-r border-line-subtle px-6 py-3 whitespace-nowrap"
              >
                <span className="text-[0.6875rem] font-medium tracking-[0.08em] text-ink-secondary">
                  {instrument?.symbol ?? id}
                </span>
                {quote ? (
                  <>
                    <span className="tabular text-[0.8125rem] text-ink">
                      {instrument?.kind === "index"
                        ? levelFormatter.format(priceToRupees(quote.price))
                        : formatPrice(quote.price)}
                    </span>
                    <span
                      className={cn(
                        "tabular text-[0.6875rem]",
                        DIRECTION_TEXT[directionOf(quote.changePercent)],
                      )}
                    >
                      {formatPercent(quote.changePercent, { signed: true })}
                    </span>
                  </>
                ) : state === "loading" ? (
                  <span className="h-3 w-16 animate-pulse rounded-sm bg-line" />
                ) : (
                  // No live value: say so, rather than hold a bar that reads as
                  // "still loading" indefinitely.
                  <span className="tabular text-[0.8125rem] text-ink-tertiary">--</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Fade the strip into the page rather than cutting it off. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-base to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-base to-transparent" />
    </div>
  );
}
