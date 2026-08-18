import type { ReactElement } from "react";

import type { IconName } from "@/config/navigation";
import { cn } from "@/lib/cn";

/**
 * Navigation glyphs.
 *
 * Drawn on one 20×20 grid at a single 1.4 stroke weight so the sidebar reads as
 * one set. Deliberately geometric — no filled or pictorial icons.
 */
const PATHS: Record<IconName, ReactElement> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="6.5" height="6.5" rx="1" />
      <rect x="10.5" y="3" width="6.5" height="10" rx="1" />
      <rect x="3" y="10.5" width="6.5" height="6.5" rx="1" />
      <rect x="10.5" y="14" width="6.5" height="3" rx="1" />
    </>
  ),
  markets: (
    <>
      <path d="M3 14.5 7 9.5l3.5 3L17 5" />
      <path d="M13 5h4v4" />
    </>
  ),
  stocks: (
    <>
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.2 13.2 3.8 3.8" />
    </>
  ),
  // A star, matching the affordance used to add and remove rows.
  watchlist: (
    <path
      d="M10 2.8l2.24 4.55 5.02.73-3.63 3.54.86 5L10 14.25l-4.49 2.37.86-5L2.74 8.08l5.02-.73L10 2.8Z"
      strokeLinejoin="round"
    />
  ),
  portfolio: (
    <>
      <rect x="2.5" y="6" width="15" height="10.5" rx="1.5" />
      <path d="M7 6V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V6" />
      <path d="M2.5 10.5h15" />
    </>
  ),
  strategies: (
    <>
      <rect x="2.5" y="2.5" width="6" height="5" rx="1" />
      <rect x="11.5" y="12.5" width="6" height="5" rx="1" />
      <path d="M5.5 7.5v5a2 2 0 0 0 2 2h4" />
    </>
  ),
  risk: (
    <>
      <path d="M10 2.5 17.5 16h-15L10 2.5Z" />
      <path d="M10 8v3.5" />
      <path d="M10 13.6v.4" />
    </>
  ),
  timemachine: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.5V10l3 2" />
    </>
  ),
  dna: (
    <>
      <path d="M6 2.5c0 5 8 5 8 10s-8 5-8 5" />
      <path d="M14 2.5c0 5-8 5-8 10s8 5 8 5" />
      <path d="M7 6.5h6M7 13.5h6" />
    </>
  ),
  replay: (
    <>
      <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" />
      <path d="M3 3v3.5h3.5" />
      <path d="m8.5 7.5 4 2.5-4 2.5V7.5Z" />
    </>
  ),
  leaderboard: (
    <>
      <rect x="2.5" y="11" width="4" height="6" rx="0.8" />
      <rect x="8" y="6" width="4" height="11" rx="0.8" />
      <rect x="13.5" y="8.5" width="4" height="8.5" rx="0.8" />
    </>
  ),
  challenges: (
    <>
      <circle cx="10" cy="8" r="4.5" />
      <path d="m6.8 11.8-1.3 5.7 4.5-2.3 4.5 2.3-1.3-5.7" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7" />
    </>
  ),
};

export function NavIcon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={cn("size-[1.125rem] shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
