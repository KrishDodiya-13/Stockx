"use client";

import Link from "next/link";

import { PortfolioChart } from "@/components/portfolio/portfolio-chart";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Cell, CellGrid, Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Magnetic } from "@/components/ui/magnetic";
import { Money } from "@/components/ui/financial";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnimate } from "@/hooks/use-animation";
import { usePortfolio } from "@/hooks/use-portfolio";
import { cn } from "@/lib/cn";
import { formatCurrency, formatPercent } from "@/lib/format";
import { paiseToRupees, type Paise } from "@/lib/money";

const rupeeFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * The dashboard hero.
 *
 * One figure dominates the screen — the portfolio value — with its label
 * reduced to a small caption above it. This inverts the usual dashboard
 * hierarchy, where a card title and its number compete at similar weight, and
 * is the main reason this reads as a terminal rather than a SaaS report.
 */
export function PortfolioHero() {
  const { portfolio, state, message } = usePortfolio(6000);
  const ref = useAnimate<HTMLElement>({ selector: "[data-hero-item]", stagger: 0.06 });

  if (state === "unconfigured") {
    return (
      <Panel className="mt-8">
        <EmptyState
          title="Connect the trading engine to begin"
          description={
            message ??
            "Set DATABASE_URL and run the Prisma migration, then create an account and choose your starting virtual capital."
          }
          action={
            <Magnetic>
              <Link
                href="/markets"
                className="inline-flex h-11 items-center rounded-full border border-line-strong px-6 text-sm transition-colors duration-300 hover:bg-ink hover:text-ink-inverse"
              >
                Explore the market
              </Link>
            </Magnetic>
          }
        />
      </Panel>
    );
  }

  if (state === "error") {
    return (
      <Panel className="mt-8">
        <EmptyState
          title="Your account is unavailable"
          description="We couldn't reach the trading engine. Your balances and positions are safe — this is a display problem only."
          action={
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-11 items-center rounded-full border border-line-strong px-6 text-sm transition-colors duration-300 hover:bg-ink hover:text-ink-inverse"
            >
              Try again
            </button>
          }
        />
      </Panel>
    );
  }

  const loading = state === "loading" || !portfolio;
  const totalPnl = portfolio?.totalPnl ?? (0 as Paise);
  const rising = totalPnl >= 0;

  return (
    <section ref={ref} className="mt-8" aria-label="Portfolio summary">
      <p data-hero-item className="eyebrow">
        {greeting()}
      </p>

      {/* The hero figure. */}
      <div data-hero-item className="mt-5">
        {loading ? (
          <Skeleton className="h-20 w-[min(22rem,80vw)] md:h-28" />
        ) : (
          <p className="text-numeric-hero">
            <span className="text-ink-tertiary">₹</span>
            <AnimatedNumber
              value={paiseToRupees(portfolio.totalValue)}
              format={(value) => rupeeFormatter.format(value)}
              flash
            />
          </p>
        )}
      </div>

      {/* P&L, subordinate to the value above but still large. */}
      <div data-hero-item className="mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-2">
        {loading ? (
          <Skeleton className="h-6 w-56" />
        ) : (
          <>
            <span
              className={cn(
                "tabular text-numeric-m",
                rising ? "text-up" : "text-down",
              )}
            >
              {/* Sign is printed, not implied by colour alone. */}
              {rising ? "+" : "−"}
              {formatCurrency(Math.abs(totalPnl) as Paise, { whole: true })}
            </span>
            <span className={cn("tabular text-numeric-m", rising ? "text-up" : "text-down")}>
              {formatPercent(portfolio.totalPnlPercent, { signed: true })}
            </span>
            <span className="text-[0.75rem] text-ink-tertiary">
              all time, on {formatCurrency(portfolio.startingCapital, { whole: true })} deposited
            </span>
          </>
        )}
      </div>

      {/* Four supporting figures. */}
      <div data-hero-item className="mt-10">
        <CellGrid columns={4}>
          <Metric
            label="Today"
            value={portfolio?.dayPnl ?? null}
            sub={
              portfolio ? `${formatPercent(portfolio.dayPnlPercent, { signed: true })} today` : ""
            }
            signed
            loading={loading}
          />
          <Metric
            label="Available"
            value={portfolio?.cashBalance ?? null}
            sub="Buying power"
            loading={loading}
          />
          <Metric
            label="Invested"
            value={portfolio?.investedValue ?? null}
            sub="At cost"
            loading={loading}
          />
          <Cell>
            <p className="eyebrow">Open positions</p>
            {loading ? (
              <Skeleton className="mt-3.5 h-8 w-16" />
            ) : (
              <p className="tabular mt-3.5 text-numeric-l">{portfolio.holdings.length}</p>
            )}
            <p className="mt-2 text-[0.6875rem] text-ink-tertiary">
              {portfolio && portfolio.holdings.length === 1 ? "instrument" : "instruments"}
            </p>
          </Cell>
        </CellGrid>
      </div>

      <div data-hero-item className="mt-10 border border-line p-5 md:p-8">
        <PortfolioChart liveValue={portfolio?.totalValue ?? null} />
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  sub,
  signed = false,
  loading,
}: {
  label: string;
  value: Paise | null;
  sub: string;
  signed?: boolean;
  loading: boolean;
}) {
  return (
    <Cell>
      <p className="eyebrow">{label}</p>
      <div className="mt-3.5">
        {loading || value === null ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <Money value={value} size="lg" signed={signed} whole className="text-numeric-l" />
        )}
      </div>
      <p className="mt-2 text-[0.6875rem] text-ink-tertiary">{sub}</p>
    </Cell>
  );
}

/** Time-of-day greeting, from the viewer's own clock. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning, trader";
  if (hour < 17) return "Good afternoon, trader";
  return "Good evening, trader";
}
