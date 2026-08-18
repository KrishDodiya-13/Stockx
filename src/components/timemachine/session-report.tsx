"use client";

import { useEffect, useRef } from "react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { Paise } from "@/lib/money";
import { ensureGsap } from "@/lib/animation/gsap-core";
import { DURATION, EASE, STAGGER } from "@/lib/animation/motion-tokens";
import type { SessionReport } from "@/services/timemachine/session-engine";

/**
 * The closing report.
 *
 * Deliberately cinematic — this is the payoff of a session, and the one moment
 * in the product where a slower, staged reveal earns its place. The figures
 * rise in sequence rather than appearing at once, which gives the outperformance
 * line time to land as the conclusion rather than as one tile among eight.
 */
export function SessionReportPanel({
  report,
  symbol,
  onReset,
}: {
  report: SessionReport;
  symbol: string;
  onReset: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const root = rootRef.current;
    if (!root || reducedMotion) return;

    const gsap = ensureGsap();
    const context = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: EASE.out } })
        .from("[data-report-headline]", { opacity: 0, y: 24, duration: DURATION.slow })
        .from(
          "[data-report-tile]",
          { opacity: 0, y: 16, duration: DURATION.base, stagger: STAGGER.base },
          "-=0.35",
        )
        .from("[data-report-verdict]", { opacity: 0, y: 12, duration: DURATION.base }, "-=0.1");
    }, root);

    return () => context.revert();
  }, [reducedMotion]);

  const beatMarket = report.outperformancePercent >= 0;
  const profitable = report.totalReturn >= 0;

  return (
    <div ref={rootRef} className="border border-line">
      <div className="border-b border-line px-6 py-8 md:px-10 md:py-12">
        <span className="eyebrow">Session complete</span>

        <div data-report-headline className="mt-6">
          <p className="text-numeric-hero">
            <span className="text-ink-tertiary">₹</span>
            <span className={cn("tabular", profitable ? "text-up" : "text-down")}>
              {new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(
                report.endingCapital / 100,
              )}
            </span>
          </p>

          <p className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <span className={cn("tabular text-numeric-m", profitable ? "text-up" : "text-down")}>
              {profitable ? "+" : "−"}
              {formatCurrency(Math.abs(report.totalReturn) as Paise, { whole: true })}
            </span>
            <span className={cn("tabular text-numeric-m", profitable ? "text-up" : "text-down")}>
              {formatPercent(report.totalReturnPercent, { signed: true })}
            </span>
            <span className="text-[0.75rem] text-ink-tertiary">
              from {formatCurrency(report.startingCapital, { whole: true })}
            </span>
          </p>
        </div>
      </div>

      <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Benchmark"
          value={formatPercent(report.benchmarkReturnPercent, { signed: true })}
          sub={`Buy and hold ${symbol}`}
        />
        <Tile
          label="Outperformance"
          value={formatPercent(report.outperformancePercent, { signed: true })}
          sub="Against buy and hold"
          tone={beatMarket ? "up" : "down"}
        />
        <Tile
          label="Max drawdown"
          value={formatPercent(report.maxDrawdownPercent)}
          sub={formatCurrency(report.maxDrawdown, { whole: true })}
          tone={report.maxDrawdown > 0 ? "down" : undefined}
        />
        <Tile
          label="Win rate"
          value={`${report.winRate.toFixed(0)}%`}
          sub={`${report.winCount}W / ${report.lossCount}L`}
        />
        <Tile label="Trades" value={String(report.tradeCount)} sub="Orders placed" />
        <Tile label="Bars elapsed" value={String(report.barsElapsed)} sub="Session length" />
        <Tile
          label="Starting capital"
          value={formatCurrency(report.startingCapital, { whole: true })}
          sub="Virtual"
        />
        <Tile
          label="Ending capital"
          value={formatCurrency(report.endingCapital, { whole: true })}
          sub="Open positions marked to the final close"
        />
      </div>

      <div data-report-verdict className="border-t border-line px-6 py-6 md:px-10">
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-ink-secondary">
          {verdict(report, symbol)}
        </p>

        <button
          type="button"
          onClick={onReset}
          className="mt-6 inline-flex h-11 items-center rounded-full border border-line-strong px-6 text-sm transition-all duration-300 hover:-translate-y-px hover:bg-ink hover:text-ink-inverse"
        >
          Run another session
        </button>

        <p className="mt-6 max-w-2xl text-xs leading-relaxed text-ink-tertiary">
          A historical simulation with virtual money. Orders filled at the close of the bar you were
          standing on, with no commission, slippage or liquidity constraint — a real fill can only
          be worse. One session is a single sample and says little on its own; past behaviour does
          not indicate future results.
        </p>
      </div>
    </div>
  );
}

/**
 * A plain-language reading of the session.
 *
 * States what happened and stops there. It does not tell the user they traded
 * well or badly, or what to do next — one session is far too small a sample to
 * support either claim.
 */
function verdict(report: SessionReport, symbol: string): string {
  if (report.tradeCount === 0) {
    return `You placed no trades. ${symbol} moved ${formatPercent(report.benchmarkReturnPercent, { signed: true })} over the session, so holding it would have returned that much.`;
  }

  const direction = report.benchmarkReturnPercent >= 0 ? "rose" : "fell";
  const relative =
    report.outperformancePercent >= 0
      ? `ahead of buy and hold by ${formatPercent(Math.abs(report.outperformancePercent))}`
      : `behind buy and hold by ${formatPercent(Math.abs(report.outperformancePercent))}`;

  return `Over ${report.barsElapsed} bars, ${symbol} ${direction} ${formatPercent(Math.abs(report.benchmarkReturnPercent))}. You placed ${report.tradeCount} ${report.tradeCount === 1 ? "order" : "orders"} and finished ${relative}.`;
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "up" | "down";
}) {
  return (
    <div data-report-tile className="bg-base p-5 md:p-6">
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          "tabular mt-3.5 text-numeric-m font-medium",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[0.6875rem] text-ink-tertiary">{sub}</p>
    </div>
  );
}
