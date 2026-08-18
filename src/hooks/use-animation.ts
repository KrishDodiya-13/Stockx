"use client";

import { useEffect, useRef, type RefObject } from "react";

import {
  animateFade,
  animateMaskedLines,
  animateReveal,
  animateScale,
  animateSlide,
  ensureGsap,
  respectMotion,
  type SlideOptions,
} from "@/lib/animation/gsap-core";

export type AnimationKind = "reveal" | "fade" | "slide" | "scale" | "mask";

interface UseAnimateOptions extends SlideOptions {
  kind?: AnimationKind;
  /** CSS selector for descendants to animate. Omit to animate the root. */
  selector?: string;
  /** Skip entirely — for conditional content. */
  enabled?: boolean;
}

/**
 * Declarative entrance animation.
 *
 * Replaces the hand-rolled `useEffect` + `gsap.context` + reduced-motion check
 * that was previously copy-pasted into each animated component. Everything runs
 * inside `respectMotion`, so a reduced-motion user gets the natural layout with
 * no tweens at all — and `gsap.context` reverts every property on unmount.
 */
export function useAnimate<T extends HTMLElement = HTMLDivElement>(
  options: UseAnimateOptions = {},
): RefObject<T | null> {
  const ref = useRef<T>(null);
  const { kind = "reveal", selector, enabled = true, ...animation } = options;

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    ensureGsap();

    return respectMotion(element, (context) => {
      context.add(() => {
        const targets = selector
          ? element.querySelectorAll<HTMLElement>(selector)
          : [element];
        if (targets.length === 0) return;

        const list = Array.from(targets);

        switch (kind) {
          case "fade":
            animateFade(list, animation);
            break;
          case "slide":
            animateSlide(list, animation);
            break;
          case "scale":
            animateScale(list, animation);
            break;
          case "mask":
            animateMaskedLines(list, animation);
            break;
          default:
            animateReveal(list, animation);
        }
      });
    });
    // Options are read once on mount; entrance animations do not re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, kind, selector]);

  return ref;
}

/**
 * Scroll-triggered variant. Identical, but waits until the element enters the
 * viewport.
 */
export function useScrollAnimate<T extends HTMLElement = HTMLDivElement>(
  options: UseAnimateOptions = {},
): RefObject<T | null> {
  return useAnimate<T>({ start: "top 85%", ...options });
}
