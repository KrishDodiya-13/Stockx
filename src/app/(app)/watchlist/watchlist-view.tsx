"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";

import { TradeDialog } from "@/app/(app)/watchlist/trade-dialog";
import { WatchlistStar } from "@/components/market/watchlist-star";
import { EmptyState } from "@/components/ui/empty-state";
import { PercentChange, Price } from "@/components/ui/financial";
import { Panel, PanelHeader } from "@/components/ui/card";
import { ResponsiveRecords } from "@/components/ui/record-list";
import { SearchInput } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useQuotes } from "@/hooks/use-quote";
import { useWatchlist } from "@/hooks/use-watchlist";
import { cn } from "@/lib/cn";
import { directionOf, formatVolume } from "@/lib/format";
import { EQUITY_OPTIONS } from "@/lib/instrument-options";
import { stockRoute } from "@/lib/routes";
import { INSTRUMENT_BY_ID } from "@/services/market-data";

/**
 * The watchlist.
 *
 * ── Where the prices come from ─────────────────────────────────────────────
 *
 * `useQuotes` — the same hook the stocks table and the dashboard use, reading
 * the one `MarketDataService`. This page adds no price source of its own: no
 * second simulator, no second socket. When a tick arrives the service notifies
 * its subscribers and these rows re-render, so prices move without a refresh
 * and without this component polling for them.
 *
 * Market hours are handled upstream too. While the market is shut the service
 * stops producing new prices and holds the last traded values, which is what
 * these rows then show.
 *
 * ── Trading from here ──────────────────────────────────────────────────────
 *
 * Buy and Sell open a ticket for a row that is on the list. Removing a symbol
 * takes its buttons away with the row; it does not touch any holding, position
 * or order, which live in their own tables. Orders are placed against STOCKX
 * virtual cash through the existing order service and never reach Upstox.
 */
export function WatchlistView() {
  const { items, ids, loaded, error, add, has } = useWatchlist();
  const { quotes, state } = useQuotes(ids);

  const [query, setQuery] = useState("");
  const [ticket, setTicket] = useState<{ instrumentId: string; side: "buy" | "sell" } | null>(null);

  /*
    Search over the shared instrument registry.

    Symbol, company name and instrument key all match, using the same option
    list the strategy builder searches — so the whole universe is reachable,
    SUDARSCHEM included, and there is no second copy of the stock list here.
  */
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return [];

    return EQUITY_OPTIONS.filter((option) =>
      [option.label, option.hint ?? "", option.value, ...(option.keywords ?? [])].some((text) =>
        text.toLowerCase().includes(needle),
      ),
    ).slice(0, 8);
  }, [query]);

  const ticketInstrument = ticket ? INSTRUMENT_BY_ID.get(ticket.instrumentId) : undefined;

  return (
    <>
      {/* --- search and add ----------------------------------------------- */}
      <div className="mt-10">
        <SearchInput
          value={query}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
          placeholder="Search symbol, company or instrument key…"
          aria-label="Search instruments to add to your watchlist"
        />

        {matches.length > 0 ? (
          <Panel className="mt-3">
            <ul>
              {matches.map((option) => {
                const already = has(option.value);
                return (
                  <li
                    key={option.value}
                    className="flex items-center justify-between gap-4 border-b border-line-subtle px-5 py-3 last:border-b-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[0.875rem] font-medium">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[0.6875rem] text-ink-tertiary">
                        {option.hint} · {option.value}
                      </span>
                    </span>

                    <button
                      type="button"
                      /* Already-followed symbols stay visible but inert, so the
                         result list does not reshuffle as you add from it. */
                      disabled={already}
                      onClick={() => {
                        void add(option.value).then(() => setQuery(""));
                      }}
                      className={cn(
                        "shrink-0 rounded-full border px-3.5 py-1.5 text-[0.75rem] transition-colors duration-200",
                        already
                          ? "border-line text-ink-tertiary"
                          : "border-line text-ink-secondary hover:border-line-strong hover:text-ink",
                      )}
                    >
                      {already ? "In watchlist" : "Add"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ) : null}

        {query.trim() !== "" && matches.length === 0 ? (
          <p className="mt-3 px-1 text-[0.8125rem] text-ink-tertiary">
            No instruments match that search.
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="status" className="mt-4 px-1 text-[0.8125rem] text-down">
          {error}
        </p>
      ) : null}

      {/* --- the list ------------------------------------------------------ */}
      <Panel className="mt-6">
        <PanelHeader
          title="Watchlist"
          description={
            items.length > 0
              ? `${items.length} ${items.length === 1 ? "instrument" : "instruments"} you are following`
              : "Instruments you follow, with live prices"
          }
        />

        {!loaded ? (
          <SkeletonRows rows={4} className="px-5" />
        ) : items.length === 0 ? (
          <EmptyState
            title="No stocks in your watchlist"
            description="Search for a stock and add it to start trading."
          />
        ) : state === "loading" && quotes.size === 0 ? (
          <SkeletonRows rows={Math.min(items.length, 6)} className="px-5" />
        ) : (
          <ResponsiveRecords
            cards={
              <ul>
                {items.map((item) => {
                  const quote = quotes.get(item.instrumentId);
                  const direction = quote ? directionOf(quote.changePercent) : "flat";

                  return (
                    <li
                      key={item.instrumentId}
                      className="border-b border-line-subtle px-5 py-4 last:border-b-0"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <span className="min-w-0">
                          <Link
                            href={stockRoute(item.symbol)}
                            className="block truncate text-[0.9375rem] font-medium"
                          >
                            {item.symbol}
                          </Link>
                          <span className="mt-0.5 block truncate text-[0.6875rem] text-ink-tertiary">
                            {item.name}
                          </span>
                        </span>

                        <span className="flex shrink-0 items-start gap-1">
                          <span className="flex flex-col items-end">
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
                          <WatchlistStar instrumentId={item.instrumentId} symbol={item.symbol} />
                        </span>
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <TradeButton
                          side="buy"
                          onClick={() => setTicket({ instrumentId: item.instrumentId, side: "buy" })}
                        />
                        <TradeButton
                          side="sell"
                          onClick={() =>
                            setTicket({ instrumentId: item.instrumentId, side: "sell" })
                          }
                        />
                        <span className="tabular ml-auto text-[0.6875rem] text-ink-tertiary">
                          {quote ? formatVolume(quote.volume) : "—"}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            }
            table={
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] border-collapse text-left">
                  <caption className="sr-only">
                    Your watchlist, with live prices that update as the market moves.
                  </caption>
                  <thead>
                    <tr className="border-b border-line-subtle">
                      <Th className="w-10 pl-5 md:pl-6">
                        <span className="sr-only">Watchlist</span>
                      </Th>
                      <Th>Symbol</Th>
                      <Th>Company</Th>
                      <Th align="right">Live price</Th>
                      <Th align="right">Change</Th>
                      <Th align="right" className="hidden sm:table-cell">
                        Volume
                      </Th>
                      <Th align="right" className="pr-5 md:pr-6">
                        Trade
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const quote = quotes.get(item.instrumentId);
                      const direction = quote ? directionOf(quote.changePercent) : "flat";

                      return (
                        <tr
                          key={item.instrumentId}
                          className="row-hover border-b border-line-subtle transition-colors duration-200 last:border-b-0"
                        >
                          <td className="py-3.5 pl-5 md:pl-6">
                            <WatchlistStar instrumentId={item.instrumentId} symbol={item.symbol} />
                          </td>
                          <td className="py-3.5">
                            <Link
                              href={stockRoute(item.symbol)}
                              className="text-[0.875rem] font-medium"
                            >
                              {item.symbol}
                            </Link>
                          </td>
                          <td className="max-w-[16rem] truncate py-3.5 text-[0.8125rem] text-ink-secondary">
                            {item.name}
                          </td>
                          <td className="py-3.5 text-right">
                            {quote ? (
                              <Price value={quote.price} size="sm" direction={direction} />
                            ) : (
                              <span className="text-[0.8125rem] text-ink-tertiary">—</span>
                            )}
                          </td>
                          <td className="py-3.5 text-right">
                            {quote ? (
                              <PercentChange value={quote.changePercent} size="sm" />
                            ) : (
                              <span className="text-[0.8125rem] text-ink-tertiary">—</span>
                            )}
                          </td>
                          <td className="tabular hidden py-3.5 text-right text-[0.8125rem] text-ink-secondary sm:table-cell">
                            {quote ? formatVolume(quote.volume) : "—"}
                          </td>
                          <td className="py-3.5 pr-5 text-right md:pr-6">
                            <span className="inline-flex gap-2">
                              <TradeButton
                                side="buy"
                                onClick={() =>
                                  setTicket({ instrumentId: item.instrumentId, side: "buy" })
                                }
                              />
                              <TradeButton
                                side="sell"
                                onClick={() =>
                                  setTicket({ instrumentId: item.instrumentId, side: "sell" })
                                }
                              />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            }
          />
        )}
      </Panel>

      {/*
        The ticket is rendered only while its instrument is still on the list.
        Un-starring a symbol with its ticket open closes the ticket — the
        trading restriction working at the only place it matters, since you
        cannot submit an order from a row that is no longer on your watchlist.
      */}
      {ticket && ticketInstrument && has(ticket.instrumentId) ? (
        <TradeDialog
          instrumentId={ticket.instrumentId}
          symbol={ticketInstrument.symbol}
          name={ticketInstrument.name}
          side={ticket.side}
          quote={quotes.get(ticket.instrumentId) ?? null}
          onClose={() => setTicket(null)}
        />
      ) : null}
    </>
  );
}

function TradeButton({ side, onClick }: { side: "buy" | "sell"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-[0.75rem] font-medium transition-colors duration-200",
        side === "buy"
          ? "border-up/40 text-up hover:border-up hover:bg-up/8"
          : "border-down/40 text-down hover:border-down hover:bg-down/8",
      )}
    >
      {side === "buy" ? "Buy" : "Sell"}
    </button>
  );
}

function Th({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "eyebrow py-2.5 font-normal",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}
