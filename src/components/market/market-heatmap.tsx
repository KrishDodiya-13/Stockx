"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { Quote } from "@/domain/market";
import { useQuotes } from "@/hooks/use-quote";
import { cn } from "@/lib/cn";
import { stockRoute } from "@/lib/routes";
import { formatPercent, formatPrice } from "@/lib/format";
import { EQUITY_INSTRUMENTS, INSTRUMENT_BY_ID } from "@/services/market-data";

const EQUITY_IDS = EQUITY_INSTRUMENTS.map((instrument) => instrument.id);

/**
 * Market heatmap.
 *
 * Tiles are sized by market capitalisation and shaded by the day's move, so the
 * eye lands on large names moving hard rather than on small names moving
 * noisily.
 *
 * Two deliberate constraints:
 *
 *  - Intensity is bucketed, not continuous. A smooth gradient across ±5% is
 *    unreadable at tile size; five steps per direction stay distinguishable.
 *  - Colour is never the only signal. Every tile prints its own percentage, so
 *    the grid is legible to a red/green colour-blind reader and to anyone
 *    reading it in greyscale.
 */
export function MarketHeatmap({ className }: { className?: string }) {
  const { quotes, state } = useQuotes(EQUITY_IDS);

  const tiles = useMemo(() => {
    const entries = EQUITY_IDS.map((id) => {
      const instrument = INSTRUMENT_BY_ID.get(id);
      const quote = quotes.get(id);
      return instrument && quote ? { instrument, quote } : null;
    }).filter((entry): entry is { instrument: NonNullable<typeof entry>["instrument"]; quote: Quote } =>
      entry !== null,
    );

    // Largest first, so the grid reads by weight rather than alphabetically.
    return entries.sort((a, b) => b.instrument.marketCapCr - a.instrument.marketCapCr);
  }, [quotes]);

  if (tiles.length === 0) {
    return (
      <div
        className={cn(
          "grid auto-rows-[3.5rem] grid-cols-4 gap-px bg-line sm:grid-cols-6 md:grid-cols-8 xl:grid-cols-10",
          className,
        )}
        role="status"
        aria-label="Loading heatmap"
      >
        {Array.from({ length: 32 }, (_, index) => (
          <Skeleton key={index} className="h-full rounded-none" animate={state === "loading"} />
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      {/*
        `grid-flow-dense` lets the larger spans below pack against the smaller
        tiles instead of leaving holes in the grid.
      */}
      {/* Fixed row height rather than an aspect ratio, so a row-spanning tile
          is exactly twice the height of a single one. */}
      <div className="grid auto-rows-[3.5rem] grid-flow-dense grid-cols-4 gap-px bg-line sm:grid-cols-6 md:grid-cols-8 xl:grid-cols-10">
        {tiles.map(({ instrument, quote }, index) => (
          <Link
            key={instrument.id}
            href={stockRoute(instrument.symbol)}
            title={`${instrument.name} · ${formatPrice(quote.price)} · ${formatPercent(quote.changePercent, { signed: true })}`}
            className={cn(
              "group relative flex flex-col justify-between overflow-hidden p-2.5 transition-opacity duration-200 hover:opacity-90",
              sizeClass(index),
              intensityClass(quote.changePercent),
            )}
          >
            <span className="truncate text-[0.6875rem] font-medium leading-tight">
              {instrument.symbol}
            </span>
            <span className="tabular text-[0.6875rem] leading-tight opacity-90">
              {formatPercent(quote.changePercent, { signed: true })}
            </span>
          </Link>
        ))}
      </div>

      <Legend />
    </div>
  );
}

/**
 * Size tier by market-cap rank. `tiles` is sorted largest-first, so rank is a
 * direct proxy for weight — the heaviest names occupy proportionally more of
 * the grid, which is what makes the map readable at a glance.
 *
 * Tiers rather than continuous areas: a true treemap needs a packing pass, and
 * three tiers already carry the "these names dominate the index" signal.
 */
function sizeClass(rank: number): string {
  if (rank < 4) return "col-span-2 row-span-2";
  if (rank < 12) return "col-span-2";
  return "";
}

/**
 * Bucketed shading. Tailwind needs whole class names at build time, so these
 * are written out rather than interpolated.
 */
function intensityClass(changePercent: number | null): string {
  // No previous close, no measured move: the tile takes the neutral shade
  // rather than the one that means "unchanged today".
  if (changePercent === null || !Number.isFinite(changePercent)) return "bg-line-subtle";

  const magnitude = Math.abs(changePercent);

  if (magnitude < 0.15) return "bg-base text-ink-secondary";

  if (changePercent > 0) {
    if (magnitude >= 3) return "bg-up text-white";
    if (magnitude >= 2) return "bg-up/80 text-white";
    if (magnitude >= 1) return "bg-up/60 text-white";
    if (magnitude >= 0.5) return "bg-up/35 text-ink";
    return "bg-up/18 text-ink";
  }

  if (magnitude >= 3) return "bg-down text-white";
  if (magnitude >= 2) return "bg-down/80 text-white";
  if (magnitude >= 1) return "bg-down/60 text-white";
  if (magnitude >= 0.5) return "bg-down/35 text-ink";
  return "bg-down/18 text-ink";
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[0.625rem] text-ink-tertiary">
      <span className="uppercase tracking-[0.14em]">Day change</span>
      <span className="flex items-center gap-1">
        <Swatch className="bg-down" />
        <Swatch className="bg-down/60" />
        <Swatch className="bg-down/18" />
        <Swatch className="bg-base ring-1 ring-line" />
        <Swatch className="bg-up/18" />
        <Swatch className="bg-up/60" />
        <Swatch className="bg-up" />
      </span>
      <span className="tabular">−3% → +3%</span>
      <span>Tile size reflects market capitalisation</span>
    </div>
  );
}

function Swatch({ className }: { className?: string }) {
  return <span aria-hidden className={cn("size-2.5 rounded-[1px]", className)} />;
}
