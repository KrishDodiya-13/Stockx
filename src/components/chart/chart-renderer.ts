/**
 * Canvas painting for the price chart.
 *
 * Split from the React component so the component owns state and events while
 * this owns pixels. Everything here is synchronous drawing against a supplied
 * context — no state, no reads from the DOM.
 *
 * Canvas rather than SVG: at 400 visible candles plus four overlays, SVG means
 * thousands of live DOM nodes and the crosshair stops feeling attached to the
 * pointer. Canvas redraws the whole frame in one pass.
 */

import type { Candle } from "@/domain/market";
import { priceToRupees } from "@/lib/money";
import {
  candleWidth,
  indexToX,
  niceTicks,
  priceToY,
  type PlotArea,
  type PriceRange,
  type Viewport,
} from "@/components/chart/chart-math";
import type { Series } from "@/services/indicators/indicators";

export interface ChartPalette {
  up: string;
  down: string;
  ink: string;
  inkSecondary: string;
  inkTertiary: string;
  line: string;
  lineSubtle: string;
  background: string;
  accent: string;
  ma1: string;
  ma2: string;
  band: string;
}

/** Reads the live theme tokens so the chart follows light/dark automatically. */
export function readPalette(element: HTMLElement): ChartPalette {
  const styles = getComputedStyle(element);
  const token = (name: string, fallback: string): string => {
    const value = styles.getPropertyValue(name).trim();
    // Tokens are stored as "R G B" triples for use inside rgb()/rgba().
    return value ? `rgb(${value})` : fallback;
  };
  const alpha = (name: string, opacity: number, fallback: string): string => {
    const value = styles.getPropertyValue(name).trim();
    return value ? `rgb(${value} / ${opacity})` : fallback;
  };

  return {
    up: token("--signal-up", "rgb(42 200 122)"),
    down: token("--signal-down", "rgb(255 92 84)"),
    ink: token("--ink-primary", "rgb(245 244 241)"),
    inkSecondary: token("--ink-secondary", "rgb(154 152 147)"),
    inkTertiary: token("--ink-tertiary", "rgb(106 104 100)"),
    line: alpha("--ink-primary", 0.14, "rgb(255 255 255 / 0.14)"),
    lineSubtle: alpha("--ink-primary", 0.07, "rgb(255 255 255 / 0.07)"),
    background: token("--surface-base", "rgb(8 8 9)"),
    accent: token("--accent", "rgb(214 168 96)"),
    ma1: alpha("--accent", 0.95, "rgb(214 168 96)"),
    ma2: alpha("--ink-primary", 0.5, "rgb(245 244 241 / 0.5)"),
    band: alpha("--ink-primary", 0.16, "rgb(245 244 241 / 0.16)"),
  };
}

/**
 * Prepare the canvas for the device pixel ratio.
 *
 * Without this every line is blurry on a retina display — the single most
 * common reason a hand-built chart looks unfinished.
 */
export function setupCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): CanvasRenderingContext2D | null {
  const context = canvas.getContext("2d");
  if (!context) return null;

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(cssHeight * dpr);

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  return context;
}

export function drawGrid(
  context: CanvasRenderingContext2D,
  plot: PlotArea,
  range: PriceRange,
  palette: ChartPalette,
  formatPrice: (value: number) => string,
): void {
  const ticks = niceTicks(range, 5);

  context.save();
  context.strokeStyle = palette.lineSubtle;
  context.fillStyle = palette.inkTertiary;
  context.lineWidth = 1;
  context.font = "500 10px var(--font-numeric, monospace)";
  context.textAlign = "left";
  context.textBaseline = "middle";

  for (const tick of ticks) {
    // Half-pixel offset keeps a 1px line from straddling two device pixels.
    const y = Math.round(priceToY(tick, range, plot)) + 0.5;

    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.left + plot.width, y);
    context.stroke();

    context.fillText(formatPrice(tick), plot.left + plot.width + 8, y);
  }

  context.restore();
}

export function drawCandles(
  context: CanvasRenderingContext2D,
  candles: readonly Candle[],
  viewport: Viewport,
  plot: PlotArea,
  range: PriceRange,
  palette: ChartPalette,
): void {
  const width = candleWidth(viewport, plot);
  const half = width / 2;
  const start = Math.max(0, Math.floor(viewport.offset) - 1);
  const end = Math.min(candles.length, Math.ceil(viewport.offset + viewport.visibleCount) + 1);

  context.save();

  for (let i = start; i < end; i += 1) {
    const candle = candles[i];
    if (!candle) continue;

    const open = priceToRupees(candle.open);
    const close = priceToRupees(candle.close);
    const high = priceToRupees(candle.high);
    const low = priceToRupees(candle.low);

    const rising = close >= open;
    const colour = rising ? palette.up : palette.down;

    const x = indexToX(i, viewport, plot);
    const wickX = Math.round(x) + 0.5;

    context.strokeStyle = colour;
    context.fillStyle = colour;
    context.lineWidth = 1;

    // Wick
    context.beginPath();
    context.moveTo(wickX, priceToY(high, range, plot));
    context.lineTo(wickX, priceToY(low, range, plot));
    context.stroke();

    // Body. A doji would round to zero height and vanish, so floor it at 1px.
    const yOpen = priceToY(open, range, plot);
    const yClose = priceToY(close, range, plot);
    const top = Math.min(yOpen, yClose);
    const height = Math.max(1, Math.abs(yClose - yOpen));

    context.fillRect(x - half, top, width, height);
  }

  context.restore();
}

export function drawVolume(
  context: CanvasRenderingContext2D,
  candles: readonly Candle[],
  viewport: Viewport,
  plot: PlotArea,
  palette: ChartPalette,
): void {
  const start = Math.max(0, Math.floor(viewport.offset));
  const end = Math.min(candles.length, Math.ceil(viewport.offset + viewport.visibleCount));

  let peak = 0;
  for (let i = start; i < end; i += 1) {
    const volume = candles[i]?.volume ?? 0;
    if (volume > peak) peak = volume;
  }
  if (peak <= 0) return;

  const width = candleWidth(viewport, plot);
  const half = width / 2;

  context.save();
  context.globalAlpha = 0.4;

  for (let i = start; i < end; i += 1) {
    const candle = candles[i];
    if (!candle) continue;

    const rising = priceToRupees(candle.close) >= priceToRupees(candle.open);
    context.fillStyle = rising ? palette.up : palette.down;

    const height = (candle.volume / peak) * plot.height;
    const x = indexToX(i, viewport, plot);
    context.fillRect(x - half, plot.top + plot.height - height, width, height);
  }

  context.restore();
}

/** Draw an indicator series, breaking the path across null gaps. */
export function drawSeries(
  context: CanvasRenderingContext2D,
  series: Series,
  viewport: Viewport,
  plot: PlotArea,
  range: PriceRange,
  colour: string,
  lineWidth = 1.25,
): void {
  const start = Math.max(0, Math.floor(viewport.offset) - 1);
  const end = Math.min(series.length, Math.ceil(viewport.offset + viewport.visibleCount) + 1);

  context.save();
  context.strokeStyle = colour;
  context.lineWidth = lineWidth;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();

  let drawing = false;
  for (let i = start; i < end; i += 1) {
    const value = series[i];
    if (value === null || value === undefined || !Number.isFinite(value)) {
      // A gap must break the line, not be bridged across.
      drawing = false;
      continue;
    }

    const x = indexToX(i, viewport, plot);
    const y = priceToY(value, range, plot);

    if (drawing) context.lineTo(x, y);
    else {
      context.moveTo(x, y);
      drawing = true;
    }
  }

  context.stroke();
  context.restore();
}

/** Shaded region between two series — the Bollinger channel. */
export function drawBand(
  context: CanvasRenderingContext2D,
  upper: Series,
  lower: Series,
  viewport: Viewport,
  plot: PlotArea,
  range: PriceRange,
  colour: string,
): void {
  const start = Math.max(0, Math.floor(viewport.offset) - 1);
  const end = Math.min(upper.length, Math.ceil(viewport.offset + viewport.visibleCount) + 1);

  const top: { x: number; y: number }[] = [];
  const bottom: { x: number; y: number }[] = [];

  for (let i = start; i < end; i += 1) {
    const high = upper[i];
    const low = lower[i];
    if (high === null || high === undefined || low === null || low === undefined) continue;

    const x = indexToX(i, viewport, plot);
    top.push({ x, y: priceToY(high, range, plot) });
    bottom.push({ x, y: priceToY(low, range, plot) });
  }

  if (top.length < 2) return;

  context.save();
  context.fillStyle = colour;
  context.globalAlpha = 0.1;
  context.beginPath();
  context.moveTo(top[0]!.x, top[0]!.y);
  for (const point of top.slice(1)) context.lineTo(point.x, point.y);
  for (let i = bottom.length - 1; i >= 0; i -= 1) context.lineTo(bottom[i]!.x, bottom[i]!.y);
  context.closePath();
  context.fill();
  context.restore();
}

/** Histogram for the MACD pane, drawn about a zero line. */
export function drawHistogram(
  context: CanvasRenderingContext2D,
  series: Series,
  viewport: Viewport,
  plot: PlotArea,
  range: PriceRange,
  palette: ChartPalette,
): void {
  const width = Math.max(1, candleWidth(viewport, plot) * 0.7);
  const half = width / 2;
  const zeroY = priceToY(0, range, plot);
  const start = Math.max(0, Math.floor(viewport.offset));
  const end = Math.min(series.length, Math.ceil(viewport.offset + viewport.visibleCount));

  context.save();
  context.globalAlpha = 0.75;

  for (let i = start; i < end; i += 1) {
    const value = series[i];
    if (value === null || value === undefined) continue;

    const y = priceToY(value, range, plot);
    context.fillStyle = value >= 0 ? palette.up : palette.down;
    context.fillRect(x(i), Math.min(y, zeroY), width, Math.max(1, Math.abs(y - zeroY)));
  }

  context.restore();

  function x(index: number): number {
    return indexToX(index, viewport, plot) - half;
  }
}

/** Horizontal reference line, e.g. RSI 70/30 or the MACD zero line. */
export function drawLevel(
  context: CanvasRenderingContext2D,
  value: number,
  plot: PlotArea,
  range: PriceRange,
  colour: string,
  dashed = true,
): void {
  const y = Math.round(priceToY(value, range, plot)) + 0.5;

  context.save();
  context.strokeStyle = colour;
  context.lineWidth = 1;
  if (dashed) context.setLineDash([3, 4]);
  context.beginPath();
  context.moveTo(plot.left, y);
  context.lineTo(plot.left + plot.width, y);
  context.stroke();
  context.restore();
}

/** Crosshair with a price tag on the right axis. */
export function drawCrosshair(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  plot: PlotArea,
  range: PriceRange,
  palette: ChartPalette,
  label: string,
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

  if (y >= plot.top && y <= plot.top + plot.height) {
    context.beginPath();
    context.moveTo(plot.left, snappedY);
    context.lineTo(plot.left + plot.width, snappedY);
    context.stroke();

    // Price tag
    context.setLineDash([]);
    context.font = "500 10px var(--font-numeric, monospace)";
    const paddingX = 5;
    const textWidth = context.measureText(label).width;
    const tagX = plot.left + plot.width + 4;
    const tagHeight = 16;

    context.fillStyle = palette.ink;
    context.fillRect(tagX, snappedY - tagHeight / 2, textWidth + paddingX * 2, tagHeight);

    context.fillStyle = palette.background;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(label, tagX + paddingX, snappedY);
  }

  context.restore();
}
