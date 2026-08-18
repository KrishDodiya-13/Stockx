"use client";

import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { useReducedMotion } from "@/hooks/use-reduced-motion";

interface SmoothScrollValue {
  readonly lenis: Lenis | null;
  scrollTo(target: string | number | HTMLElement, options?: { offset?: number }): void;
}

const SmoothScrollContext = createContext<SmoothScrollValue>({
  lenis: null,
  scrollTo: () => {},
});

export function useSmoothScroll(): SmoothScrollValue {
  return useContext(SmoothScrollContext);
}

/**
 * Lenis-driven smooth scrolling, wired into GSAP ScrollTrigger.
 *
 * Lenis is skipped entirely under prefers-reduced-motion — a user who asked for
 * no motion should get the browser's own instant scrolling, not a gentler
 * version of ours.
 */
export function SmoothScrollProvider({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    document.documentElement.classList.remove("no-js");
    document.documentElement.classList.add("js-ready");
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    const instance = new Lenis({
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      // Native momentum on touch beats an emulated version.
      syncTouch: false,
      touchMultiplier: 1.6,
      /*
        Hand wheel events back to the page inside anything marked
        `data-lenis-prevent`.

        Without this, scrolling to zoom the price chart *also* scrolls the
        document: the canvas calls preventDefault, but the event still bubbles
        to Lenis on window, which happily scrolls. The chart container carries
        the attribute, as does any internally scrollable panel.
      */
      prevent: (node) =>
        node.hasAttribute?.("data-lenis-prevent") ||
        node.closest?.("[data-lenis-prevent]") !== null,
    });

    // Drive Lenis from GSAP's ticker so scroll and animation share one clock.
    const update = (time: number): void => instance.raf(time * 1000);
    gsap.ticker.add(update);
    gsap.ticker.lagSmoothing(0);

    instance.on("scroll", ScrollTrigger.update);
    ScrollTrigger.refresh();

    setLenis(instance);

    return () => {
      gsap.ticker.remove(update);
      instance.destroy();
      setLenis(null);
    };
  }, [reducedMotion]);

  /*
    A route *change* lands at the top. Arriving does not.

    This previously reset the scroll position every time the effect ran, which
    includes mount — and it runs twice there, since `lenis` goes from null to an
    instance. The result was that any deep link carrying a hash was silently
    undone: the browser jumped to the section, then Lenis pulled the page back
    to the top a moment later. Opening `/#market`, or sharing a link to any
    landing section, always landed on the hero.

    Comparing against the previous pathname distinguishes the two cases. The
    trigger refresh still runs on every pass, because that only re-measures.
  */
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    const changedRoute = previousPath.current !== null && previousPath.current !== pathname;
    previousPath.current = pathname;

    if (changedRoute) {
      lenis?.scrollTo(0, { immediate: true });
    } else if (lenis) {
      /*
        Re-run any incoming hash jump through Lenis.

        The browser's own jump moves the document but tells Lenis nothing, so
        Lenis keeps reporting position 0 — and since ScrollTrigger is updated
        from Lenis's scroll events, every trigger below the fold stays unfired.
        The section is reached and then rendered blank, because its reveal
        animations are still sitting at their hidden start state. It only
        corrects itself once the user scrolls manually and Lenis resyncs.

        Scrolling through Lenis instead keeps one source of truth for the
        position, which is the reason it drives ScrollTrigger in the first place.
      */
      const hash = window.location.hash;
      if (hash.length > 1) {
        try {
          const target = document.querySelector<HTMLElement>(hash);
          if (target) lenis.scrollTo(target, { immediate: true });
        } catch {
          // A hash that is not a valid selector is just not a target.
        }
      }
    }

    ScrollTrigger.refresh();
  }, [pathname, lenis]);

  const value: SmoothScrollValue = {
    lenis,
    scrollTo: (target, options) => {
      if (lenis) {
        lenis.scrollTo(target, { offset: options?.offset ?? 0 });
        return;
      }
      // Reduced-motion path: jump, don't glide.
      const element =
        typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
      if (typeof element === "number") window.scrollTo(0, element);
      else element?.scrollIntoView({ behavior: "auto", block: "start" });
    },
  };

  return <SmoothScrollContext.Provider value={value}>{children}</SmoothScrollContext.Provider>;
}
