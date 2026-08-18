"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { niceTicks } from "@/components/chart/chart-math";
import { readPalette, setupCanvas, type ChartPalette } from "@/components/chart/chart-renderer";
import {
  downsample,
  extentOf,
  monotoneControlPoints,
  nearestIndex,
  paddedRange,
  type EquityRange,
  type SeriesPoint,
} from "@/components/portfolio/equity-series";
import { cn } from "@/lib/cn";
import { formatCompactCurrency, formatCurrency, formatDate, formatTime } from "@/lib/format";
import { paiseToRupees, type Paise } from "@/lib/money";

/** Right-hand value axis width, matching the price chart's proportions. */
const AXIS_WIDTH = 64;
const TIME_AXIS_HEIGHT = 22;
const TOP_PADDING = 14;

/** Above this the curve is bucketed before drawing. */
const MAX_DRAWN_POINTS = 700;

export interface EquityChartProps {
  /** The windowed series, oldest first. At least two points. */
  series: readonly SeriesPoint[];
  range: EquityRange;
  height?: number;
  className?: string;
}

interface Hover {
  /** Index into the drawn series. */
  readonly index: number;
  /** Pointer position in CSS pixels, for the tooltip. */
  readonly x: number;
  readonly y: number;
}

/**
 * The portfolio performance chart.
 *
 * ── Why canvas ─────────────────────────────────────────────────────────────
 *
 * The same reason `price-chart.tsx` uses it: a crosshair that redraws through
 * the DOM is a layout-and-paint per pointer move, and that is what makes a
 * chart feel like a web page rather than a terminal. Here the whole frame —
 * grid, area, line, crosshair — is one synchronous pass over a few hundred
 * points, scheduled on an animation frame.
 *
 * ── Why it does not rebuild on a tick ──────────────────────────────────────
 *
 * The account's live value refreshes every few seconds, and the previous
 * implementation reacted by rebuilding an SVG path and replaying a GSAP
 * draw-on tween over it — a full re-animation of the entire curve for a change
 * of a few paise at the right-hand end. Nothing here is recreated on new data:
 * the canvas element is mounted once, `draw` mutates pixels in place, and the
 * only allocation per update is the control-point arrays for the curve. The
 * introduction animation runs once per range change, driven by a clip, not by
 * rebuilding geometry.
 */
export function EquityChart({ series, range, height = 260, className }: EquityChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height });
  const [hover, setHover] = useState<Hover | null>(null);

  /*
    Drawing state lives in refs, not in React state.

    `draw` is called from a pointer move and from an animation frame; routing
    either through `setState` would put a React render between the input and
    the pixels, which is exactly the lag a crosshair cannot afford.
  */
  const paletteRef = useRef<ChartPalette | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const frameRef = useRef<number | null>(null);
  const progressRef = useRef(1);

  /** Bucketed once per series identity — the draw loop never re-derives it. */
  const points = useMemo(() => downsample(series, MAX_DRAWN_POINTS), [series]);
  const extent = useMemo(() => extentOf(points), [points]);

  const geometry = useMemo(() => {
    if (!extent || points.length < 2) return null;

    const valueRange = paddedRange(
      paiseToRupees(extent.minValue as Paise),
      paiseToRupees(extent.maxValue as Paise),
    );
    const timeSpan = Math.max(1, extent.maxTime - extent.minTime);

    return { valueRange, timeSpan };
  }, [extent, points]);

  // --- painting ------------------------------------------------------------

  const draw = useCallback(() => {
    frameRef.current = null;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !extent || !geometry || points.length < 2) return;
    if (size.width <= 0) return;

    const palette = (paletteRef.current ??= readPalette(container));
    const context = setupCanvas(canvas, size.width, size.height);
    if (!context) return;

    const plot = {
      left: 0,
      top: TOP_PADDING,
      width: Math.max(1, size.width - AXIS_WIDTH),
      height: Math.max(1, size.height - TOP_PADDING - TIME_AXIS_HEIGHT),
    };

    const { valueRange, timeSpan } = geometry;
    const valueSpan = valueRange.max - valueRange.min;

    const toX = (time: number): number =>
      plot.left + ((time - extent.minTime) / timeSpan) * plot.width;
    const toY = (rupees: number): number =>
      plot.top + (1 - (rupees - valueRange.min) / valueSpan) * plot.height;

    const first = paiseToRupees(points[0]!.value as Paise);
    const last = paiseToRupees(points[points.length - 1]!.value as Paise);
    const rising = last >= first;
    const stroke = rising ? palette.up : palette.down;

    drawValueAxis(context, plot, valueRange, palette, size.width);
    drawTimeAxis(context, plot, points, range, palette);

    // The opening baseline, so a curve is read against where it started.
    drawBaseline(context, plot, toY(first), palette);

    const xs = points.map((point) => toX(point.time));
    const ys = points.map((point) => toY(paiseToRupees(point.value as Paise)));
    const curve = monotoneControlPoints(xs, ys);

    /*
      The reveal.

      Clipping to a growing width animates the curve without touching its
      geometry — the alternative, a stroke-dash tween, needs the path length
      recomputed every frame and cannot clip the area fill at all.
    */
    context.save();
    if (progressRef.current < 1) {
      context.beginPath();
      context.rect(plot.left, 0, plot.width * progressRef.current, size.height);
      context.clip();
    }

    const linePath = new Path2D();
    linePath.moveTo(xs[0]!, ys[0]!);
    for (let i = 0; i < xs.length - 1; i += 1) {
      linePath.bezierCurveTo(
        curve.c1x[i]!,
        curve.c1y[i]!,
        curve.c2x[i]!,
        curve.c2y[i]!,
        xs[i + 1]!,
        ys[i + 1]!,
      );
    }

    // Area: the same curve, closed down to the floor.
    const areaPath = new Path2D(linePath);
    areaPath.lineTo(xs[xs.length - 1]!, plot.top + plot.height);
    areaPath.lineTo(xs[0]!, plot.top + plot.height);
    areaPath.closePath();

    const gradient = context.createLinearGradient(0, plot.top, 0, plot.top + plot.height);
    gradient.addColorStop(0, withAlpha(stroke, 0.22));
    gradient.addColorStop(1, withAlpha(stroke, 0));
    context.fillStyle = gradient;
    context.fill(areaPath);

    context.strokeStyle = stroke;
    context.lineWidth = 1.75;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke(linePath);

    /*
      The live end of the curve, marked so the eye lands on "now".

      Drawn inside the clip so it arrives with the line rather than hovering
      unattached at the right-hand edge while the curve is still sweeping in.
    */
    const endX = xs[xs.length - 1]!;
    const endY = ys[ys.length - 1]!;
    context.fillStyle = withAlpha(stroke, 0.22);
    context.beginPath();
    context.arc(endX, endY, 5.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = stroke;
    context.beginPath();
    context.arc(endX, endY, 2.5, 0, Math.PI * 2);
    context.fill();

    context.restore();

    const active = hoverRef.current;
    if (active) {
      const point = points[active.index];
      if (point) {
        drawCrosshair(
          context,
          toX(point.time),
          toY(paiseToRupees(point.value as Paise)),
          plot,
          palette,
          stroke,
          size.width,
          formatCompactCurrency(point.value as Paise),
        );
      }
    }
  }, [extent, geometry, points, range, size.height, size.width]);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  /*
    A stable handle on the current `draw`.

    The reveal loop below runs for half a second and must not capture the
    `draw` closure it started with: the container is measured asynchronously,
    so the first frames of the animation typically run before a width is known
    and a captured closure would keep drawing into a zero-width plot for the
    whole animation — leaving the curve clipped at whatever fraction it had
    reached when the size finally arrived.
  */
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // Repaint whenever the geometry, the size or the data changes. Cheap: this
  // is one canvas pass, not a remount.
  useEffect(() => {
    schedule();
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [schedule]);

  // --- responsive sizing ---------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const apply = (width: number): void => {
      // Shorter on a phone, where a tall chart pushes everything below it off
      // the screen.
      const next = width < 480 ? Math.round(height * 0.78) : height;
      setSize((previous) =>
        previous.width === width && previous.height === next
          ? previous
          : { width, height: next },
      );
    };

    apply(container.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) apply(Math.round(entry.contentRect.width));
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [height]);

  // Theme changes swap every colour token, so the cached palette must go.
  useEffect(() => {
    const target = document.documentElement;
    const observer = new MutationObserver(() => {
      paletteRef.current = null;
      schedule();
    });
    observer.observe(target, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => observer.disconnect();
  }, [schedule]);

  // --- the one-shot reveal, per range --------------------------------------

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      progressRef.current = 1;
      schedule();
      return;
    }

    progressRef.current = 0;
    const start = performance.now();
    const duration = 520;
    let raf = 0;

    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      // Cubic ease-out: fast to reveal, settling at the live end.
      progressRef.current = 1 - Math.pow(1 - t, 3);
      drawRef.current();
      if (t < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      progressRef.current = 1;
    };
    // Deliberately keyed on the range only: a new live value must not replay
    // the reveal, or the curve would re-animate every few seconds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // --- pointer -------------------------------------------------------------

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || !extent || points.length < 2 || size.width <= 0) return;

      const bounds = container.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;

      const plotWidth = Math.max(1, size.width - AXIS_WIDTH);
      const ratio = Math.min(Math.max(x / plotWidth, 0), 1);
      const time = extent.minTime + ratio * (extent.maxTime - extent.minTime);
      const index = nearestIndex(points, time);
      if (index < 0) return;

      const next = { index, x, y };
      hoverRef.current = next;
      setHover((previous) =>
        previous && previous.index === index && Math.abs(previous.x - x) < 1 ? previous : next,
      );
      schedule();
    },
    [extent, points, schedule, size.width],
  );

  const clearHover = useCallback(() => {
    hoverRef.current = null;
    setHover(null);
    schedule();
  }, [schedule]);

  const hovered = hover ? points[hover.index] : null;

  return (
    <div
      ref={containerRef}
      className={cn("relative w-full touch-pan-y select-none", className)}
      style={{ height: size.height }}
      onPointerMove={onPointerMove}
      onPointerLeave={clearHover}
      onPointerCancel={clearHover}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        role="img"
        aria-label={describe(points, range)}
      />

      {hovered ? (
        <Tooltip
          point={hovered}
          x={hover!.x}
          containerWidth={size.width}
          range={range}
          openingValue={points[0]!.value}
        />
      ) : null}
    </div>
  );
}

// --- tooltip ---------------------------------------------------------------

function Tooltip({
  point,
  x,
  containerWidth,
  range,
  openingValue,
}: {
  point: SeriesPoint;
  x: number;
  containerWidth: number;
  range: EquityRange;
  openingValue: number;
}) {
  const width = 178;
  // Flip to the left of the cursor near the right edge so it never clips out.
  const left = Math.min(Math.max(x + 14, 4), Math.max(4, containerWidth - width - 4));

  const delta = point.value - openingValue;
  const rising = delta >= 0;

  return (
    <div
      className="pointer-events-none absolute top-2 z-10 border border-line bg-raised/95 px-3 py-2.5 backdrop-blur-sm"
      style={{ left, width }}
      role="status"
      aria-live="off"
    >
      <p className="text-[0.625rem] tracking-[0.1em] text-ink-tertiary uppercase">
        {range === "1D" ? formatTime(point.time) : formatDate(point.time)}
      </p>
      <p className="tabular mt-1.5 text-base">{formatCurrency(point.value as Paise, { whole: true })}</p>
      <p className={cn("tabular mt-1 text-[0.6875rem]", rising ? "text-up" : "text-down")}>
        {rising ? "+" : "−"}
        {formatCurrency(Math.abs(delta) as Paise, { whole: true })} over {range}
      </p>
      {point.carried ? (
        // Says plainly that this end is a carry-forward, not a booked event.
        <p className="mt-1.5 text-[0.625rem] text-ink-tertiary">
          Carried forward — no trade at this point
        </p>
      ) : null}
    </div>
  );
}

// --- canvas helpers --------------------------------------------------------

interface Plot {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function drawValueAxis(
  context: CanvasRenderingContext2D,
  plot: Plot,
  range: { min: number; max: number },
  palette: ChartPalette,
  canvasWidth: number,
): void {
  const ticks = niceTicks(range, 4);
  const span = range.max - range.min;

  context.save();
  context.strokeStyle = palette.lineSubtle;
  context.fillStyle = palette.inkTertiary;
  context.lineWidth = 1;
  context.font = '500 10px var(--font-mono, ui-monospace, monospace)';
  context.textAlign = "left";
  context.textBaseline = "middle";

  for (const tick of ticks) {
    const y = Math.round(plot.top + (1 - (tick - range.min) / span) * plot.height) + 0.5;
    if (y < plot.top - 1 || y > plot.top + plot.height + 1) continue;

    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.left + plot.width, y);
    context.stroke();

    context.fillText(
      formatCompactCurrency((tick * 100) as Paise),
      Math.min(plot.left + plot.width + 8, canvasWidth - 4),
      y,
    );
  }

  context.restore();
}

function drawTimeAxis(
  context: CanvasRenderingContext2D,
  plot: Plot,
  points: readonly SeriesPoint[],
  range: EquityRange,
  palette: ChartPalette,
): void {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const label = (time: number): string =>
    range === "1D" ? formatTime(time).slice(0, 5) : formatDate(time);

  context.save();
  context.fillStyle = palette.inkTertiary;
  context.font = '500 10px var(--font-mono, ui-monospace, monospace)';
  context.textBaseline = "middle";
  const y = plot.top + plot.height + TIME_AXIS_HEIGHT / 2;

  context.textAlign = "left";
  context.fillText(label(first.time), plot.left, y);

  context.textAlign = "right";
  context.fillText(label(last.time), plot.left + plot.width, y);

  context.restore();
}

/** The opening level, so the curve is read against where the window started. */
function drawBaseline(
  context: CanvasRenderingContext2D,
  plot: Plot,
  y: number,
  palette: ChartPalette,
): void {
  const snapped = Math.round(y) + 0.5;
  if (snapped < plot.top || snapped > plot.top + plot.height) return;

  context.save();
  context.strokeStyle = palette.line;
  context.lineWidth = 1;
  context.setLineDash([2, 4]);
  context.beginPath();
  context.moveTo(plot.left, snapped);
  context.lineTo(plot.left + plot.width, snapped);
  context.stroke();
  context.restore();
}

function drawCrosshair(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  plot: Plot,
  palette: ChartPalette,
  accent: string,
  canvasWidth: number,
  valueLabel: string,
): void {
  const snappedX = Math.round(x) + 0.5;
  const snappedY = Math.round(y) + 0.5;

  context.save();
  context.strokeStyle = palette.line;
  context.lineWidth = 1;
  context.setLineDash([2, 3]);

  context.beginPath();
  context.moveTo(snappedX, plot.top);
  context.lineTo(snappedX, plot.top + plot.height);
  context.stroke();

  context.beginPath();
  context.moveTo(plot.left, snappedY);
  context.lineTo(plot.left + plot.width, snappedY);
  context.stroke();
  context.setLineDash([]);

  // The point itself, ringed against the background so it reads on the area.
  context.fillStyle = palette.background;
  context.beginPath();
  context.arc(x, y, 5, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = accent;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x, y, 4, 0, Math.PI * 2);
  context.stroke();

  // Value tag on the axis.
  context.font = '500 10px var(--font-mono, ui-monospace, monospace)';
  context.textAlign = "left";
  context.textBaseline = "middle";
  const paddingX = 5;
  const tagX = plot.left + plot.width + 4;
  const tagWidth = Math.min(context.measureText(valueLabel).width + paddingX * 2, canvasWidth - tagX);

  context.fillStyle = palette.ink;
  context.fillRect(tagX, snappedY - 8, tagWidth, 16);
  context.fillStyle = palette.background;
  context.fillText(valueLabel, tagX + paddingX, snappedY);

  context.restore();
}

/** `rgb(r g b)` or `rgb(r g b / a)` with the alpha replaced. */
function withAlpha(colour: string, alpha: number): string {
  const inner = colour.replace(/^rgba?\(/, "").replace(/\)$/, "").split("/")[0]!.trim();
  return `rgb(${inner} / ${alpha})`;
}

function describe(points: readonly SeriesPoint[], range: EquityRange): string {
  if (points.length < 2) return "Portfolio performance chart";
  const first = points[0]!.value;
  const last = points[points.length - 1]!.value;
  const delta = last - first;
  const direction = delta >= 0 ? "up" : "down";
  return `Portfolio performance over ${range}: ${direction} ${formatCurrency(Math.abs(delta) as Paise, { whole: true })}, ending at ${formatCurrency(last as Paise, { whole: true })}.`;
}
