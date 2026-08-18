"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { ScrollTrigger, ensureGsap, respectMotion } from "@/lib/animation/gsap-core";

/**
 * Layout effect on the client, plain effect on the server.
 *
 * The horizontal track decides its own axis on mount. Running that in a passive
 * effect would paint the stacked layout first and snap to horizontal a frame
 * later — a visible flash. `useLayoutEffect` settles it before paint, and the
 * server never runs either, so React's SSR warning is avoided.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

interface ParallaxOptions {
  /**
   * Pixels the element travels across the whole scroll pass. Negative moves it
   * against the scroll (the classic "further away" read).
   */
  distance?: number;
  /** Animate a descendant selector instead of the element itself. */
  selector?: string;
  enabled?: boolean;
}

/**
 * Scroll-linked parallax.
 *
 * Deliberately small in amplitude. Parallax reads as depth at 40–80px of
 * travel; beyond that it reads as things sliding around, which is the failure
 * mode that makes a site feel like a toy rather than a product.
 *
 * Only `y` is animated — a transform, so it stays on the compositor and never
 * triggers layout. `scrub` ties it to scroll position rather than to a
 * timeline, so it tracks the user's own movement instead of playing at them.
 */
export function useParallax<T extends HTMLElement = HTMLDivElement>(
  options: ParallaxOptions = {},
): RefObject<T | null> {
  const ref = useRef<T>(null);
  const { distance = -60, selector, enabled = true } = options;

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

        const gsap = ensureGsap();
        gsap.fromTo(
          Array.from(targets),
          { y: -distance / 2 },
          {
            y: distance / 2,
            ease: "none",
            scrollTrigger: {
              trigger: element,
              start: "top bottom",
              end: "bottom top",
              scrub: true,
              // Recalculated only on resize; Lenis drives updates otherwise.
              invalidateOnRefresh: true,
            },
          },
        );
      });
    });
  }, [distance, selector, enabled]);

  return ref;
}

/** Below this width, pinning fights the user's thumb rather than helping. */
const HORIZONTAL_MIN_WIDTH = 901;

/**
 * Horizontal scroll section.
 *
 * Pins a container and translates its track sideways as the user scrolls
 * vertically. The scroll distance is derived from the track's actual width, so
 * the section ends exactly when the last panel is flush — a hardcoded distance
 * leaves either dead scrolling or a clipped final panel.
 *
 * ── `active` is not optional ───────────────────────────────────────────────
 *
 * The hook reports whether the pin is installed, and the caller *must* drive
 * its layout from it. A track laid out horizontally without the translate is
 * clipped by its own overflow and the later panels become unreachable — which
 * is exactly what happens under reduced motion, and on any viewport between a
 * CSS breakpoint and this one. Deriving the layout from `active` rather than
 * from a media query keeps the two in step by construction.
 *
 * Both conditions live in one `gsap.matchMedia` query, so resizing across the
 * threshold or changing the motion preference re-evaluates cleanly.
 */
export function useHorizontalScroll<T extends HTMLElement = HTMLDivElement>(): {
  containerRef: RefObject<T | null>;
  trackRef: RefObject<HTMLDivElement | null>;
  active: boolean;
} {
  const containerRef = useRef<T>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    const track = trackRef.current;
    if (!container || !track) return;

    const gsap = ensureGsap();
    const media = gsap.matchMedia();

    media.add(
      `(min-width: ${HORIZONTAL_MIN_WIDTH}px) and (prefers-reduced-motion: no-preference)`,
      () => {
        setActive(true);

        const distance = (): number => Math.max(0, track.scrollWidth - window.innerWidth);

        gsap.to(track, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: container,
            start: "top top",
            // Scroll length equals the horizontal travel, so the two are 1:1
            // and the section cannot outlast its content.
            end: () => `+=${distance()}`,
            pin: true,
            scrub: 0.6,
            invalidateOnRefresh: true,
            anticipatePin: 1,
          },
        });

        /*
          Re-measure when the track's own size changes.

          ScrollTrigger refreshes on window resize, but not when content
          reflows without one — a late-loading panel or a font swap changes the
          track's width and leaves the pin's end position stale, so the section
          would stop scrolling before the last panel arrives.
        */
        const observer = new ResizeObserver(() => ScrollTrigger.refresh());
        observer.observe(track);

        // Runs when the query stops matching, so the layout falls back with it.
        return () => {
          observer.disconnect();
          setActive(false);
        };
      },
    );

    return () => {
      media.revert();
      setActive(false);
    };
  }, []);

  return { containerRef, trackRef, active };
}
