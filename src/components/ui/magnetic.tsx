"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { ensureGsap } from "@/lib/animation/gsap-core";

/**
 * Magnetic hover.
 *
 * The child drifts a few pixels toward the pointer while it is inside, then
 * springs back. The travel is deliberately small — this should register as
 * responsiveness, not as the button running away.
 *
 * Wraps rather than replaces a button, so it composes with any control and
 * cannot interfere with its semantics, focus behaviour or keyboard handling.
 * Disabled on touch (no hover to speak of) and under reduced motion.
 */
export function Magnetic({
  children,
  className,
  /** Maximum travel in pixels. */
  strength = 6,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const element = ref.current;
    if (!element || reducedMotion) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const gsap = ensureGsap();
    const moveX = gsap.quickTo(element, "x", { duration: 0.5, ease: "power3.out" });
    const moveY = gsap.quickTo(element, "y", { duration: 0.5, ease: "power3.out" });

    const onMove = (event: PointerEvent): void => {
      const rect = element.getBoundingClientRect();
      // Offset from the element's centre, normalised to [-1, 1].
      const offsetX = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const offsetY = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);

      moveX(Math.max(-1, Math.min(1, offsetX)) * strength);
      moveY(Math.max(-1, Math.min(1, offsetY)) * strength);
    };

    const onLeave = (): void => {
      moveX(0);
      moveY(0);
    };

    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);

    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
      // Clear the transform so the element does not stay displaced.
      gsap.set(element, { x: 0, y: 0 });
    };
  }, [reducedMotion, strength]);

  return (
    <span ref={ref} className={cn("inline-block will-change-transform", className)}>
      {children}
    </span>
  );
}
