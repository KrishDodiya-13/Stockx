"use client";

import { useDeferredValue, useMemo, useState } from "react";

import { QuoteTable } from "@/components/market/quote-table";
import { Panel, PanelHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/dropdown";
import { SECTORS, type Sector } from "@/domain/market";
import { useWatchlist } from "@/hooks/use-watchlist";
import { EQUITY_INSTRUMENTS } from "@/services/market-data";

type SectorFilter = Sector | "all";

const SECTOR_OPTIONS: readonly SelectOption<SectorFilter>[] = [
  { value: "all", label: "All sectors" },
  ...SECTORS.map((sector) => ({ value: sector as SectorFilter, label: sector })),
];

/*
  The tradable list.

  Indices are absent by construction, not by a filter that could be forgotten:
  the registry hands out equities and indices separately, and this page asks
  for equities. SENSEX, NIFTY 50 and NIFTY BANK appear only in the dashboard's
  market strip.
*/
const EQUITIES = EQUITY_INSTRUMENTS;

/**
 * Instrument browser.
 *
 * Filtering runs against the local instrument master, which is small enough to
 * search synchronously. `useDeferredValue` keeps typing responsive by letting
 * React render the input ahead of the (heavier) live price table.
 *
 * The deep-link symbol arrives as a prop read on the server rather than via
 * `useSearchParams`. Reading it in the client would opt this whole subtree out
 * of server rendering, leaving the page as a skeleton until JS loads.
 */
export function StockBrowser({ initialSymbol = "" }: { initialSymbol?: string }) {
  const [query, setQuery] = useState(initialSymbol);
  const [sector, setSector] = useState<SectorFilter>("all");
  const deferredQuery = useDeferredValue(query);
  const { ids: watchlist } = useWatchlist();

  const results = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();

    return EQUITIES.filter((instrument) => {
      if (sector !== "all" && instrument.sector !== sector) return false;
      if (needle.length === 0) return true;
      return (
        instrument.symbol.toLowerCase().includes(needle) ||
        instrument.name.toLowerCase().includes(needle)
      );
    });
  }, [deferredQuery, sector]);

  const ids = useMemo(() => results.map((instrument) => instrument.id), [results]);

  return (
    <>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by symbol or company name…"
            aria-label="Search instruments"
          />
        </div>
        <div className="sm:w-52">
          <Select options={SECTOR_OPTIONS} value={sector} onValueChange={setSector} />
        </div>
      </div>

      {watchlist.length > 0 ? (
        <Panel className="mt-6">
          <PanelHeader
            title="Watchlist"
            description={`${watchlist.length} ${watchlist.length === 1 ? "instrument" : "instruments"} you're following`}
          />
          <QuoteTable instrumentIds={watchlist} showSparkline showWatchlistStar />
        </Panel>
      ) : null}

      <Panel className="mt-6">
        <PanelHeader
          title="Instruments"
          description={`${results.length} of ${EQUITIES.length} symbols`}
        />

        {results.length === 0 ? (
          <EmptyState
            title="No instruments match that search"
            description="Try a different symbol or company name, or clear the sector filter."
          />
        ) : (
          <QuoteTable instrumentIds={ids} showWatchlistStar />
        )}
      </Panel>
    </>
  );
}
