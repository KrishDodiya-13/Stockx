"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { ensureGsap } from "@/lib/animation/gsap-core";
import { DURATION, EASE, TRAVEL } from "@/lib/animation/motion-tokens";

/**
 * Route transition.
 *
 * A short rise-and-fade on each navigation. Deliberately *entrance only* — an
 * exit animation would delay every navigation by its own duration, which makes
 * an application feel slower, not more polished.
 *
 * Keyed on pathname so it replays per route, and skipped entirely under
 * reduced motion.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (reducedMotion) {
      // Ensure content is visible if motion was disabled mid-session.
      element.style.opacity = "1";
      element.style.transform = "none";
      return;
    }

    const gsap = ensureGsap();
    const tween = gsap.fromTo(
      element,
      { opacity: 0, y: TRAVEL.small },
      { opacity: 1, y: 0, duration: DURATION.base, ease: EASE.out, clearProps: "transform" },
    );

    return () => {
      tween.kill();
    };
  }, [pathname, reducedMotion]);

  return (
    <div ref={ref} className="min-h-full">
      {children}
    </div>
  );
}
