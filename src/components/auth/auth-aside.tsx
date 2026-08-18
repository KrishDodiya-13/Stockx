import { Wordmark } from "@/components/layout/wordmark";

/**
 * The left-hand panel of the auth screen.
 *
 * Decorative, and marked `aria-hidden` where it is purely so — a screen reader
 * gets the form and nothing else, because none of this is information the
 * visitor needs to sign in.
 *
 * The chart is a fixed, hand-chosen series rather than live market data. A real
 * feed here would be a claim about the market on a page that has not
 * authenticated anyone yet, and a random one would redraw differently on every
 * render. It is drawn from the same tokens as the rest of the product, so it
 * follows the theme rather than being a pasted-in image.
 */

/**
 * A plausible upward series with a drawdown in the middle.
 *
 * Deliberately not monotonic: a line that only rises is the visual language of
 * a product making a promise, and this one is a simulator.
 */
const SERIES = [
  38, 42, 36, 45, 52, 48, 58, 54, 63, 71, 66, 74, 82, 76, 69, 63, 72, 81, 88, 84, 93, 101, 97, 108,
] as const;

/*
  A wide, shallow viewBox.

  The first pass drew this into a 420×240 box, which filled most of the panel
  and turned a background element into the loudest thing on the page — and,
  at 900px tall, pushed the figures below the fold entirely. Flattening the box
  keeps the same series reading as a horizon line rather than a hero graphic.
*/
const WIDTH = 560;
const HEIGHT = 120;
const PADDING = 6;

const MIN = Math.min(...SERIES);
const MAX = Math.max(...SERIES);

const POINTS = SERIES.map((value, index) => {
  const x = PADDING + (index / (SERIES.length - 1)) * (WIDTH - PADDING * 2);
  const y = HEIGHT - PADDING - ((value - MIN) / (MAX - MIN)) * (HEIGHT - PADDING * 2);
  return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
});

const LINE = POINTS.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
const AREA = `${LINE} L${POINTS[POINTS.length - 1]!.x} ${HEIGHT} L${POINTS[0]!.x} ${HEIGHT} Z`;
const LAST = POINTS[POINTS.length - 1]!;

export function AuthAside() {
  return (
    <aside className="relative hidden overflow-hidden border-r border-line-subtle bg-sunken lg:flex lg:flex-col lg:justify-between">
      {/*
        The layering the flat panel was missing: a sunken surface, one very low
        wash to lift the top-left corner, and a hairline grid. Three quiet
        planes rather than one gradient doing all the work.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            "radial-gradient(120% 90% at 12% 0%, rgb(var(--surface-raised) / 0.55), transparent 62%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.4]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgb(var(--line-subtle)) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--line-subtle)) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />

      <div className="relative z-10 px-12 pt-12">
        <Wordmark className="text-[0.9375rem]" />
      </div>

      <div className="relative z-10 px-12 py-10">
        <p className="eyebrow text-ink-tertiary">Paper trading terminal</p>
        <p className="mt-6 max-w-sm text-[1.75rem] leading-[1.15] tracking-[-0.02em]">
          Practise the market with virtual capital.
        </p>
        <p className="mt-5 max-w-sm text-[0.875rem] leading-relaxed text-ink-secondary">
          Build conditional strategies, replay your trades and study your decisions — without a
          rupee of real money at risk.
        </p>
      </div>

      {/*
        The chart. Purely decorative, so it is hidden from assistive tech, and
        height-capped so the figures below it are never pushed off a short
        viewport.
      */}
      <div className="relative z-10 max-h-[9rem] shrink-0" aria-hidden>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block h-[9rem] w-full"
          preserveAspectRatio="none"
          role="presentation"
        >
          <defs>
            <linearGradient id="auth-chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--ink-primary))" stopOpacity="0.09" />
              <stop offset="100%" stopColor="rgb(var(--ink-primary))" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Reference lines, at the weight of a printed rule. */}
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              x2={WIDTH}
              y1={HEIGHT * fraction}
              y2={HEIGHT * fraction}
              stroke="rgb(var(--line-subtle))"
              strokeWidth="1"
            />
          ))}

          <path d={AREA} fill="url(#auth-chart-fill)" />
          <path
            d={LINE}
            fill="none"
            stroke="rgb(var(--ink-primary))"
            strokeOpacity="0.55"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          <circle cx={LAST.x} cy={LAST.y} r="6" fill="rgb(var(--accent))" fillOpacity="0.14" />
          <circle cx={LAST.x} cy={LAST.y} r="2.5" fill="rgb(var(--accent))" />
        </svg>
      </div>

      <div className="relative z-10 grid grid-cols-3 border-t border-line-subtle">
        <Figure label="Virtual capital" value="₹1K–₹10L" />
        <Figure label="Real orders" value="Never" />
        <Figure label="Instruments" value="45+" />
      </div>
    </aside>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-line-subtle px-6 py-7 last:border-r-0">
      <p className="text-[0.625rem] uppercase tracking-[0.14em] text-ink-tertiary">{label}</p>
      <p className="tabular mt-2 text-[0.9375rem]">{value}</p>
    </div>
  );
}
