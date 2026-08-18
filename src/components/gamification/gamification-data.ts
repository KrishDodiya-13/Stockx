"use client";

import { useEffect, useState } from "react";

import type { Achievement, Challenge } from "@/services/gamification/challenges";
import type { LeaderboardPeriod, PublicLeaderboardEntry } from "@/services/gamification/scoring";
import { handleSessionExpiry } from "@/lib/session-expiry";

export interface GamificationPayload {
  period: LeaderboardPeriod;
  benchmarkPercent: number;
  leaderboard: PublicLeaderboardEntry[];
  you: PublicLeaderboardEntry | null;
  challenges: Challenge[];
  achievements: Achievement[];
  participantCount: number;
}

export type GamificationStatus = "loading" | "ready" | "error" | "unconfigured";

/**
 * Loads the leaderboard, challenges and achievements together.
 *
 * One request rather than three: all three views are derived from the same
 * trade history, and splitting them would let the pages disagree about the
 * same account mid-refresh.
 */
export function useGamification(period: LeaderboardPeriod): {
  data: GamificationPayload | null;
  status: GamificationStatus;
  message: string | null;
} {
  const [data, setData] = useState<GamificationPayload | null>(null);
  const [status, setStatus] = useState<GamificationStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    void (async () => {
      try {
        const response = await fetch(`/api/gamification?period=${period}`, { cache: "no-store" });
        const payload = (await response.json()) as GamificationPayload & {
          error?: string;
          message?: string;
        };
        if (cancelled) return;

        if (handleSessionExpiry(response)) return;

        if (response.status === 503 && payload.error === "database_not_configured") {
          setStatus("unconfigured");
          setMessage(payload.message ?? null);
          return;
        }
        if (!response.ok) {
          setStatus("error");
          setMessage(payload.message ?? "Could not load the leaderboard.");
          return;
        }

        setData(payload);
        setStatus("ready");
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("Could not reach the server.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [period]);

  return { data, status, message };
}
