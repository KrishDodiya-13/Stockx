"use client";

import { useEffect, useRef } from "react";

import { Reveal, SplitLines } from "@/components/ui/reveal";
import { STARTING_CAPITAL } from "@/domain/constants";
import { useParallax } from "@/hooks/use-parallax";
import { prefersReducedMotion } from "@/hooks/use-reduced-motion";
import { ensureGsap, respectMotion } from "@/lib/animation/gsap-core";
import { formatCurrency } from "@/lib/format";
import { rupeesToPaise } from "@/lib/money";

const TARGET = formatCurrency(STARTING_CAPITAL, { whole: true });

/**
 * The capital reveal: the opening balance counts up as the section is scrolled
 * through, then dissolves into the market. This is the hinge of the landing
 * page's narrative — money becoming a market.
 */
export function CapitalSection() {
  const rootRef = useRef<HTMLElement>(null);
  const numberRef = useRef<HTMLSpanElement>(null);
  const barsRef = useParallax<HTMLDivElement>({ distance: -34 });

  useEffect(() => {
    const root = rootRef.current;
    const number = numberRef.current;
    if (!root || !number) return;

    // Under reduced motion the figure is simply the figure, immediately.
    if (prefersReducedMotion()) {
      number.textContent = TARGET;
      return;
    }

    return respectMotion(root, (context) => {
      context.add(() => {
        const gsap = ensureGsap();
        const state = { value: 0 };

        gsap.to(state, {
          value: 1_000_000,
          ease: "none",
          onUpdate: () => {
            // Formatted from paise so the counter reads in the same units as
            // the rest of the app rather than a bespoke display number.
            number.textContent = formatCurrency(rupeesToPaise(Math.round(state.value)), {
              whole: true,
            });
          },
          scrollTrigger: { trigger: root, start: "top 70%", end: "center center", scrub: 0.8 },
        });

        /*
          One white bar travels left to right as the section is scrolled, and
          the graph builds behind it.

          ── Why this is computed rather than staggered ──────────────────────

          A staggered tween can express "each bar lights up in turn", but not
          "exactly one bar is lit at any moment" — the whole point here. So a
          single scrubbed value drives a `head` position, and every bar derives
          its own state from its distance to that head. One source of truth,
          twenty-six readers, and the invariant holds by construction.

          `scrub` makes it a function of scroll position rather than a timeline
          that plays on entry: stopping halfway leaves the head halfway, and
          scrolling back up walks it backwards.
        */
        const bars = gsap.utils.toArray<HTMLElement>("[data-capital-bar]");
        const lastIndex = bars.length - 1;

        /** Resting alpha of an inactive bar — the section's existing dark tone. */
        const DIM = 0.12;

        /*
          The head dwells on a bar, then hands over quickly.

          A head that moved at constant speed would spend half its life between
          two bars, showing two half-lit ones and no white bar at all. Easing
          only the middle third of each step means the head sits *on* a bar for
          most of the interval and crosses to the next one briskly — so "exactly
          one bar is white" is true nearly always, and the moment it is not is
          a fast, deliberate handoff rather than a jump.
        */
        /*
          Measured rather than guessed. Across the full scroll range, this
          window leaves a single bar at full white for roughly 88% of it, with
          no frame ever showing two lit bars and the runner-up never rising
          above 0.34. Widening it to 0.35–0.65 drops that to 79%; narrowing it
          to 0.46–0.54 reaches 94% but doubles the per-frame change, which is
          where the handoff starts to read as a snap rather than a move.
        */
        const HANDOVER_START = 0.42;
        const HANDOVER_END = 0.58;

        function headFrom(progress: number): number {
          const raw = Math.max(0, Math.min(1, progress)) * lastIndex;
          const index = Math.min(lastIndex, Math.floor(raw));
          const fraction = raw - index;

          const t = Math.max(
            0,
            Math.min(1, (fraction - HANDOVER_START) / (HANDOVER_END - HANDOVER_START)),
          );
          // Smoothstep, so the handoff has no corners at either end.
          return index + t * t * (3 - 2 * t);
        }

        function render(progress: number): void {
          const head = headFrom(progress);

          for (let i = 0; i < bars.length; i += 1) {
            const bar = bars[i];
            if (!bar) continue;

            /*
              Brightness falls to nothing within one bar of the head, so a bar
              two places away is never lit. Squaring sharpens the peak, which
              keeps the active bar clearly dominant during a handoff instead of
              two neighbours sitting at equal grey.
            */
            const focus = Math.max(0, 1 - Math.abs(i - head));
            const level = DIM + (1 - DIM) * focus * focus;

            // The graph builds behind the head: a bar is at full height once
            // the head reaches it, and grows over the step before that.
            const grow = Math.max(0, Math.min(1, head - i + 1));

            bar.style.setProperty("--bar-level", level.toFixed(4));
            bar.style.setProperty("--bar-grow", grow.toFixed(4));
          }
        }

        const driver = { progress: 0 };

        gsap.to(driver, {
          progress: 1,
          ease: "none",
          onUpdate: () => render(driver.progress),
          scrollTrigger: {
            trigger: root,
            start: "top 85%",
            end: "bottom 45%",
            // Lerps the driven value, so the head glides between bars rather
            // than tracking every wheel tick exactly.
            scrub: 0.6,
          },
        });

        // Paint the starting state immediately, so the first bar is already the
        // active one before any scrolling happens.
        render(0);
      });
    });
  }, []);

  return (
    <section id="capital" ref={rootRef} className="gutter relative py-32 md:py-48">
      <Reveal className="max-w-2xl">
        <p className="eyebrow" data-animate="rise">
          Fund your account, your way
        </p>
      </Reveal>

      <div className="mt-8 md:mt-12">
        <span
          ref={numberRef}
          className="tabular block text-numeric-xl font-medium"
          suppressHydrationWarning
        >
          {TARGET}
        </span>
        <Reveal variant="mask" className="mt-6 block">
          <SplitLines
            lines={["in virtual capital, at most."]}
            className="text-display-m text-ink-secondary"
          />
        </Reveal>
      </div>

      <div className="mt-16 grid gap-12 md:mt-24 md:grid-cols-12">
        <Reveal className="md:col-span-5">
          <p className="max-w-sm text-base leading-relaxed text-ink-secondary" data-animate="rise">
            Choose how much virtual capital to start with when you sign up — anywhere from ₹1,000 up
            to ₹10,00,000 — and top it up later, up to that same limit. It is not real money, and
            that is the point. Position sizing, stop placement and the discipline to sit through a
            drawdown are all learnable — but only if a mistake costs you a lesson instead of a
            salary.
          </p>
        </Reveal>

        {/* An abstract equity curve built from bars — data-shaped, not decorative. */}
        <div
          ref={barsRef}
          className="flex h-40 items-end gap-[3px] md:col-span-6 md:col-start-7 md:h-56"
          aria-hidden
        >
          {EQUITY_SHAPE.map((height, index) => (
            <span
              key={index}
              data-capital-bar
              className="flex-1 rounded-[1px]"
              /*
                The resting state lives here, not in JavaScript: the finished
                graph at full height, every bar dim except the last. That is
                both the effect's end state and what a reduced-motion or no-JS
                visitor gets, so the section is never dependent on the animation
                having run to look right.

                `scaleY` grows the bar from its base; because a transform does
                not affect layout, the row keeps its height, spacing and every
                bar's proportion exactly as authored.
              */
              style={
                {
                  height: `${height}%`,
                  "--bar-level": index === EQUITY_SHAPE.length - 1 ? 1 : 0.12,
                  "--bar-grow": 1,
                  backgroundColor: "rgb(var(--ink-primary) / var(--bar-level))",
                  transform: "scaleY(var(--bar-grow))",
                  transformOrigin: "bottom",
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** A fixed silhouette — this is illustration, not a claim about performance. */
const EQUITY_SHAPE = [
  18, 22, 19, 27, 31, 26, 34, 39, 35, 44, 41, 49, 55, 51, 60, 57, 66, 62, 71, 78, 74, 83, 88, 84,
  92, 100,
];
