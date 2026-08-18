"use client";

import { useEffect, useRef } from "react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { ensureGsap } from "@/lib/animation/gsap-core";
import { DURATION, EASE } from "@/lib/animation/motion-tokens";
import type { Achievement } from "@/services/gamification/challenges";

/**
 * An achievement badge.
 *
 * Earned badges animate in once, on mount. The animation is deliberately brief
 * and singular — a badge that pulses forever turns an accomplishment into
 * noise, and this is a trading terminal, not a slot machine.
 *
 * Locked badges show their progress and their exact criterion. A locked badge
 * with no stated requirement is a mystery box, which is the opposite of
 * educational.
 */
export function AchievementBadge({ achievement }: { achievement: Achievement }) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const element = ref.current;
    if (!element || !achievement.earned || reducedMotion) return;

    const gsap = ensureGsap();

    const context = gsap.context(() => {
      gsap
        .timeline()
        .from(element, { scale: 0.94, opacity: 0, duration: DURATION.base, ease: EASE.out })
        // A single sweep of light across the mark, then done.
        .fromTo(
          element.querySelector("[data-shine]"),
          { xPercent: -130 },
          { xPercent: 130, duration: 0.9, ease: "power2.inOut" },
          "-=0.1",
        );
    }, element);

    return () => context.revert();
  }, [achievement.earned, reducedMotion]);

  return (
    <div
      ref={ref}
      className={cn(
        "relative overflow-hidden border p-6 transition-colors duration-300",
        achievement.earned ? "border-accent/50" : "border-line",
      )}
    >
      {achievement.earned ? (
        <span
          aria-hidden
          data-shine
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-accent/10"
        />
      ) : null}

      <div className="relative flex items-start justify-between gap-4">
        <Mark earned={achievement.earned} />
        {achievement.earned ? (
          <span className="rounded-full border border-accent/40 px-2 py-0.5 text-[0.625rem] uppercase tracking-[0.12em] text-accent">
            Earned
          </span>
        ) : (
          <span className="tabular text-[0.6875rem] text-ink-tertiary">
            {achievement.progress.toFixed(0)}%
          </span>
        )}
      </div>

      <h3
        className={cn(
          "relative mt-5 text-[0.9375rem] font-medium",
          !achievement.earned && "text-ink-secondary",
        )}
      >
        {achievement.title}
      </h3>

      <p className="relative mt-2 text-[0.8125rem] leading-relaxed text-ink-secondary">
        {achievement.description}
      </p>

      {!achievement.earned ? (
        <div className="relative mt-4 h-1 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full bg-ink-tertiary transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ width: `${achievement.progress}%` }}
          />
        </div>
      ) : null}

      <p className="relative mt-4 text-[0.6875rem] leading-relaxed text-ink-tertiary">
        {achievement.criterion}
      </p>
      <p className="relative mt-1.5 text-[0.6875rem] text-ink-tertiary">{achievement.current}</p>
    </div>
  );
}

/** A geometric mark per achievement — abstract, never a trophy cartoon. */
function Mark({ earned }: { earned: boolean }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn("size-8", earned ? "text-accent" : "text-ink-tertiary opacity-50")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    >
      <path d="M16 3 27 9.5v13L16 29 5 22.5v-13L16 3Z" />
      {earned ? <path d="M11 16.2 14.6 20 21.5 12.5" strokeWidth="1.6" strokeLinecap="round" /> : null}
    </svg>
  );
}
