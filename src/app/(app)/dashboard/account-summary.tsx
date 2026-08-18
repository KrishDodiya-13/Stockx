"use client";

import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { Money, PercentChange } from "@/components/ui/financial";
import { SkeletonRows } from "@/components/ui/skeleton";
import { usePortfolio } from "@/hooks/use-portfolio";
import { priceToRupees, type Paise, type PriceE4 } from "@/lib/money";
import { stockRoute } from "@/lib/routes";

/**
 * Open positions on the dashboard, live-valued by the server.
 *
 * The balance tiles that used to live here were removed in Phase 5: they
 * duplicated `PortfolioHero`, which now owns every account figure on this
 * screen. Two components rendering the same balances is exactly how two parts
 * of a page start disagreeing.
 */
export function OpenPositions() {
  const { portfolio, state } = usePortfolio(6000);

  if (state === "loading") return <SkeletonRows rows={3} className="px-5 md:px-6" />;

  if (state !== "ready" || !portfolio || portfolio.holdings.length === 0) {
    return (
      <EmptyState
        title="You have no open positions"
        description="Buy an instrument from its detail page and it will appear here with live unrealised P&L."
        action={
          <Link
            href="/markets"
            className="inline-flex h-10 items-center rounded-full border border-line-strong px-5 text-[0.8125rem] transition-colors duration-300 hover:bg-ink hover:text-ink-inverse"
          >
            Explore the market
          </Link>
        }
      />
    );
  }

  return (
    <ul>
      {portfolio.holdings.map((holding) => (
        <li key={holding.instrumentId} className="border-b border-line-subtle last:border-b-0">
          <Link
            href={stockRoute(holding.symbol)}
            className="flex items-center gap-4 px-5 py-3.5 hover:bg-ink/3 md:px-6"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.875rem] font-medium">{holding.symbol}</span>
              <span className="tabular mt-0.5 block text-[0.6875rem] text-ink-tertiary">
                {holding.quantity.toLocaleString("en-IN")} @ avg ₹
                {priceToRupees(holding.averagePrice as PriceE4).toFixed(2)}
              </span>
            </span>

            <span className="flex shrink-0 flex-col items-end">
              <Money value={holding.currentValue as Paise} size="sm" />
              <PercentChange
                value={holding.unrealisedPnlPercent}
                size="sm"
                className="mt-0.5 text-[0.6875rem]"
              />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
