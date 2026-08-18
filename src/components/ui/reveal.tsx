"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, type ElementType, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "@/hooks/use-reduced-motion";

type RevealVariant = "rise" | "mask";

interface RevealProps {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  variant?: RevealVariant;
  /** Seconds before this element starts. */
  delay?: number;
  /** Seconds between children when `stagger` targets are present. */
  stagger?: number;
  /** Start position for ScrollTrigger. */
  start?: string;
  /** Fire immediately on mount instead of on scroll (for above-the-fold). */
  immediate?: boolean;
}

/**
 * Scroll-triggered reveal.
 *
 * `mask` slides children up from behind an overflow clip — the effect wants one
 * wrapping element per line, which `SplitLines` provides.
 *
 * The hidden start state comes from CSS (`[data-animate]`), so content is never
 * visible for a frame before the animation takes over. Under reduced motion the
 * CSS unhides everything and this component does nothing at all.
 */
export function Reveal({
  children,
  className,
  as: Tag = "div",
  variant = "rise",
  delay = 0,
  stagger = 0.08,
  start = "top 85%",
  immediate = false,
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (prefersReducedMotion()) return;

    gsap.registerPlugin(ScrollTrigger);

    const context = gsap.context(() => {
      const targets =
        variant === "mask"
          ? element.querySelectorAll<HTMLElement>("[data-animate='mask'] > *")
          : element.querySelectorAll<HTMLElement>("[data-animate='rise']");

      const list = targets.length > 0 ? Array.from(targets) : [element];

      const animation =
        variant === "mask"
          // `y` as well as `yPercent`: the CSS start state is a percentage
          // transform, which GSAP parses into pixel `y`. Clearing only
          // `yPercent` animates 0 to 0 and leaves the line hidden.
          ? { y: 0, yPercent: 0, opacity: 1, duration: 1.1, ease: "expo.out", stagger }
          : { y: 0, opacity: 1, duration: 0.95, ease: "expo.out", stagger };

      gsap.to(list, {
        ...animation,
        delay,
        ...(immediate
          ? {}
          : {
              scrollTrigger: {
                trigger: element,
                start,
                once: true,
              },
            }),
      });
    }, element);

    return () => context.revert();
  }, [delay, immediate, stagger, start, variant]);

  return (
    <Tag ref={ref} className={cn(className)} data-reveal={variant}>
      {children}
    </Tag>
  );
}

/**
 * Splits text into per-line masked rows for the `mask` reveal. Lines are
 * authored explicitly rather than measured, which keeps the effect stable
 * across fonts and breakpoints.
 */
export function SplitLines({
  lines,
  className,
  lineClassName,
}: {
  lines: readonly string[];
  className?: string;
  lineClassName?: string;
}) {
  return (
    <span className={cn("block", className)}>
      {lines.map((line) => (
        <span key={line} className="block overflow-hidden pb-[0.06em]" data-animate="mask">
          <span className={cn("block", lineClassName)}>{line}</span>
        </span>
      ))}
    </span>
  );
}
