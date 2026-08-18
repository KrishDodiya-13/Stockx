"use client";

import Link from "next/link";

import { Sparkline } from "@/components/market/sparkline";
import { WatchlistStar } from "@/components/market/watchlist-star";
import { PercentChange, Price } from "@/components/ui/financial";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveRecords } from "@/components/ui/record-list";
import { useQuotes } from "@/hooks/use-quote";
import { cn } from "@/lib/cn";
import { stockRoute } from "@/lib/routes";
import { directionOf, formatVolume } from "@/lib/format";
import { INSTRUMENT_BY_ID } from "@/services/market-data";

interface QuoteTableProps {
  instrumentIds: readonly string[];
  /** Show the traded-volume column. Hidden on narrow surfaces regardless. */
  showVolume?: boolean;
  /** Show a mini price chart per row. */
  showSparkline?: boolean;
  /** Show the star that adds or removes the row from the user's watchlist. */
  showWatchlistStar?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

/**
 * A live price list.
 *
 * Rendered as a real `<table>` so screen readers announce row and column
 * relationships; the visual grid is hairlines rather than zebra striping.
 */
export function QuoteTable({
  instrumentIds,
  showVolume = true,
  showSparkline = false,
  showWatchlistStar = false,
  emptyTitle = "Nothing to show here yet",
  emptyDescription = "Add instruments to see live prices.",
  className,
}: QuoteTableProps) {
  const { quotes, state } = useQuotes(instrumentIds);

  if (instrumentIds.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  if (state === "loading" && quotes.size === 0) {
    return <SkeletonRows rows={Math.min(instrumentIds.length, 6)} className={cn("px-5", className)} />;
  }

  return (
    <ResponsiveRecords
      cards={
        <ul>
          {instrumentIds.map((id) => {
            const quote = quotes.get(id);
            const instrument = INSTRUMENT_BY_ID.get(id);
            const direction = quote ? directionOf(quote.changePercent) : "flat";

            return (
              <li key={id} className="relative">
                {showWatchlistStar ? (
                  // Positioned rather than nested: the whole card is one link,
                  // and a button inside an anchor is invalid and unclickable.
                  <span className="absolute right-4 top-1/2 z-10 -translate-y-1/2">
                    <WatchlistStar instrumentId={id} symbol={instrument?.symbol ?? id} />
                  </span>
                ) : null}
                <Link href={stockRoute(instrument?.symbol ?? "")} className="block row-hover">
                  {/*
                    A price list on a phone is scanned, not studied: symbol,
                    price, direction. Volume and the sparkline drop away rather
                    than being pushed off the side of a scrolling table.
                  */}
                  <div
                    className={cn(
                      "flex items-center justify-between gap-4 border-b border-line-subtle px-5 py-3.5 last:border-b-0",
                      showWatchlistStar && "pr-14",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[0.9375rem] font-medium">
                        {instrument?.symbol ?? id}
                      </span>
                      <span className="mt-0.5 block truncate text-[0.6875rem] text-ink-tertiary">
                        {instrument?.name}
                      </span>
                    </span>

                    <span className="flex shrink-0 flex-col items-end">
                      {quote ? (
                        <>
                          <Price value={quote.price} size="md" direction={direction} />
                          <PercentChange
                            value={quote.changePercent}
                            size="sm"
                            className="mt-0.5 text-[0.75rem]"
                          />
                        </>
                      ) : (
                        <span className="text-[0.8125rem] text-ink-tertiary">—</span>
                      )}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      }
      table={
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[34rem] border-collapse text-left">
        <caption className="sr-only">
          Live simulated prices. Values update continuously.
        </caption>
        <thead>
          <tr className="border-b border-line-subtle">
            {showWatchlistStar ? (
              <Th className="w-10 pl-5 md:pl-6">
                <span className="sr-only">Watchlist</span>
              </Th>
            ) : null}
            <Th className={showWatchlistStar ? "" : "pl-5 md:pl-6"}>Instrument</Th>
            {showSparkline ? (
              <Th align="right" className="hidden sm:table-cell">
                Trend
              </Th>
            ) : null}
            <Th align="right">Price</Th>
            <Th align="right">Change</Th>
            {showVolume ? <Th align="right" className="hidden pr-5 sm:table-cell md:pr-6">Volume</Th> : null}
          </tr>
        </thead>
        <tbody>
          {instrumentIds.map((id) => {
            const quote = quotes.get(id);
            const instrument = INSTRUMENT_BY_ID.get(id);
            const direction = quote ? directionOf(quote.changePercent) : "flat";

            return (
              <tr
                key={id}
                className="border-b border-line-subtle transition-colors duration-200 last:border-b-0 row-hover"
              >
                {showWatchlistStar ? (
                  <td className="py-3.5 pl-5 md:pl-6">
                    <WatchlistStar instrumentId={id} symbol={instrument?.symbol ?? id} />
                  </td>
                ) : null}
                <td className={cn("py-3.5", !showWatchlistStar && "pl-5 md:pl-6")}>
                  <Link
                    href={stockRoute(instrument?.symbol ?? "")}
                    className="block min-w-0"
                  >
                    <span className="block truncate text-[0.875rem] font-medium">
                      {instrument?.symbol ?? id}
                    </span>
                    <span className="mt-0.5 block truncate text-[0.6875rem] text-ink-tertiary">
                      {instrument?.name}
                    </span>
                  </Link>
                </td>
                {showSparkline ? (
                  <td className="hidden py-3.5 text-right sm:table-cell">
                    <Sparkline
                      instrumentId={id}
                      changePercent={quote?.changePercent}
                      width={72}
                      height={22}
                      className="ml-auto"
                    />
                  </td>
                ) : null}
                <td className="py-3.5 text-right">
                  {quote ? <Price value={quote.price} size="sm" direction={direction} /> : "—"}
                </td>
                <td className="py-3.5 text-right">
                  {quote ? <PercentChange value={quote.changePercent} size="sm" /> : "—"}
                </td>
                {showVolume ? (
                  <td className="tabular hidden py-3.5 pr-5 text-right text-[0.8125rem] text-ink-secondary sm:table-cell md:pr-6">
                    {quote ? formatVolume(quote.volume) : "—"}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
      }
    />
  );
}

function Th({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "eyebrow py-3 font-medium",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}
