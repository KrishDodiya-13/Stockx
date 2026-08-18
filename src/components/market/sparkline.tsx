"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { directionOf } from "@/lib/format";
import { priceToRupees } from "@/lib/money";
import { getMarketDataService, type HistoryPoint } from "@/services/market-data";

interface SparklineProps {
  instrumentId: string;
  /**
   * Colour by the day's direction; falls back to the line's own slope.
   *
   * Null means the day's change is not known — the slope of the points on
   * screen is then the only honest thing to colour by, and it is what the
   * fallback already uses.
   */
  changePercent?: number | null;
  className?: string;
  width?: number;
  height?: number;
}

/**
 * Mini price chart.
 *
 * Reads the rolling history the service already keeps, so it costs no extra
 * subscription and always agrees with the price shown beside it. It draws only
 * once there are at least two points — a single point is a dot, not a trend,
 * and drawing a flat line from one sample would imply information that does not
 * exist yet.
 */
export function Sparkline({
  instrumentId,
  changePercent,
  className,
  width = 96,
  height = 28,
}: SparklineProps) {
  const service = useMemo(() => getMarketDataService(), []);
  const [points, setPoints] = useState<readonly HistoryPoint[]>([]);

  useEffect(() => {
    let cancelled = false;

    const sync = (): void => {
      if (!cancelled) setPoints(service.getHistory(instrumentId));
    };

    sync();
    // The history buffer is filled by whichever component subscribed to this
    // instrument; poll it rather than adding a second subscription.
    const timer = setInterval(sync, 1200);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [instrumentId, service]);

  const path = useMemo(() => buildPath(points, width, height), [points, width, height]);

  const direction =
    typeof changePercent === "number" && Number.isFinite(changePercent)
      ? directionOf(changePercent)
      : directionOf(slopeOf(points));

  if (!path) {
    return (
      <span
        className={cn("inline-block", className)}
        style={{ width, height }}
        aria-hidden
      />
    );
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={`Recent simulated price trend, ${direction === "up" ? "rising" : direction === "down" ? "falling" : "flat"}`}
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={
          direction === "up" ? "stroke-up" : direction === "down" ? "stroke-down" : "stroke-flat"
        }
      />
    </svg>
  );
}

function buildPath(
  points: readonly HistoryPoint[],
  width: number,
  height: number,
): string | null {
  if (points.length < 2) return null;

  const values = points.map((point) => priceToRupees(point.price));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  // A perfectly flat series has no range to normalise against; draw it centred
  // rather than dividing by zero.
  const y = (value: number): number =>
    span === 0 ? height / 2 : height - ((value - min) / span) * height;

  const step = width / (values.length - 1);

  return values
    .map((value, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(2)},${y(value).toFixed(2)}`)
    .join(" ");
}

function slopeOf(points: readonly HistoryPoint[]): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;
  return last.price - first.price;
}
