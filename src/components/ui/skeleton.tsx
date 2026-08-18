import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

/**
 * Loading placeholder.
 *
 * Skeletons must match the footprint of the content they stand in for —
 * a skeleton that resizes on load causes exactly the layout shift it was
 * meant to prevent.
 */
export function Skeleton({
  className,
  animate = true,
  style,
}: {
  className?: string;
  animate?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={style}
      className={cn("block rounded-sm bg-line", animate && "animate-pulse", className)}
    />
  );
}

/** Rows of a table or list. */
export function SkeletonRows({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("divide-y divide-line-subtle", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center justify-between gap-6 py-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-40 opacity-60" />
          </div>
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}

/** A grid of stat tiles. */
export function SkeletonTiles({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4"
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-4 bg-base p-6">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-7 w-32" />
        </div>
      ))}
    </div>
  );
}
