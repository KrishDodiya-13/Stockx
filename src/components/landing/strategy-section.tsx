"use client";

import { useEffect, useRef } from "react";

import { Reveal, SplitLines } from "@/components/ui/reveal";
import { ensureGsap, respectMotion } from "@/lib/animation/gsap-core";
import { DURATION, EASE, STAGGER } from "@/lib/animation/motion-tokens";
import { cn } from "@/lib/cn";

interface Rule {
  readonly kind: "entry" | "target" | "stop";
  readonly condition: string;
  readonly action: string;
  readonly note: string;
}

/** Illustrates the IF/THEN grammar the builder produces. */
const RULES: readonly Rule[] = [
  {
    kind: "entry",
    condition: "RELIANCE price ≥ ₹1,420.00",
    action: "BUY 100 shares",
    note: "Entry",
  },
  {
    kind: "target",
    condition: "Position P&L ≥ +2.00%",
    action: "SELL 50 shares",
    note: "Target 1 · partial exit",
  },
  {
    kind: "target",
    condition: "Position P&L ≥ +5.00%",
    action: "SELL remaining 50 shares",
    note: "Target 2 · close",
  },
  {
    kind: "stop",
    condition: "Price ≤ ₹1,377.40",
    action: "SELL ALL",
    note: "Stop loss · −3.00%",
  },
];

export function StrategySection() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    return respectMotion(root, (context) => {
      context.add(() => {
        const gsap = ensureGsap();

        // Rules assemble in sequence — the block order *is* the execution
        // order, so animating it top-down teaches the model.
        gsap.from("[data-rule]", {
          opacity: 0,
          y: 36,
          duration: DURATION.reveal,
          ease: EASE.out,
          stagger: STAGGER.loose,
          scrollTrigger: { trigger: "[data-rule-list]", start: "top 78%", once: true },
        });

        gsap.from("[data-rule-connector]", {
          scaleY: 0,
          transformOrigin: "top",
          duration: DURATION.base,
          ease: EASE.outSoft,
          stagger: STAGGER.loose,
          delay: 0.25,
          scrollTrigger: { trigger: "[data-rule-list]", start: "top 78%", once: true },
        });
      });
    });
  }, []);

  return (
    <section id="strategy" ref={rootRef} className="gutter border-t border-line-subtle py-32 md:py-44">
      <div className="grid gap-16 md:grid-cols-12">
        <div className="md:col-span-5">
          <Reveal variant="mask">
            <p className="eyebrow mb-6">Strategy builder</p>
            <SplitLines lines={["If this,", "then that."]} className="text-display-l" />
          </Reveal>

          <Reveal className="mt-10">
            <p className="max-w-sm text-base leading-relaxed text-ink-secondary" data-animate="rise">
              Describe a plan the way you would say it out loud, and the engine holds you to it.
              Multiple targets, partial exits, stop losses and trailing stops compose into one
              ordered set of rules that runs without you watching the screen.
            </p>
          </Reveal>

          <Reveal className="mt-10">
            <ul className="flex flex-wrap gap-x-6 gap-y-3" data-animate="rise">
              {CONDITIONS.map((condition) => (
                <li key={condition} className="text-[0.8125rem] text-ink-tertiary">
                  {condition}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <div className="md:col-span-6 md:col-start-7">
          <ol data-rule-list className="relative">
            {RULES.map((rule, index) => (
              <li key={rule.condition} className="relative pb-4 last:pb-0">
                {index < RULES.length - 1 ? (
                  <span
                    data-rule-connector
                    aria-hidden
                    className="absolute left-6 top-full -mt-4 h-4 w-px bg-line"
                  />
                ) : null}

                <div data-rule className="glass rounded-sm p-5">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 rounded-full",
                        rule.kind === "entry" && "bg-ink",
                        rule.kind === "target" && "bg-up",
                        rule.kind === "stop" && "bg-down",
                      )}
                    />
                    <span className="eyebrow">{rule.note}</span>
                  </div>

                  <div className="mt-4 grid gap-2">
                    <p className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[0.6875rem] font-medium tracking-[0.14em] text-ink-tertiary">
                        IF
                      </span>
                      <span className="tabular text-[0.9375rem]">{rule.condition}</span>
                    </p>
                    <p className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[0.6875rem] font-medium tracking-[0.14em] text-ink-tertiary">
                        THEN
                      </span>
                      <span className="text-[0.9375rem] font-medium">{rule.action}</span>
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

const CONDITIONS = [
  "Price above / below",
  "% move",
  "Volume",
  "RSI",
  "MACD",
  "Moving average",
  "Bollinger Bands",
  "Position P&L",
  "Portfolio P&L",
  "Trailing stop",
];
