"use client";

import { CONNECTION_LABEL } from "@/domain/connection";
import { useConnectionStatus } from "@/hooks/use-market-snapshot";
import { publicEnv } from "@/config/env";
import { cn } from "@/lib/cn";

/**
 * Feed health indicator.
 *
 * A stale price shown without warning is worse than no price, so this reports
 * the transport state rather than hiding it. When the feed is the local
 * simulator, the label says so instead of saying "Live" — a simulated feed
 * being healthy is not the same claim as real market data being live.
 *
 * In live mode a dropped feed says so in as many words. "Offline" is ambiguous
 * when the rest of the app is plainly working; "Live data disconnected" names
 * what is actually unavailable, and the page around it keeps functioning.
 */
export function ConnectionStatusPill({ className }: { className?: string }) {
  const status = useConnectionStatus();
  const simulated = publicEnv.marketDataMode !== "live";
  const disconnected = !simulated && (status.state === "offline" || status.state === "reconnecting");

  const label = disconnected
    ? "Live data disconnected"
    : simulated && status.state === "connected"
      ? "Simulated feed"
      : CONNECTION_LABEL[status.state];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[0.625rem] tracking-[0.14em] text-ink-tertiary uppercase",
        className,
      )}
      title={status.detail}
      role="status"
      aria-label={`Market data connection: ${label}. ${status.detail}`}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status.state === "connected" && (simulated ? "bg-flat" : "bg-up"),
          status.state === "connecting" && "bg-accent animate-pulse",
          status.state === "reconnecting" && (disconnected ? "bg-down" : "bg-accent animate-pulse"),
          status.state === "offline" && "bg-down",
          status.state === "idle" && "bg-flat opacity-50",
        )}
      />
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
}
