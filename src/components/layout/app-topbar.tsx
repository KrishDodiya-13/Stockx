"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useCommandPalette } from "@/components/command/command-palette-provider";
import { ConnectionStatusPill } from "@/components/market/connection-status";
import { useTheme } from "@/components/providers/theme-provider";
import { activeQuoteSource, DataSourceBadge } from "@/components/ui/data-source-badge";
import { Wordmark } from "@/components/layout/wordmark";
import type { MarketPhase } from "@/domain/market";
import { cn } from "@/lib/cn";
import { getMarketDataService } from "@/services/market-data";

const PHASE_LABEL: Record<MarketPhase, string> = {
  "pre-open": "Pre-open",
  open: "Market open",
  closed: "Market closed",
};

export function AppTopbar() {
  const { open } = useCommandPalette();

  return (
    <header className="glass sticky top-0 z-30 border-b border-line-subtle">
      <div className="flex h-16 items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-4">
          {/* Name hides below `sm` so the mark, market pill and menu button
              never collide on a narrow phone; the mark alone still links home. */}
          <Link href="/" className="text-[0.9375rem] lg:hidden">
            <Wordmark responsiveName />
          </Link>

          <MarketStatusPill />
        </div>

        <div className="flex items-center gap-2">
          <ConnectionStatusPill className="hidden sm:inline-flex" />
          <DataSourceBadge source={activeQuoteSource()} className="hidden md:inline-flex" />

          <button
            type="button"
            onClick={() => open()}
            aria-label="Open command palette"
            className="flex size-9 items-center justify-center rounded-full text-ink-secondary transition-colors duration-200 hover:text-ink lg:hidden"
          >
            <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="7" cy="7" r="4.6" />
              <path d="m10.6 10.6 3 3" strokeLinecap="round" />
            </svg>
          </button>

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

/**
 * Session phase. Derived from the market-data service rather than the browser
 * clock, so a live adapter's own calendar (holidays, special sessions) governs
 * it later without this component changing.
 */
function MarketStatusPill() {
  const [phase, setPhase] = useState<MarketPhase | null>(null);

  useEffect(() => {
    let cancelled = false;
    const service = getMarketDataService();

    const refresh = (): void => {
      void service.getMarketStatus().then((status) => {
        if (!cancelled) setPhase(status.phase);
      });
    };

    refresh();
    const timer = setInterval(refresh, 30_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!phase) {
    return <span className="h-5 w-28 animate-pulse rounded-full bg-line" aria-hidden />;
  }

  return (
    <span className="flex items-center gap-2 text-[0.6875rem] tracking-[0.1em] text-ink-secondary uppercase">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          phase === "open" && "bg-up",
          phase === "pre-open" && "bg-accent",
          phase === "closed" && "bg-flat",
        )}
      />
      <span className="whitespace-nowrap">{PHASE_LABEL[phase]}</span>
    </span>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="flex size-9 items-center justify-center rounded-full text-ink-secondary transition-colors duration-200 hover:text-ink"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </>
        ) : (
          <path
            d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  );
}
