"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { ensureGsap } from "@/lib/animation/gsap-core";

/**
 * Custom desktop cursor.
 *
 * A small dot that trails the pointer and expands over interactive elements.
 * Deliberately restrained: it adds a sense of precision to a data interface,
 * and stops being a good idea the moment it competes for attention.
 *
 * It is switched off entirely when any of these hold, rather than degraded:
 *
 *   - the device has no fine pointer (touch) — there is no cursor to replace
 *   - the user asked for reduced motion
 *   - the pointer is over the chart canvas, whose own crosshair is the more
 *     precise instrument and must take priority
 *
 * The native cursor is only hidden once this component has decided it is
 * active, so a touch user or a reduced-motion user is never left without one.
 */
export function CursorProvider({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(false);

  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reducedMotion) {
      setActive(false);
      return;
    }

    // Fine pointer only. A coarse pointer means touch.
    const fine = window.matchMedia("(pointer: fine)");
    if (!fine.matches) {
      setActive(false);
      return;
    }

    setActive(true);
    const gsap = ensureGsap();

    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    // quickTo writes straight to the transform on each frame — far cheaper
    // than a React state update per mousemove, which would re-render the tree
    // at pointer frequency.
    const dotX = gsap.quickTo(dot, "x", { duration: 0.12, ease: "power3.out" });
    const dotY = gsap.quickTo(dot, "y", { duration: 0.12, ease: "power3.out" });
    const ringX = gsap.quickTo(ring, "x", { duration: 0.42, ease: "power3.out" });
    const ringY = gsap.quickTo(ring, "y", { duration: 0.42, ease: "power3.out" });

    let visible = false;

    const onMove = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse") return;

      if (!visible) {
        visible = true;
        gsap.to([dot, ring], { opacity: 1, duration: 0.2 });
      }

      dotX(event.clientX);
      dotY(event.clientY);
      ringX(event.clientX);
      ringY(event.clientY);

      const target = event.target as HTMLElement | null;

      // The chart owns its own crosshair; stand down over it.
      const overChart = target?.closest("[data-cursor='chart']") !== null;
      const interactive =
        target?.closest("a, button, input, select, textarea, [role='button'], [tabindex]") !== null;

      gsap.to(ring, {
        scale: overChart ? 0 : interactive ? 1.9 : 1,
        opacity: overChart ? 0 : 1,
        duration: 0.32,
        ease: "power3.out",
      });
      gsap.to(dot, {
        opacity: overChart ? 0 : 1,
        scale: interactive ? 0.55 : 1,
        duration: 0.32,
        ease: "power3.out",
      });

      /*
        Hide the native cursor through a class rather than an inline style.

        The class lets CSS carve out exceptions that an inline style on <html>
        cannot: text fields keep their I-beam, and the chart keeps its
        crosshair. Hiding the cursor everywhere would strip the caret indicator
        from every input on the trade ticket and the search field, which is a
        real loss of affordance for a decorative gain.
      */
      document.documentElement.classList.toggle("custom-cursor", !overChart);
    };

    const onLeave = (): void => {
      visible = false;
      gsap.to([dot, ring], { opacity: 0, duration: 0.2 });
      // Give the native cursor back the moment the pointer leaves the
      // document, so it is never left hidden outside the page.
      document.documentElement.classList.remove("custom-cursor");
    };

    const onDown = (): void => {
      gsap.to(ring, { scale: 1.35, duration: 0.18, ease: "power3.out" });
    };
    const onUp = (): void => {
      gsap.to(ring, { scale: 1, duration: 0.28, ease: "power3.out" });
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      // Always hand the real cursor back.
      document.documentElement.classList.remove("custom-cursor");
    };
  }, [reducedMotion]);

  return (
    <>
      {children}

      {active ? (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[200] hidden lg:block">
          <div
            ref={ringRef}
            className="absolute -left-4 -top-4 size-8 rounded-full border border-ink/40 opacity-0"
          />
          <div
            ref={dotRef}
            className="absolute -left-[3px] -top-[3px] size-1.5 rounded-full bg-ink opacity-0"
          />
        </div>
      ) : null}
    </>
  );
}
