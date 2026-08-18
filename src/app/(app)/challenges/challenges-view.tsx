"use client";

import { AchievementBadge } from "@/components/gamification/achievement-badge";
import { useGamification } from "@/components/gamification/gamification-data";
import { Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTiles } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import type { Challenge } from "@/services/gamification/challenges";

export function ChallengesView() {
  const { data, status, message } = useGamification("all-time");

  if (status === "unconfigured") {
    return (
      <Panel className="mt-10">
        <EmptyState
          title="Challenges need a database"
          description={message ?? "Progress is measured against your recorded trades."}
        />
      </Panel>
    );
  }

  if (status === "loading") return <SkeletonTiles count={4} />;

  if (status === "error" || !data) {
    return (
      <Panel className="mt-10">
        <EmptyState title="Could not load challenges" description={message ?? "Try again."} />
      </Panel>
    );
  }

  const earned = data.achievements.filter((achievement) => achievement.earned).length;

  return (
    <div className="mt-10 space-y-10">
      <section aria-label="Challenges">
        <h2 className="eyebrow mb-5">Challenges</h2>
        <div className="grid gap-px border border-line bg-line sm:grid-cols-2">
          {data.challenges.map((challenge) => (
            <ChallengeCard key={challenge.id} challenge={challenge} />
          ))}
        </div>
      </section>

      <section aria-label="Achievements">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="eyebrow">Achievements</h2>
          <span className="tabular text-[0.75rem] text-ink-tertiary">
            {earned} of {data.achievements.length} earned
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.achievements.map((achievement) => (
            <AchievementBadge key={achievement.id} achievement={achievement} />
          ))}
        </div>
      </section>

      <p className="max-w-2xl text-xs leading-relaxed text-ink-tertiary">
        Every challenge and badge states exactly what it measures. Outcome-based awards need a
        minimum number of closed trades before they can be earned — a single fortunate trade is not
        an achievement, and a badge that could be won by luck would mean nothing. All results are
        from paper trading with virtual money.
      </p>
    </div>
  );
}

function ChallengeCard({ challenge }: { challenge: Challenge }) {
  return (
    <div className="bg-base p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[0.9375rem] font-medium">{challenge.title}</h3>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-secondary">
            {challenge.description}
          </p>
        </div>

        {challenge.complete ? (
          <span className="shrink-0 rounded-full border border-up/40 px-2 py-0.5 text-[0.625rem] uppercase tracking-[0.12em] text-up">
            Complete
          </span>
        ) : !challenge.measurable ? (
          <span
            className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[0.625rem] uppercase tracking-[0.12em] text-ink-tertiary"
            title={challenge.requirement}
          >
            Locked
          </span>
        ) : null}
      </div>

      <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className={cn(
            "h-full transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
            challenge.complete ? "bg-up" : "bg-ink",
          )}
          style={{ width: `${challenge.progress}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-[0.6875rem]">
        <span className="tabular text-ink-secondary">{challenge.current}</span>
        <span className="text-ink-tertiary">Target: {challenge.target}</span>
      </div>

      {!challenge.measurable ? (
        <p className="mt-2 text-[0.625rem] text-ink-tertiary">{challenge.requirement}</p>
      ) : null}
    </div>
  );
}
