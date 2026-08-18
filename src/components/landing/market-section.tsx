"use client";

import { useMemo } from "react";

import { AnimatedNumber } from "@/components/ui/animated-number";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { Delta, DIRECTION_TEXT } from "@/components/ui/delta";
import { Reveal, SplitLines } from "@/components/ui/reveal";
import { useQuotes } from "@/hooks/use-quote";
import { cn } from "@/lib/cn";
import { directionOf, formatPrice, formatVolume } from "@/lib/format";
import { priceToRupees } from "@/lib/money";
import { INDEX_IDS, INSTRUMENT_BY_ID, instrumentId } from "@/services/market-data";

const MOVERS = ["RELIANCE", "TATAMOTORS", "INFY", "SBIN", "ADANIENT", "TATASTEEL"].map((symbol) =>
  instrumentId("NSE", symbol),
);

/**
 * A live slice of the Market Pulse surface. Prices are driven by the same
 * MarketDataService the product uses, so this is the real component behaviour
 * rather than a screenshot of it.
 */
export function MarketSection() {
  const ids = useMemo(() => [...INDEX_IDS, ...MOVERS], []);
  const { quotes, state } = useQuotes(ids);

  return (
    <section id="market" className="gutter border-t border-line-subtle py-32 md:py-44">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <Reveal variant="mask">
          <p className="eyebrow mb-6">Market Pulse</p>
          <SplitLines lines={["A market that", "feels alive."]} className="text-display-l" />
        </Reveal>
        <DataSourceBadge source="simulated" />
      </div>

      <div className="mt-16 grid gap-px border border-line bg-line md:mt-20 md:grid-cols-3">
        {INDEX_IDS.map((id) => {
          const quote = quotes.get(id);
          const instrument = INSTRUMENT_BY_ID.get(id);

          return (
            <div key={id} className="bg-base p-6 md:p-8">
              <div className="flex items-center justify-between">
                <span className="text-[0.6875rem] font-medium tracking-[0.14em] text-ink-secondary uppercase">
                  {instrument?.name ?? id}
                </span>
                {quote ? <Delta percent={quote.changePercent} className="text-[0.6875rem]" /> : null}
              </div>

              <div className="mt-6 text-[2rem] font-medium tracking-[-0.03em] md:text-[2.75rem]">
                {quote ? (
                  <AnimatedNumber
                    value={priceToRupees(quote.price)}
                    format={(value) =>
                      new Intl.NumberFormat("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(value)
                    }
                    duration={0.5}
                    flash
                  />
                ) : (
                  <Skeleton className="h-10 w-40" pulse={state === "loading"} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-px grid gap-px border border-t-0 border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {MOVERS.map((id) => {
          const quote = quotes.get(id);
          const instrument = INSTRUMENT_BY_ID.get(id);
          const direction = quote ? directionOf(quote.changePercent) : "flat";

          return (
            <div key={id} className="group relative bg-base p-6">
              {/* The only place colour bleeds into a surface. */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-0 top-0 h-px transition-opacity duration-500",
                  direction === "up" ? "bg-up" : direction === "down" ? "bg-down" : "bg-transparent",
                )}
              />
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{instrument?.symbol ?? id}</p>
                  <p className="mt-1 truncate text-xs text-ink-tertiary">{instrument?.name}</p>
                </div>
                {quote ? (
                  <div className="text-right">
                    <p className={cn("tabular text-base", DIRECTION_TEXT[direction])}>
                      {formatPrice(quote.price)}
                    </p>
                    <Delta percent={quote.changePercent} className="mt-1 text-[0.6875rem]" showArrow={false} />
                  </div>
                ) : (
                  <Skeleton className="h-8 w-24" pulse={state === "loading"} />
                )}
              </div>

              <div className="mt-5 flex items-center justify-between text-[0.6875rem] text-ink-tertiary">
                <span>Volume</span>
                <span className="tabular">{quote ? formatVolume(quote.volume) : "—"}</span>
              </div>
            </div>
          );
        })}
      </div>

      {state === "error" ? (
        <p className="mt-6 text-sm text-down">
          Market data is unavailable right now. Prices will resume when the feed reconnects.
        </p>
      ) : null}
    </section>
  );
}

function Skeleton({ className, pulse }: { className?: string; pulse: boolean }) {
  return <span className={cn("block rounded-sm bg-line", pulse && "animate-pulse", className)} />;
}
