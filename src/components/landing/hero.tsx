"use client";

import { useEffect, useRef } from "react";

import { MarketTicker } from "@/components/market/market-ticker";
import { ButtonLink } from "@/components/ui/button";
import { VirtualMoneyBadge } from "@/components/ui/data-source-badge";
import { Magnetic } from "@/components/ui/magnetic";
import { useParallax } from "@/hooks/use-parallax";
import { ensureGsap, respectMotion } from "@/lib/animation/gsap-core";
import { DURATION, EASE, HERO_BADGE_DELAY, STAGGER } from "@/lib/animation/motion-tokens";
import { INDEX_IDS, instrumentId } from "@/services/market-data";

const TICKER_IDS = [
  ...INDEX_IDS,
  ...["RELIANCE", "HDFCBANK", "TCS", "INFY", "SBIN", "ITC", "TATAMOTORS", "BHARTIARTL", "LT", "AXISBANK"].map(
    (symbol) => instrumentId("NSE", symbol),
  ),
];

const LINES = ["TRADE", "WITHOUT", "RISK."];

/**
 * The hero.
 *
 * One entrance timeline, built from the shared motion tokens rather than
 * bespoke durations, and wrapped in `respectMotion` so a reduced-motion visitor
 * gets the finished layout with nothing moving.
 *
 * The hidden start states live in CSS (`[data-animate]`), so the words are
 * never visible for a frame before the animation takes over — and the same CSS
 * unhides them when JavaScript is unavailable.
 */
export function Hero() {
  const rootRef = useRef<HTMLElement>(null);
  // The ticker drifts slightly against the scroll, which separates it from the
  // headline without moving enough to notice as an effect.
  const tickerRef = useParallax<HTMLDivElement>({ distance: -28 });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    return respectMotion(root, (context) => {
      context.add(() => {
        const gsap = ensureGsap();

        gsap
          /*
            Brand → badge → headline → supporting → rule.

            The delay is the header wordmark's reveal: the brand establishes who
            this is, the badge establishes what it is, and only then does the
            headline arrive. The headline stays the dominant element — it is the
            largest thing on the page and holds the longest beat — but it is no
            longer the first thing to move.
          */
          .timeline({ delay: HERO_BADGE_DELAY, defaults: { ease: EASE.out } })
          .to("[data-hero='badge']", {
            y: 0,
            opacity: 1,
            duration: DURATION.slow,
          })
          /*
            Both `y` and `yPercent` are cleared, and that is not belt-and-braces.

            The start state lives in CSS as `translate3d(0, 105%, 0)`. GSAP
            parses an existing transform into its *pixel* `y`, leaving
            `yPercent` at 0 — so animating `yPercent: 0` alone was a tween from
            0 to 0, a no-op that left the line sitting at its 105% offset,
            clipped by the wrapper and invisible. The headline never appeared.

            `rise` was unaffected because it animates `y`, which is where its
            CSS offset had been parsed to — which is why only the masked lines
            broke, and why the failure looked so arbitrary.
          */
          .to(
            "[data-animate='mask'] > *",
            {
              y: 0,
              yPercent: 0,
              opacity: 1,
              duration: DURATION.reveal,
              stagger: STAGGER.loose,
            },
            "-=0.35",
          )
          // Everything except the badge, which has already landed. Without the
          // exclusion it would be animated a second time from its resting state.
          .to(
            "[data-animate='rise']:not([data-hero='badge'])",
            { y: 0, opacity: 1, duration: DURATION.slow, stagger: STAGGER.base },
            "-=0.85",
          )
          .to(
            "[data-animate='rule']",
            { scaleX: 1, duration: 1.4, ease: EASE.inOut },
            "-=1.1",
          );
      });
    });
  }, []);

  return (
    <section
      ref={rootRef}
      className="relative flex min-h-[100svh] flex-col justify-between pt-28 md:pt-32"
    >
      <div className="gutter flex flex-1 flex-col justify-center">
        {/* `data-hero="badge"` separates this from the supporting content so
            the entrance can land it before the headline. It keeps
            `data-animate="rise"` for the CSS start state and the no-JS reset. */}
        <div className="flex items-center gap-4" data-animate="rise" data-hero="badge">
          <VirtualMoneyBadge />
          <span className="hidden text-[0.6875rem] tracking-[0.14em] text-ink-tertiary uppercase sm:inline">
            No real money · No real orders
          </span>
        </div>

        <h1 className="mt-10 text-display-xl md:mt-14">
          {LINES.map((line) => (
            <span key={line} className="block overflow-hidden pb-[0.04em]" data-animate="mask">
              <span className="block">{line}</span>
            </span>
          ))}
        </h1>

        <div className="mt-12 grid gap-10 md:mt-16 md:grid-cols-12 md:items-end">
          <p
            className="max-w-md text-lg leading-[1.45] text-ink-secondary md:col-span-5 md:text-xl"
            data-animate="rise"
          >
            Practice the market.
            <br />
            Build strategies.
            <br />
            <span className="text-ink">Master your decisions.</span>
          </p>

          <div
            className="flex flex-wrap items-center gap-3 md:col-span-4 md:col-start-9 md:justify-end"
            data-animate="rise"
          >
            <Magnetic>
              <ButtonLink href="/dashboard" size="lg">
                Start paper trading
              </ButtonLink>
            </Magnetic>
            <Magnetic>
              <ButtonLink href="#capital" variant="secondary" size="lg">
                How it works
              </ButtonLink>
            </Magnetic>
          </div>
        </div>
      </div>

      <div ref={tickerRef} className="mt-16">
        <div className="h-px bg-line" data-animate="rule" aria-hidden />
        <MarketTicker instrumentIds={TICKER_IDS} />
        <div className="h-px bg-line" aria-hidden />
      </div>
    </section>
  );
}
