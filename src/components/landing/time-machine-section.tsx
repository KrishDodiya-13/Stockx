"use client";

import { useEffect, useRef } from "react";

import { Reveal, SplitLines } from "@/components/ui/reveal";
import { ensureGsap, respectMotion } from "@/lib/animation/gsap-core";

/**
 * The Time Machine teaser.
 *
 * The chart draws in from the left and stops dead at the playhead — the
 * unrevealed right side is the whole idea, so the animation is the argument:
 * you cannot see what has not happened yet.
 */
export function TimeMachineSection() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    return respectMotion(root, (context) => {
      context.add(() => {
        const gsap = ensureGsap();

        const path = root.querySelector<SVGPathElement>("[data-tm-path]");
        if (path) {
          const length = path.getTotalLength();
          gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
          gsap.to(path, {
            strokeDashoffset: 0,
            ease: "none",
            scrollTrigger: { trigger: root, start: "top 70%", end: "center center", scrub: 0.7 },
          });
        }

        gsap.from("[data-tm-veil]", {
          scaleX: 1.6,
          transformOrigin: "right",
          ease: "none",
          scrollTrigger: { trigger: root, start: "top 70%", end: "center center", scrub: 0.7 },
        });
      });
    });
  }, []);

  return (
    <section
      id="time-machine"
      ref={rootRef}
      className="gutter border-t border-line-subtle py-32 md:py-44"
    >
      <div className="flex flex-wrap items-end justify-between gap-8">
        <Reveal variant="mask">
          <p className="eyebrow mb-6">Time machine</p>
          <SplitLines lines={["Trade a day", "that already happened."]} className="text-display-l" />
        </Reveal>

        <Reveal>
          <p className="max-w-xs text-base leading-relaxed text-ink-secondary" data-animate="rise">
            Drop into 15 March 2025 at 09:30. The session streams forward at your pace and the
            future stays hidden — no candle appears before its time.
          </p>
        </Reveal>
      </div>

      <div className="relative mt-16 border border-line md:mt-20">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="tabular text-[0.6875rem] tracking-[0.1em] text-ink-secondary">
            RELIANCE · 15 MAR 2025 · 09:30:00 IST
          </span>
          <div className="flex items-center gap-1.5">
            {["1×", "2×", "5×", "10×"].map((speed, index) => (
              <span
                key={speed}
                className={`tabular rounded-full border px-2 py-0.5 text-[0.625rem] ${
                  index === 0
                    ? "border-ink bg-ink text-ink-inverse"
                    : "border-line text-ink-tertiary"
                }`}
              >
                {speed}
              </span>
            ))}
          </div>
        </div>

        <div className="relative h-56 overflow-hidden md:h-80">
          <svg
            viewBox="0 0 800 300"
            preserveAspectRatio="none"
            className="size-full"
            aria-label="Illustration of a partially revealed intraday price path"
            role="img"
          >
            <path
              data-tm-path
              d={PATH}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              className="text-ink"
            />
          </svg>

          {/* Everything to the right of the playhead is deliberately withheld. */}
          <div
            data-tm-veil
            aria-hidden
            className="absolute inset-y-0 right-0 w-[46%] origin-right bg-base"
          >
            <span className="absolute inset-y-0 left-0 w-px bg-line-strong" />
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[0.625rem] tracking-[0.14em] text-ink-tertiary uppercase">
              Not yet revealed
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
          {SUMMARY.map((item) => (
            <div key={item.label} className="bg-base p-5">
              <p className="eyebrow">{item.label}</p>
              <p className="tabular mt-3 text-base">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-ink-tertiary">
        Illustration only. Session results shown in the product are simulated outcomes of your own
        virtual orders, not a record of real trading.
      </p>
    </section>
  );
}

const SUMMARY = [
  { label: "Session", value: "09:15 → 15:30" },
  { label: "Controls", value: "Play / Pause / Step" },
  { label: "Orders", value: "Market & limit" },
  { label: "Result", value: "vs. benchmark" },
];

/** A fixed decorative price path — not derived from any real session. */
const PATH =
  "M0,214 L36,206 L72,220 L108,192 L144,198 L180,168 L216,180 L252,150 L288,162 L324,128 " +
  "L360,140 L396,116 L432,132 L468,96 L504,110 L540,84 L576,98 L612,70 L648,86 L684,58 " +
  "L720,74 L756,46 L800,60";
