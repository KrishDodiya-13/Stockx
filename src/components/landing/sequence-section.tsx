"use client";

import { useHorizontalScroll } from "@/hooks/use-parallax";
import { useAnimate } from "@/hooks/use-animation";
import { cn } from "@/lib/cn";

interface Chapter {
  readonly index: string;
  readonly title: string;
  readonly body: string;
  readonly detail: readonly string[];
}

/**
 * The product, in order.
 *
 * Each panel is one surface of the application, arranged as the sequence a
 * trader actually moves through: see the market, study an instrument, write the
 * plan, size the risk, rehearse it, then read your own record back.
 */
const CHAPTERS: readonly Chapter[] = [
  {
    index: "01",
    title: "Market Pulse",
    body: "Indices, movers, unusual volume and sector rotation on one surface. Prices animate as they change; nothing else moves.",
    detail: ["NIFTY 50 · BANK NIFTY · SENSEX", "Heatmap weighted by market cap", "Volume against each name's own norm"],
  },
  {
    index: "02",
    title: "The instrument",
    body: "A chart built for reading, not decorating. Zoom anchors to the cursor, the crosshair snaps to the candle, and the keyboard works.",
    detail: ["Candles, volume, RSI, MACD", "Bollinger Bands and moving averages", "Six timeframes"],
  },
  {
    index: "03",
    title: "The plan",
    body: "Write the strategy as ordered IF/THEN rules. Entry, targets, partial exits, a stop — in the sequence they run.",
    detail: ["Eighteen condition types", "Multiple targets and partial exits", "Trailing stops"],
  },
  {
    index: "04",
    title: "The risk",
    body: "Move the size and watch the loss move with it. Risk is a consequence of position size, not a setting.",
    detail: ["Maximum loss before entry", "Reward against risk", "Portfolio exposure"],
  },
  {
    index: "05",
    title: "The rehearsal",
    body: "Drop into a past session and trade it forward. The next bar does not exist until you reach it.",
    detail: ["Play, pause, step", "1× to 10×", "Measured against buy and hold"],
  },
  {
    index: "06",
    title: "The record",
    body: "What your own trades show about how you trade. Descriptive, never predictive, and silent until there is enough history to mean anything.",
    detail: ["Win rate and payoff", "How long you hold winners against losers", "Where your results actually came from"],
  },
];

/**
 * Horizontal chapter sequence.
 *
 * The one place in the product where scroll direction is taken over, and it
 * earns it: these six panels are a single ordered argument, and reading them
 * sideways makes the order the point. Everywhere else scrolls normally.
 *
 * On narrow screens and under reduced motion the panels stack vertically —
 * hijacking a thumb is hostile, not impressive.
 */
export function SequenceSection() {
  const { containerRef, trackRef, active } = useHorizontalScroll<HTMLElement>();
  const headingRef = useAnimate<HTMLDivElement>({ kind: "mask", selector: "[data-animate='mask'] > *", start: "top 80%" });

  return (
    <>
      <div ref={headingRef} className="gutter border-t border-line-subtle pt-32 md:pt-44">
        <p className="eyebrow mb-6">The product</p>
        <h2 className="text-display-l">
          <span className="block overflow-hidden pb-[0.06em]" data-animate="mask">
            <span className="block">Six surfaces,</span>
          </span>
          <span className="block overflow-hidden pb-[0.06em]" data-animate="mask">
            <span className="block">one sequence.</span>
          </span>
        </h2>
      </div>

      <section
        ref={containerRef}
        aria-label="Product overview"
        className={cn(
          "relative py-20 md:py-28",
          // Only clip once the pin is driving the track. Clipping a static
          // horizontal track would hide the panels it cannot scroll to.
          active && "overflow-hidden",
        )}
      >
        <div
          ref={trackRef}
          className={cn(
            "flex gap-6 px-5 md:gap-10 md:px-10",
            // Horizontal *only* when the pin is installed. Any other state —
            // reduced motion, a narrow viewport, GSAP failing to load — stacks
            // vertically, which is always readable.
            active ? "w-max flex-row" : "flex-col",
          )}
        >
          {CHAPTERS.map((chapter) => (
            <article
              key={chapter.index}
              className={cn(
                "flex shrink-0 flex-col justify-between border border-line bg-base p-8 md:p-10",
                // Fixed panel size belongs to the horizontal track; stacked,
                // the panels size to their own content.
                active && "h-[26rem] w-[30rem]",
                // Depth from a warming hairline and a pixel of travel — never
                // from a shadow, which would read as a floating card.
                "lift",
              )}
            >
              <div>
                <span className="tabular text-[0.6875rem] tracking-[0.18em] text-ink-tertiary">
                  {chapter.index}
                </span>
                <h3 className="mt-6 text-display-m">{chapter.title}</h3>
                <p className="mt-5 max-w-sm text-[0.9375rem] leading-relaxed text-ink-secondary">
                  {chapter.body}
                </p>
              </div>

              <ul className="mt-8 space-y-2">
                {chapter.detail.map((line) => (
                  <li
                    key={line}
                    className="flex items-baseline gap-3 text-[0.8125rem] text-ink-tertiary"
                  >
                    <span aria-hidden className="size-1 shrink-0 rounded-full bg-ink-tertiary" />
                    {line}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
