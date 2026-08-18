"use client";

import type { IndicatorSettings } from "@/components/chart/indicator-config";
import { cn } from "@/lib/cn";

interface Toggle {
  readonly key: keyof IndicatorSettings;
  readonly label: string;
  /** Swatch matching the colour the renderer uses for this series. */
  readonly swatch?: string;
  readonly title: string;
}

const TOGGLES: readonly Toggle[] = [
  { key: "volume", label: "Volume", title: "Traded volume, behind the price" },
  { key: "ma1", label: "MA 20", swatch: "bg-accent", title: "20-period simple moving average" },
  { key: "ma2", label: "MA 50", swatch: "bg-ink/50", title: "50-period simple moving average" },
  { key: "bollinger", label: "Bollinger", title: "Bollinger Bands, 20-period, 2 deviations" },
  { key: "rsi", label: "RSI", title: "Relative Strength Index, 14-period, in its own pane" },
  { key: "macd", label: "MACD", title: "MACD 12/26/9, in its own pane" },
];

/**
 * Indicator toggles.
 *
 * Rendered as pressed-state buttons rather than checkboxes so the row reads as
 * a compact toolbar, with `aria-pressed` carrying the state for assistive tech.
 */
export function IndicatorControls({
  settings,
  onChange,
}: {
  settings: IndicatorSettings;
  onChange: (settings: IndicatorSettings) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Chart indicators">
      {TOGGLES.map((toggle) => {
        const active = Boolean(settings[toggle.key]);

        return (
          <button
            key={toggle.key}
            type="button"
            title={toggle.title}
            aria-pressed={active}
            onClick={() => onChange({ ...settings, [toggle.key]: !active })}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem]",
              "transition-colors duration-200",
              active
                ? "border-ink text-ink"
                : "border-line text-ink-tertiary hover:border-line-strong hover:text-ink-secondary",
            )}
          >
            {toggle.swatch ? (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full transition-opacity duration-200",
                  toggle.swatch,
                  !active && "opacity-30",
                )}
              />
            ) : null}
            {toggle.label}
          </button>
        );
      })}

      <span className="ml-auto hidden text-[0.625rem] text-ink-tertiary lg:block">
        Scroll to zoom · drag to pan · ←/→ and +/− with focus
      </span>
    </div>
  );
}
