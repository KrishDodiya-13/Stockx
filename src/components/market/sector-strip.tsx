"use client";

import { PercentChange } from "@/components/ui/financial";
import { Skeleton } from "@/components/ui/skeleton";
import { useSectorPerformance } from "@/hooks/use-market-snapshot";
import { cn } from "@/lib/cn";
import { directionOf } from "@/lib/format";

/**
 * Sector rotation.
 *
 * Bars are scaled against the strongest absolute move on screen rather than a
 * fixed range, so a quiet session still reads as a shape instead of a flat
 * line — the ranking is the information, not the absolute width.
 */
export function SectorStrip({ refreshMs = 4000 }: { refreshMs?: number }) {
  const sectors = useSectorPerformance(refreshMs);

  if (!sectors) {
    return (
      <div className="space-y-3 px-5 py-5 md:px-6" role="status" aria-label="Loading sectors">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  const ranked = [...sectors].sort((a, b) => b.changePercent - a.changePercent);
  const peak = Math.max(...ranked.map((sector) => Math.abs(sector.changePercent)), 0.01);

  return (
    <ul className="px-5 py-4 md:px-6">
      {ranked.map((sector) => {
        const direction = directionOf(sector.changePercent);
        const width = (Math.abs(sector.changePercent) / peak) * 50;

        return (
          <li key={sector.sector} className="flex items-center gap-4 py-2">
            <span className="w-24 shrink-0 truncate text-[0.8125rem] text-ink-secondary">
              {sector.sector}
            </span>

            {/* A centred axis: gains extend right, losses left. */}
            <span className="relative h-1.5 flex-1" aria-hidden>
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />
              <span
                className={cn(
                  "absolute top-0 h-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
                  direction === "up" && "left-1/2 bg-up",
                  direction === "down" && "right-1/2 bg-down",
                  direction === "flat" && "left-1/2 bg-flat",
                )}
                style={{ width: `${width}%` }}
              />
            </span>

            <PercentChange value={sector.changePercent} size="sm" className="w-20 justify-end" />
          </li>
        );
      })}
    </ul>
  );
}
