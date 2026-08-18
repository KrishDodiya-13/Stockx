"use client";

import { useMemo } from "react";

import type { BacktestFill, EquityPoint } from "@/services/backtest/backtest-engine";
import { cn } from "@/lib/cn";
import { formatCompactCurrency, formatDate } from "@/lib/format";
import { paiseToRupees, type Paise } from "@/lib/money";

const W = 800;
const EQUITY_H = 200;
const DRAWDOWN_H = 90;
const PAD = 10;

/**
 * Backtest charts.
 *
 * SVG rather than canvas: a backtest is a static result, so there is no
 * per-frame redraw to optimise, and SVG gives crisp text and hoverable markers
 * for free.
 *
 * The equity curve and the drawdown chart deliberately share one x-scale and
 * sit directly above one another, so a dip in equity lines up vertically with
 * the drawdown it produced.
 */
export function BacktestCharts({
  equityCurve,
  fills,
  initialCapital,
}: {
  equityCurve: readonly EquityPoint[];
  fills: readonly BacktestFill[];
  initialCapital: Paise;
}) {
  const geometry = useMemo(
    () => buildGeometry(equityCurve, fills, initialCapital),
    [equityCurve, fills, initialCapital],
  );

  if (!geometry) {
    return (
      <p className="py-16 text-center text-sm text-ink-secondary">
        Not enough data to plot this run.
      </p>
    );
  }

  const { equityPath, areaPath, baselineY, markers, drawdownPath, minEquity, maxEquity, first, last } =
    geometry;

  return (
    <div className="space-y-6">
      {/* --- equity ------------------------------------------------------- */}
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <span className="eyebrow">Equity curve</span>
          <span className="tabular text-[0.6875rem] text-ink-tertiary">
            {formatCompactCurrency(minEquity)} – {formatCompactCurrency(maxEquity)}
          </span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${EQUITY_H}`}
          className="w-full"
          preserveAspectRatio="none"
          style={{ height: EQUITY_H }}
          role="img"
          aria-label={`Simulated equity curve with ${markers.length} trade markers`}
        >
          <defs>
            <linearGradient id="bt-equity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Starting capital — the line that decides profit from loss. */}
          <line
            x1={0}
            x2={W}
            y1={baselineY}
            y2={baselineY}
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
            className="text-ink-tertiary"
          />

          <g className={last >= first ? "text-up" : "text-down"}>
            <path d={areaPath} fill="url(#bt-equity-fill)" stroke="none" />
            <path
              d={equityPath}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </g>

          {/* Trade markers: buys below the curve, sells above, so overlapping
              fills at one price stay distinguishable. */}
          {markers.map((marker, index) => (
            <g key={`${marker.time}-${index}`}>
              <circle
                cx={marker.x}
                cy={marker.y}
                r={2.5}
                className={marker.side === "BUY" ? "fill-up" : "fill-down"}
              />
              <title>
                {marker.side} {marker.quantity} @ ₹{marker.price.toFixed(2)} — {marker.reason}
              </title>
            </g>
          ))}
        </svg>
      </div>

      {/* --- drawdown ----------------------------------------------------- */}
      <div>
        <span className="eyebrow">Drawdown</span>

        <svg
          viewBox={`0 0 ${W} ${DRAWDOWN_H}`}
          className="mt-3 w-full"
          preserveAspectRatio="none"
          style={{ height: DRAWDOWN_H }}
          role="img"
          aria-label="Peak-to-trough decline over the simulated period"
        >
          <path d={drawdownPath} className="fill-down/25" stroke="none" />
          <path
            d={drawdownPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            className="text-down"
          />
        </svg>
      </div>

      <div className="flex items-center justify-between text-[0.6875rem] text-ink-tertiary">
        <span>{formatDate(equityCurve[0]!.time)}</span>
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-up" /> Buy
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-down" /> Sell
          </span>
        </span>
        <span>{formatDate(equityCurve[equityCurve.length - 1]!.time)}</span>
      </div>
    </div>
  );
}

function buildGeometry(
  equityCurve: readonly EquityPoint[],
  fills: readonly BacktestFill[],
  initialCapital: Paise,
) {
  if (equityCurve.length < 2) return null;

  const values = equityCurve.map((point) => paiseToRupees(point.equity));
  const times = equityCurve.map((point) => point.time);

  const capital = paiseToRupees(initialCapital);
  // Include the starting capital in the range so the baseline is always on
  // screen — a curve that never dips below its start would otherwise clip it.
  const minValue = Math.min(...values, capital);
  const maxValue = Math.max(...values, capital);
  const valueSpan = maxValue - minValue;

  const minTime = times[0]!;
  const maxTime = times[times.length - 1]!;
  const timeSpan = maxTime - minTime;

  const x = (time: number): number =>
    timeSpan === 0 ? W / 2 : ((time - minTime) / timeSpan) * W;

  const y = (value: number): number => {
    const usable = EQUITY_H - PAD * 2;
    if (valueSpan === 0) return EQUITY_H / 2;
    return PAD + (1 - (value - minValue) / valueSpan) * usable;
  };

  const equityPath = equityCurve
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.time).toFixed(2)},${y(values[index]!).toFixed(2)}`)
    .join(" ");

  const areaPath = `${equityPath} L${x(maxTime).toFixed(2)},${EQUITY_H} L${x(minTime).toFixed(2)},${EQUITY_H} Z`;

  // Drawdown is always ≤ 0, plotted downward from a zero line at the top.
  const worst = Math.min(...equityCurve.map((point) => point.drawdownPercent), -0.0001);
  const dy = (percent: number): number => (percent / worst) * (DRAWDOWN_H - 4);

  const drawdownPath = `M0,0 ${equityCurve
    .map((point) => `L${x(point.time).toFixed(2)},${dy(point.drawdownPercent).toFixed(2)}`)
    .join(" ")} L${W},0 Z`;

  const markers = fills
    .map((fill) => {
      const index = equityCurve.findIndex((point) => point.time === fill.time);
      if (index < 0) return null;

      return {
        time: fill.time,
        side: fill.side,
        quantity: fill.quantity,
        price: fill.price / 10_000,
        reason: fill.reason,
        x: x(fill.time),
        // Offset so a buy and a sell at the same equity do not overlap.
        y: y(values[index]!) + (fill.side === "BUY" ? 6 : -6),
      };
    })
    .filter((marker): marker is NonNullable<typeof marker> => marker !== null);

  return {
    equityPath,
    areaPath,
    drawdownPath,
    markers,
    baselineY: y(capital),
    minEquity: Math.round(minValue * 100) as Paise,
    maxEquity: Math.round(maxValue * 100) as Paise,
    first: values[0]!,
    last: values[values.length - 1]!,
  };
}

/** Compact stat, used across the results panel. */
export function BacktestStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="bg-base p-5 md:p-6">
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          "tabular mt-3.5 text-numeric-m font-medium",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-[0.6875rem] text-ink-tertiary">{sub}</p> : null}
    </div>
  );
}
