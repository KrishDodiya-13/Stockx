"use client";

import { cn } from "@/lib/cn";
import { formatCurrency, formatPercent } from "@/lib/format";
import { priceToRupees, type Paise, type PriceE4 } from "@/lib/money";
import type { RiskProfile } from "@/services/risk/risk-calculator";

/**
 * Risk visualisations.
 *
 * These render figures that `calculateRisk` has already computed — no
 * component here does arithmetic beyond turning a number into a bar width.
 * That is deliberate: a meter that computed its own percentage could disagree
 * with the figure printed beside it.
 */

/**
 * Risk against reward, as one bar.
 *
 * A single split bar rather than two separate meters, because risk and reward
 * are only meaningful *relative to each other* — 1:2 is the fact worth seeing,
 * and two independent bars make that comparison a mental arithmetic problem.
 */
export function RiskRewardBar({ profile }: { profile: RiskProfile }) {
  const loss = Math.abs(profile.maxLoss);
  const profit = Math.abs(profile.potentialProfit);
  const total = loss + profit;

  const hasBoth = loss > 0 && profit > 0;
  const lossShare = total === 0 ? 50 : (loss / total) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between text-[0.6875rem]">
        <span className="text-down">Risk</span>
        <span className="eyebrow">
          {profile.riskRewardRatio === null
            ? "Incomplete"
            : `1 : ${profile.riskRewardRatio.toFixed(2)}`}
        </span>
        <span className="text-up">Reward</span>
      </div>

      <div
        className="mt-2.5 flex h-2 w-full overflow-hidden rounded-full bg-line"
        role="img"
        aria-label={
          hasBoth
            ? `Risking ${formatCurrency(profile.maxLoss, { whole: true })} to make ${formatCurrency(profile.potentialProfit, { whole: true })}, a ratio of 1 to ${profile.riskRewardRatio?.toFixed(2)}`
            : "Risk and reward cannot be compared until both a target and a stop are set"
        }
      >
        {hasBoth ? (
          <>
            <span
              className="bg-down transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ width: `${lossShare}%` }}
            />
            <span
              className="bg-up transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ width: `${100 - lossShare}%` }}
            />
          </>
        ) : (
          <span className="w-full bg-line" />
        )}
      </div>

      <div className="mt-2 flex items-baseline justify-between text-[0.6875rem]">
        <span className="tabular text-ink-secondary">
          {formatCurrency(profile.maxLoss, { whole: true })}
        </span>
        <span className="tabular text-ink-secondary">
          {formatCurrency(profile.potentialProfit, { whole: true })}
        </span>
      </div>
    </div>
  );
}

/**
 * Portfolio at risk.
 *
 * Banded against conventional position-sizing discipline rather than a raw
 * percentage: most trading guidance puts single-trade risk at or under 1–2% of
 * capital, so the bands mark where a position leaves that territory. The label
 * always states the number too — the band is context, not a verdict.
 */
export function PortfolioRiskMeter({ profile }: { profile: RiskProfile }) {
  const percent = profile.maxLossPercent;

  /*
    Zero risk has two quite different causes, and they must not share a caption:
    no stop is set (the loss is unbounded), or the position is empty (there is
    nothing to lose). `stopDistancePercent` is non-zero only when a usable stop
    exists, which distinguishes them.
  */
  const hasStop = profile.stopDistancePercent !== 0;
  const emptyPosition = profile.capitalExposure === 0;
  // The meter tops out at 5%; beyond that the bar is full and the number tells
  // the rest of the story.
  const fill = Math.min(100, (percent / 5) * 100);

  const band =
    percent <= 1 ? "conservative" : percent <= 2 ? "moderate" : percent <= 5 ? "elevated" : "high";

  const tone =
    band === "conservative" || band === "moderate"
      ? "bg-up"
      : band === "elevated"
        ? "bg-accent"
        : "bg-down";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Portfolio at risk</span>
        <span
          className={cn(
            "tabular text-[0.8125rem]",
            band === "high" ? "text-down" : band === "elevated" ? "text-accent" : "text-ink",
          )}
        >
          {formatPercent(percent)}
        </span>
      </div>

      <div className="relative mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
        <span
          className={cn("block h-full transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]", tone)}
          style={{ width: `${fill}%` }}
        />
        {/* Reference marks at the 1% and 2% conventions. */}
        <span aria-hidden className="absolute inset-y-0 left-[20%] w-px bg-base/60" />
        <span aria-hidden className="absolute inset-y-0 left-[40%] w-px bg-base/60" />
      </div>

      <p className="mt-2 text-[0.6875rem] text-ink-tertiary">
        {emptyPosition
          ? "No position sized yet"
          : !hasStop
            ? "No stop loss set, so the loss is unbounded"
            : "Marks at 1% and 2% — common position-sizing conventions, not a rule"}
      </p>
    </div>
  );
}

/** How much of the account this one position would occupy. */
export function ExposureMeter({
  profile,
  capital,
}: {
  profile: RiskProfile;
  capital: Paise;
}) {
  const fill = Math.min(100, profile.exposurePercent);
  const over = profile.exposurePercent > 100;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Capital exposure</span>
        <span className={cn("tabular text-[0.8125rem]", over && "text-down")}>
          {profile.exposurePercent.toFixed(1)}%
        </span>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
        <span
          className={cn(
            "block h-full transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
            over ? "bg-down" : "bg-ink",
          )}
          style={{ width: `${fill}%` }}
        />
      </div>

      <p className="tabular mt-2 text-[0.6875rem] text-ink-tertiary">
        {formatCurrency(profile.capitalExposure, { whole: true })} of{" "}
        {formatCurrency(capital, { whole: true })}
      </p>
    </div>
  );
}

/**
 * The trade on a price axis: stop, entry, target in their true proportions.
 *
 * Shows at a glance whether the target is a longer move than the stop —
 * the geometric fact behind the risk/reward ratio.
 */
export function PriceLadder({
  entry,
  target,
  stop,
}: {
  entry: PriceE4;
  target: PriceE4 | null;
  stop: PriceE4 | null;
}) {
  if (target === null && stop === null) return null;

  const entryValue = priceToRupees(entry);
  const targetValue = target === null ? entryValue : priceToRupees(target);
  const stopValue = stop === null ? entryValue : priceToRupees(stop);

  const min = Math.min(entryValue, targetValue, stopValue);
  const max = Math.max(entryValue, targetValue, stopValue);
  const span = max - min;

  const position = (value: number): number =>
    span === 0 ? 50 : ((value - min) / span) * 100;

  return (
    <div>
      <span className="eyebrow">Trade geometry</span>

      <div className="relative mt-5 h-24" role="img" aria-label="Stop, entry and target on a price scale">
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-line" />

        {stop !== null ? (
          <Marker label="Stop" value={stopValue} left={position(stopValue)} tone="down" />
        ) : null}
        <Marker label="Entry" value={entryValue} left={position(entryValue)} tone="neutral" />
        {target !== null ? (
          <Marker label="Target" value={targetValue} left={position(targetValue)} tone="up" />
        ) : null}
      </div>
    </div>
  );
}

function Marker({
  label,
  value,
  left,
  tone,
}: {
  label: string;
  value: number;
  left: number;
  tone: "up" | "down" | "neutral";
}) {
  return (
    <span
      className="absolute top-0 flex h-full -translate-x-1/2 flex-col items-center justify-center"
      style={{ left: `${left}%` }}
    >
      <span
        className={cn(
          "text-[0.625rem] uppercase tracking-[0.12em]",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "neutral" && "text-ink-secondary",
        )}
      >
        {label}
      </span>
      <span
        aria-hidden
        className={cn(
          "my-2 h-3 w-px",
          tone === "up" && "bg-up",
          tone === "down" && "bg-down",
          tone === "neutral" && "bg-ink",
        )}
      />
      <span className="tabular text-[0.6875rem] whitespace-nowrap text-ink-secondary">
        ₹{value.toFixed(2)}
      </span>
    </span>
  );
}
