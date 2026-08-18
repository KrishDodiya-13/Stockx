"use client";

import { AnimatedNumber } from "@/components/ui/animated-number";
import { Cell, CellGrid } from "@/components/ui/card";
import { PercentChange } from "@/components/ui/financial";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuotes } from "@/hooks/use-quote";
import { priceToRupees } from "@/lib/money";
import { INDEX_IDS, INSTRUMENT_BY_ID } from "@/services/market-data";

const formatIndexLevel = (value: number): string =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value,
  );

/**
 * The three headline indices, live.
 *
 * This is the *only* place an index appears. They are levels, not instruments:
 * there is nothing to buy, so there is no row in the stock list, no trade
 * ticket and no BUY/SELL button anywhere for them — see `isTradable` in the
 * instrument registry, which every trading surface is filtered through.
 *
 * An index with no live level renders "--". It deliberately does not fall back
 * to the last value it held or to a seeded reference price: a stale SENSEX
 * level presented as the current one is a wrong number, and a wrong number is
 * worse than an admitted gap.
 */
export function IndexStrip() {
  const { quotes, state } = useQuotes(INDEX_IDS);

  return (
    <CellGrid columns={3}>
      {INDEX_IDS.map((id) => {
        const quote = quotes.get(id);
        const instrument = INSTRUMENT_BY_ID.get(id);

        return (
          <Cell key={id}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.6875rem] font-medium tracking-[0.14em] text-ink-secondary uppercase">
                {instrument?.name ?? id}
              </span>
              {quote ? <PercentChange value={quote.changePercent} size="sm" showArrow /> : null}
            </div>

            <div className="mt-5 text-2xl font-medium tracking-[-0.03em] md:text-3xl">
              {quote ? (
                <AnimatedNumber
                  value={priceToRupees(quote.price)}
                  format={formatIndexLevel}
                  duration={0.5}
                  flash
                />
              ) : state === "loading" ? (
                <Skeleton className="h-8 w-36" />
              ) : (
                <span
                  className="tabular text-ink-tertiary"
                  title="No live level available for this index"
                >
                  --
                </span>
              )}
            </div>
            {!quote && state !== "loading" ? (
              <p className="mt-2 text-[0.6875rem] text-ink-tertiary">Level unavailable</p>
            ) : null}
          </Cell>
        );
      })}
    </CellGrid>
  );
}
