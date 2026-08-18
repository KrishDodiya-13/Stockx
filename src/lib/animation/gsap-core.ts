"use client";

/**
 * GSAP setup and shared animation primitives.
 *
 * Every GSAP call in the application goes through this module. Two reasons:
 *
 *  1. ScrollTrigger must be registered exactly once, before any tween that
 *     uses it. Registering ad hoc inside components is a race waiting to
 *     happen.
 *
 *  2. Reduced motion has to be honoured by *every* animation, not by whichever
 *     ones the author remembered. `gsap.matchMedia` handles that centrally:
 *     animations declared inside `respectMotion` simply do not run when the
 *     user has asked for reduced motion, and GSAP reverts them cleanly.
 */

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { DURATION, EASE, STAGGER, TRAVEL } from "@/lib/animation/motion-tokens";

let registered = false;

/** Idempotent. Safe to call from any component. */
export function ensureGsap(): typeof gsap {
  if (!registered && typeof window !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
    // Never drop frames to "catch up" after a stall; a jump is worse than a
    // slightly late animation.
    gsap.ticker.lagSmoothing(0);
    registered = true;
  }
  return gsap;
}

export { gsap, ScrollTrigger };

export type AnimationTarget = gsap.TweenTarget;

export interface RevealOptions {
  /** Seconds before the animation starts. */
  delay?: number;
  /** Seconds between siblings. */
  stagger?: number;
  duration?: number;
  /** Pixels of travel. */
  distance?: number;
  /** ScrollTrigger start position. Omit to run immediately on mount. */
  start?: string;
  /** The element ScrollTrigger observes. Defaults to the target. */
  trigger?: Element | null;
  onComplete?: () => void;
}

/**
 * The standard entrance: rise and fade.
 *
 * Returns the tween so a caller can kill it; prefer wrapping calls in a
 * `gsap.context` and reverting that instead.
 */
export function animateReveal(
  target: AnimationTarget,
  options: RevealOptions = {},
): gsap.core.Tween {
  const g = ensureGsap();
  const {
    delay = 0,
    stagger = STAGGER.base,
    duration = DURATION.reveal,
    distance = TRAVEL.base,
    start,
    trigger,
    onComplete,
  } = options;

  return g.fromTo(
    target,
    { opacity: 0, y: distance },
    {
      opacity: 1,
      y: 0,
      duration,
      delay,
      stagger,
      ease: EASE.out,
      onComplete,
      ...(start
        ? { scrollTrigger: { trigger: trigger ?? (target as Element), start, once: true } }
        : {}),
    },
  );
}

/** Fade with no travel — for things that should not appear to move. */
export function animateFade(
  target: AnimationTarget,
  options: RevealOptions = {},
): gsap.core.Tween {
  const g = ensureGsap();
  const { delay = 0, stagger = STAGGER.base, duration = DURATION.base, start, trigger } = options;

  return g.fromTo(
    target,
    { opacity: 0 },
    {
      opacity: 1,
      duration,
      delay,
      stagger,
      ease: EASE.outSoft,
      ...(start
        ? { scrollTrigger: { trigger: trigger ?? (target as Element), start, once: true } }
        : {}),
    },
  );
}

export interface SlideOptions extends RevealOptions {
  from?: "left" | "right" | "top" | "bottom";
}

export function animateSlide(target: AnimationTarget, options: SlideOptions = {}): gsap.core.Tween {
  const g = ensureGsap();
  const {
    from = "bottom",
    delay = 0,
    stagger = STAGGER.base,
    duration = DURATION.base,
    distance = TRAVEL.base,
    start,
    trigger,
  } = options;

  const axis = from === "left" || from === "right" ? "x" : "y";
  const sign = from === "left" || from === "top" ? -1 : 1;

  return g.fromTo(
    target,
    { opacity: 0, [axis]: distance * sign },
    {
      opacity: 1,
      [axis]: 0,
      duration,
      delay,
      stagger,
      ease: EASE.out,
      ...(start
        ? { scrollTrigger: { trigger: trigger ?? (target as Element), start, once: true } }
        : {}),
    },
  );
}

export function animateScale(target: AnimationTarget, options: RevealOptions = {}): gsap.core.Tween {
  const g = ensureGsap();
  const { delay = 0, stagger = STAGGER.tight, duration = DURATION.base, start, trigger } = options;

  return g.fromTo(
    target,
    // A subtle scale — 0.96, not 0.5. Anything more reads as a popup.
    { opacity: 0, scale: 0.96 },
    {
      opacity: 1,
      scale: 1,
      duration,
      delay,
      stagger,
      ease: EASE.out,
      ...(start
        ? { scrollTrigger: { trigger: trigger ?? (target as Element), start, once: true } }
        : {}),
    },
  );
}

/**
 * Masked line reveal — text sliding up from behind a clip.
 *
 * Expects markup where each line is wrapped in an `overflow: hidden` element,
 * which `SplitLines` produces.
 */
export function animateMaskedLines(
  target: AnimationTarget,
  options: RevealOptions = {},
): gsap.core.Tween {
  const g = ensureGsap();
  const { delay = 0, stagger = STAGGER.base, duration = DURATION.reveal, start, trigger } = options;

  /*
    `y: 0` in both states, alongside `yPercent`.

    Elements carrying the `[data-animate="mask"]` start state already have a
    `translate3d(0, 105%, 0)` from CSS, which GSAP parses into pixel `y`. Left
    alone that stacks with the `yPercent: 105` below — a 210% offset going in,
    and a line still displaced by 105% coming out, because clearing `yPercent`
    never touches the pixels. Pinning `y` to 0 in both states makes `yPercent`
    the only thing that moves.
  */
  return g.fromTo(
    target,
    { y: 0, yPercent: 105, opacity: 0 },
    {
      y: 0,
      yPercent: 0,
      opacity: 1,
      duration,
      delay,
      stagger,
      ease: EASE.out,
      ...(start
        ? { scrollTrigger: { trigger: trigger ?? (target as Element), start, once: true } }
        : {}),
    },
  );
}

/**
 * Tween a number and hand each frame's value to a renderer.
 *
 * The engine behind every animated figure. Returns a kill function so callers
 * can cancel cleanly on unmount or when the target changes mid-flight.
 */
export function animateNumber(
  from: number,
  to: number,
  onUpdate: (value: number) => void,
  options: { duration?: number; ease?: string; onComplete?: () => void } = {},
): () => void {
  const g = ensureGsap();
  const state = { value: from };

  const tween = g.to(state, {
    value: to,
    duration: options.duration ?? DURATION.slow,
    ease: options.ease ?? EASE.out,
    onUpdate: () => onUpdate(state.value),
    onComplete: () => {
      onUpdate(to);
      options.onComplete?.();
    },
  });

  return () => tween.kill();
}

/**
 * Run animations only when motion is allowed.
 *
 * `gsap.matchMedia` scopes everything declared inside, so reverting the
 * returned context also restores every element to its natural state — which is
 * exactly what a reduced-motion user should see.
 */
export function respectMotion(
  scope: Element | null,
  build: (context: gsap.Context) => void,
): () => void {
  const g = ensureGsap();
  const media = g.matchMedia();

  media.add("(prefers-reduced-motion: no-preference)", (context) => {
    build(context);
  });

  return () => media.revert();
}

