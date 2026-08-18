"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "@/hooks/use-reduced-motion";
import { animateNumber, ensureGsap } from "@/lib/animation/gsap-core";
import { DURATION } from "@/lib/animation/motion-tokens";

interface AnimatedNumberProps {
  /** The target value, in whatever unit `format` expects. */
  value: number;
  /** Renders the tweened value. Must be pure. */
  format: (value: number) => string;
  className?: string;
  /** Seconds. */
  duration?: number;
  /** Start counting from here on first mount (e.g. 0 for a count-up). */
  from?: number;
  /**
   * Directional micro-motion on change: the figure lifts on a rise, drops on a
   * fall. This is the primary way a price change registers — it is far quieter
   * than a colour flash and does not disturb the surrounding layout.
   */
  flash?: boolean;
}

/** How far the figure nudges on a change, in pixels. */
const NUDGE = 4;

/**
 * A number that tweens between values instead of snapping.
 *
 * Renders with tabular figures so digits never shift horizontally while
 * counting — the most common reason a live readout feels cheap.
 */
export function AnimatedNumber({
  value,
  format,
  className,
  duration = DURATION.slow,
  from,
  flash = false,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const currentRef = useRef<number>(from ?? value);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);

  // Callers routinely pass an inline arrow for `format`, which changes identity
  // on every render. Holding it in a ref keeps it out of the effect's
  // dependencies, so the tween restarts only when the *value* changes.
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const previous = currentRef.current;
    const rising = value > previous;
    const changed = value !== previous;

    if (flash && changed) setDirection(rising ? "up" : "down");

    if (prefersReducedMotion()) {
      currentRef.current = value;
      element.textContent = formatRef.current(value);
      return;
    }

    // Directional nudge: lift on a rise, drop on a fall, then settle back.
    if (flash && changed) {
      const gsap = ensureGsap();
      gsap.fromTo(
        element,
        { y: rising ? NUDGE : -NUDGE },
        { y: 0, duration: DURATION.base, ease: "expo.out", overwrite: "auto" },
      );
    }

    const kill = animateNumber(
      previous,
      value,
      (next) => {
        currentRef.current = next;
        element.textContent = formatRef.current(next);
      },
      { duration, onComplete: () => (currentRef.current = value) },
    );

    return kill;
  }, [value, duration, flash]);

  // Clear the direction so the same direction can re-trigger later.
  useEffect(() => {
    if (!direction) return;
    const timeout = window.setTimeout(() => setDirection(null), 700);
    return () => window.clearTimeout(timeout);
  }, [direction]);

  return (
    <span
      ref={ref}
      className={cn("tabular inline-block will-change-transform", className)}
      data-direction={direction ?? undefined}
      // Server render shows the real value, so the figure is correct and
      // readable before the tween runs.
      suppressHydrationWarning
    >
      {format(from ?? value)}
    </span>
  );
}
