"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  candleAtX,
  clampViewport,
  clampVisibleCount,
  extendRange,
  indexToX,
  isAtRightEdge,
  panViewport,
  priceRangeFor,
  viewportAtEnd,
  wheelDeltaToPixels,
  yToPrice,
  zoomToCount,
  zoomViewport,
  type PlotArea,
  type Viewport,
} from "@/components/chart/chart-math";
import {
  drawBand,
  drawCandles,
  drawCrosshair,
  drawGrid,
  drawHistogram,
  drawLevel,
  drawSeries,
  drawVolume,
  readPalette,
  setupCanvas,
  type ChartPalette,
} from "@/components/chart/chart-renderer";
import type { IndicatorSettings } from "@/components/chart/indicator-config";
import type { Candle } from "@/domain/market";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { ensureGsap } from "@/lib/animation/gsap-core";
import { DURATION, EASE } from "@/lib/animation/motion-tokens";
import { cn } from "@/lib/cn";
import { formatVolume } from "@/lib/format";
import { priceToRupees } from "@/lib/money";
import {
  bollingerBands,
  macd as computeMacd,
  rsi as computeRsi,
  seriesExtent,
  sma,
} from "@/services/indicators/indicators";

const AXIS_WIDTH = 62;
const TIME_AXIS_HEIGHT = 22;
const PANE_GAP = 10;

/**
 * Zoom applied per pixel of wheel travel, as an exponent.
 *
 * Tuned against the two input devices rather than picked: a mouse notch
 * normalises to about 60px after clamping, giving e^(60 × 0.0022) ≈ 1.14 — a
 * 14% step, close to what a desktop trading platform does per notch. A
 * trackpad's few-pixel events give fractions of a percent each, so a gesture
 * accumulates smoothly instead of snapping.
 */
const ZOOM_PER_PIXEL = 0.0022;

interface PriceChartProps {
  candles: readonly Candle[];
  settings: IndicatorSettings;
  className?: string;
  /**
   * Height of the price pane in pixels on a wide screen. Narrow screens use a
   * shorter pane — see `effectiveHeight` below.
   */
  height?: number;
}

/** Below this width the chart gets a shorter pane and fewer visible candles. */
const NARROW_BREAKPOINT = 640;

interface HoverState {
  x: number;
  y: number;
  index: number;
  candle: Candle;
}

/**
 * Interactive candlestick chart.
 *
 * Renders to canvas and owns its own interaction model:
 *   - wheel / pinch zoom anchored to the pointer
 *   - drag to pan, with momentum-free clamping at both ends
 *   - crosshair that snaps to the nearest candle
 *   - keyboard control, so the chart is usable without a pointer
 *
 * The viewport auto-follows new candles only while the user is already at the
 * right edge. Snapping someone back to "now" mid-inspection is the single most
 * irritating behaviour a live chart can have.
 */
export function PriceChart({ candles, settings, className, height = 380 }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<ChartPalette | null>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>({ offset: 0, visibleCount: 90 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const reducedMotion = useReducedMotion();

  const dragRef = useRef<{ x: number; offset: number } | null>(null);
  const pinchRef = useRef<number | null>(null);
  const followRef = useRef(true);

  /**
   * Input received since the last animation frame, applied in one go.
   *
   * Wheel deltas add up; the pan and hover positions are last-wins, since only
   * the newest cursor position matters once a frame is due.
   */
  const pendingRef = useRef<{
    zoomPixels: number;
    anchorRatio: number;
    panX: number | null;
    hoverPoint: { x: number; y: number } | null;
  }>({ zoomPixels: 0, anchorRatio: 0.5, panX: null, hoverPoint: null });

  const frameRef = useRef<number | null>(null);

  /** The visible span carried at full precision between wheel events. */
  const spanRef = useRef(90);

  // --- derived series -------------------------------------------------------

  const closes = useMemo(() => candles.map((candle) => priceToRupees(candle.close)), [candles]);

  const overlays = useMemo(
    () => ({
      ma1: settings.ma1 ? sma(closes, settings.ma1Period) : null,
      ma2: settings.ma2 ? sma(closes, settings.ma2Period) : null,
      bollinger: settings.bollinger ? bollingerBands(closes, settings.bollingerPeriod, 2) : null,
    }),
    [closes, settings],
  );

  const rsiSeries = useMemo(
    () => (settings.rsi ? computeRsi(closes, settings.rsiPeriod) : null),
    [closes, settings.rsi, settings.rsiPeriod],
  );

  const macdSeries = useMemo(() => (settings.macd ? computeMacd(closes) : null), [closes, settings.macd]);

  // --- layout ---------------------------------------------------------------

  /*
    Narrow screens get a shorter chart, not a squashed one.

    A 520px pane on a phone leaves no room for the price, the controls or the
    trade ticket beneath it — the user would be scrolling to see the thing they
    came for. Sub-panes shrink too, since RSI and MACD are read as shapes rather
    than measured precisely.
  */
  const narrow = size.width > 0 && size.width < NARROW_BREAKPOINT;
  const effectiveHeight = narrow ? Math.min(height, 260) : height;
  const subPaneHeight = narrow ? 64 : 86;

  const paneCount = (rsiSeries ? 1 : 0) + (macdSeries ? 1 : 0);
  const totalHeight = effectiveHeight + paneCount * (subPaneHeight + PANE_GAP) + TIME_AXIS_HEIGHT;

  const layout = useMemo(() => {
    const plotWidth = Math.max(0, size.width - AXIS_WIDTH);

    const price: PlotArea = { left: 0, top: 0, width: plotWidth, height: effectiveHeight };
    let cursor = effectiveHeight + PANE_GAP;

    const rsiPane: PlotArea = { left: 0, top: cursor, width: plotWidth, height: subPaneHeight };
    if (rsiSeries) cursor += subPaneHeight + PANE_GAP;

    const macdPane: PlotArea = { left: 0, top: cursor, width: plotWidth, height: subPaneHeight };

    return { price, rsiPane, macdPane, plotWidth };
  }, [size.width, effectiveHeight, subPaneHeight, rsiSeries]);

  // --- keep the viewport valid as data arrives ------------------------------

  /*
    Fewer candles on a narrow screen.

    Ninety candles across 375px is about four pixels each — a grey smear rather
    than a chart. Forty is still a useful span and each candle stays legible.
  */
  const defaultVisible = narrow ? 40 : 90;

  useEffect(() => {
    setViewport((current) => {
      if (candles.length === 0) return current;

      // First load, or a timeframe change that invalidated the old window.
      if (current.visibleCount === 0 || current.offset + current.visibleCount > candles.length) {
        return viewportAtEnd(candles.length, Math.min(defaultVisible, candles.length));
      }

      // Follow the newest candle only if already pinned to the right edge.
      if (followRef.current) {
        return viewportAtEnd(candles.length, current.visibleCount);
      }

      return clampViewport(current, candles.length);
    });
  }, [candles.length, defaultVisible]);

  // --- measure --------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // --- paint ----------------------------------------------------------------

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || size.width === 0) return;

    paletteRef.current ??= readPalette(container);
    const palette = paletteRef.current;

    const context = setupCanvas(canvas, size.width, totalHeight);
    if (!context) return;

    const { price: pricePlot, rsiPane, macdPane } = layout;
    const visible = candles.slice(
      Math.max(0, Math.floor(viewport.offset)),
      Math.ceil(viewport.offset + viewport.visibleCount),
    );

    let range = priceRangeFor(visible);
    if (!range) return;

    // Bands can sit outside the candle range; widen so they are not clipped.
    if (overlays.bollinger) {
      range = extendRange(range, [
        ...overlays.bollinger.upper.slice(
          Math.floor(viewport.offset),
          Math.ceil(viewport.offset + viewport.visibleCount),
        ),
        ...overlays.bollinger.lower.slice(
          Math.floor(viewport.offset),
          Math.ceil(viewport.offset + viewport.visibleCount),
        ),
      ]);
    }

    const formatAxis = (value: number): string =>
      value >= 1000 ? value.toFixed(0) : value.toFixed(2);

    drawGrid(context, pricePlot, range, palette, formatAxis);

    if (settings.volume) {
      // Volume occupies the lower quarter of the price pane, behind the candles.
      drawVolume(
        context,
        candles,
        viewport,
        { ...pricePlot, top: pricePlot.top + pricePlot.height * 0.78, height: pricePlot.height * 0.22 },
        palette,
      );
    }

    if (overlays.bollinger) {
      drawBand(
        context,
        overlays.bollinger.upper,
        overlays.bollinger.lower,
        viewport,
        pricePlot,
        range,
        palette.ink,
      );
      drawSeries(context, overlays.bollinger.upper, viewport, pricePlot, range, palette.band, 1);
      drawSeries(context, overlays.bollinger.lower, viewport, pricePlot, range, palette.band, 1);
    }

    drawCandles(context, candles, viewport, pricePlot, range, palette);

    if (overlays.ma1) drawSeries(context, overlays.ma1, viewport, pricePlot, range, palette.ma1);
    if (overlays.ma2) drawSeries(context, overlays.ma2, viewport, pricePlot, range, palette.ma2);

    // RSI pane
    if (rsiSeries) {
      const rsiRange = { min: 0, max: 100 };
      drawLevel(context, 70, rsiPane, rsiRange, palette.lineSubtle);
      drawLevel(context, 30, rsiPane, rsiRange, palette.lineSubtle);
      drawSeries(context, rsiSeries, viewport, rsiPane, rsiRange, palette.accent);
    }

    // MACD pane
    if (macdSeries) {
      const extent = seriesExtent(macdSeries.macd, macdSeries.signal, macdSeries.histogram);
      if (extent) {
        const magnitude = Math.max(Math.abs(extent.min), Math.abs(extent.max), 0.0001);
        // Symmetric about zero so the histogram reads honestly either side.
        const macdRange = { min: -magnitude * 1.15, max: magnitude * 1.15 };

        drawLevel(context, 0, macdPane, macdRange, palette.lineSubtle, false);
        drawHistogram(context, macdSeries.histogram, viewport, macdPane, macdRange, palette);
        drawSeries(context, macdSeries.macd, viewport, macdPane, macdRange, palette.ink, 1.2);
        drawSeries(context, macdSeries.signal, viewport, macdPane, macdRange, palette.accent, 1.2);
      }
    }

    if (hover) {
      const snappedX = indexToX(hover.index, viewport, pricePlot);
      drawCrosshair(
        context,
        snappedX,
        hover.y,
        pricePlot,
        range,
        palette,
        formatAxis(yToPrice(hover.y, range, pricePlot)),
      );
    }
  }, [
    candles,
    hover,
    layout,
    macdSeries,
    overlays,
    rsiSeries,
    settings.volume,
    size.width,
    totalHeight,
    viewport,
  ]);

  useEffect(() => {
    const frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [paint]);

  /*
    Timeframe transition.

    Switching timeframe replaces the entire series, and repainting instantly
    reads as a glitch rather than a change. A brief fade covers the swap.

    Keyed to the *first* bar's timestamp rather than the candle count: the Time
    Machine and Trade Replay both append bars one at a time, and keying on
    length would re-fade the chart on every single reveal. A genuinely new
    series starts at a different moment; a growing one does not.
  */
  const seriesKey = candles[0]?.time ?? 0;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || reducedMotion || seriesKey === 0) return;

    const gsap = ensureGsap();
    const tween = gsap.fromTo(
      canvas,
      { opacity: 0.35 },
      { opacity: 1, duration: DURATION.quick, ease: EASE.out },
    );

    return () => {
      tween.kill();
      gsap.set(canvas, { clearProps: "opacity" });
    };
  }, [seriesKey, reducedMotion]);

  // Theme changes swap the CSS tokens; drop the cached palette so the next
  // paint re-reads them.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      paletteRef.current = null;
      requestAnimationFrame(paint);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [paint]);

  // --- interaction ----------------------------------------------------------

  const localPoint = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const updateHover = useCallback(
    (x: number, y: number) => {
      const hit = candleAtX(x, candles, viewport, layout.price);
      setHover(hit ? { x, y, index: hit.index, candle: hit.candle } : null);
    },
    [candles, viewport, layout.price],
  );

  /*
    All pointer and wheel input is applied once per animation frame.

    Wheel and pointermove both fire faster than the display refreshes — a
    trackpad can deliver well over a hundred wheel events a second — and each
    one previously ran its own `setViewport`, so React re-rendered and the
    canvas repainted several times between frames. That is work whose result is
    never seen, and it is what made rapid input feel laggy rather than fast.

    Coalescing into one flush per frame means the chart repaints exactly as
    often as it can be displayed, and a burst of small wheel events applies as
    a single combined zoom rather than a queue of separate ones.
  */
  const flushInteraction = useCallback(() => {
    frameRef.current = null;

    const pending = pendingRef.current;
    const { zoomPixels, anchorRatio, panX, hoverPoint } = pending;

    pending.zoomPixels = 0;
    pending.panX = null;
    pending.hoverPoint = null;

    if (zoomPixels !== 0) {
      setViewport((current) => {
        /*
          The fractional span is carried between events, and re-synced whenever
          something other than the wheel has moved the viewport — a keyboard
          step, a reset, or new data arriving. Without that, the accumulator
          would silently fight those changes.
        */
        if (Math.round(spanRef.current) !== current.visibleCount) {
          spanRef.current = current.visibleCount;
        }

        const target = clampVisibleCount(
          spanRef.current * Math.exp(zoomPixels * ZOOM_PER_PIXEL),
          candles.length,
        );
        spanRef.current = target;

        const next = zoomToCount(current, candles.length, target, anchorRatio);
        followRef.current = isAtRightEdge(next, candles.length);
        return next;
      });
    }

    if (panX !== null) {
      const drag = dragRef.current;
      if (drag) {
        setViewport((current) =>
          panViewport(
            { offset: drag.offset, visibleCount: current.visibleCount },
            candles.length,
            panX - drag.x,
            layout.plotWidth,
          ),
        );
        followRef.current = false;
      }
    }

    if (hoverPoint) updateHover(hoverPoint.x, hoverPoint.y);
  }, [candles.length, layout.plotWidth, updateHover]);

  const scheduleFlush = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(flushInteraction);
  }, [flushInteraction]);

  // A frame requested but never delivered would fire against a torn-down
  // component; cancelling on unmount keeps that from happening.
  useEffect(() => {
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const { x, y } = localPoint(event);

    if (dragRef.current) {
      pendingRef.current.panX = x;
      pendingRef.current.hoverPoint = null;
    } else {
      pendingRef.current.hoverPoint = { x, y };
    }

    scheduleFlush();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const { x } = localPoint(event);
    dragRef.current = { x, offset: viewport.offset };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    dragRef.current = null;
    setIsPanning(false);
    followRef.current = isAtRightEdge(viewport, candles.length);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  /*
    Wheel zoom is attached natively rather than through React's onWheel: React
    registers wheel listeners as passive, so preventDefault() there is ignored
    and the page scrolls behind the chart while zooming.

    ── How the zoom is scaled ─────────────────────────────────────────────────

    This previously read only the *sign* of `deltaY` and applied a fixed 18%
    step per event. A mouse notch is one event, so that felt about right; a
    trackpad emits a stream of small-delta events, so a gentle two-finger swipe
    fired thirty of them and compounded to roughly 140×. Same gesture, wildly
    different outcome, and no way to make a small adjustment.

    Now the delta is normalised to pixels (`wheelDeltaToPixels` handles the
    line/page modes a mouse reports) and mapped exponentially:

        factor = e^(pixels × ZOOM_PER_PIXEL)

    Exponential because zoom is multiplicative — it makes an equal push in
    either direction cancel exactly, and makes accumulated small steps
    equivalent to one large one, which is what "smooth and incremental" means
    here. One mouse notch lands near 14%; a trackpad twitch of two pixels
    lands near 0.4%.
  */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;

      pendingRef.current.zoomPixels += wheelDeltaToPixels(event.deltaY, event.deltaMode);
      pendingRef.current.anchorRatio =
        layout.plotWidth > 0 ? Math.min(Math.max(x / layout.plotWidth, 0), 1) : 0.5;

      scheduleFlush();
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [layout.plotWidth, scheduleFlush]);

  /** Pinch zoom on touch devices. */
  const onTouchMove = (event: React.TouchEvent<HTMLCanvasElement>): void => {
    if (event.touches.length !== 2) return;
    const [a, b] = [event.touches[0]!, event.touches[1]!];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const previous = pinchRef.current;
    pinchRef.current = distance;
    if (previous === null || distance === 0) return;

    setViewport((current) => zoomViewport(current, candles.length, previous / distance, 0.5));
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const step = Math.max(1, Math.round(viewport.visibleCount * 0.15));

    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        setViewport((c) => clampViewport({ ...c, offset: c.offset - step }, candles.length));
        followRef.current = false;
        break;
      case "ArrowRight":
        event.preventDefault();
        setViewport((c) => {
          const next = clampViewport({ ...c, offset: c.offset + step }, candles.length);
          followRef.current = isAtRightEdge(next, candles.length);
          return next;
        });
        break;
      case "+":
      case "=":
        event.preventDefault();
        setViewport((c) => zoomViewport(c, candles.length, 1 / 1.3, 0.5));
        break;
      case "-":
      case "_":
        event.preventDefault();
        setViewport((c) => zoomViewport(c, candles.length, 1.3, 0.5));
        break;
      case "Home":
        event.preventDefault();
        setViewport((c) => clampViewport({ ...c, offset: 0 }, candles.length));
        followRef.current = false;
        break;
      case "End":
        event.preventDefault();
        setViewport((c) => viewportAtEnd(candles.length, c.visibleCount));
        followRef.current = true;
        break;
    }
  };

  const hoveredCandle = hover?.candle ?? candles[candles.length - 1] ?? null;

  return (
    <div className={cn("relative select-none", className)}>
      <OhlcReadout candle={hoveredCandle} live={hover === null} settings={settings} />

      {/*
        `data-lenis-prevent` stops smooth-scroll from consuming wheel events
        here, so scrolling zooms the chart instead of scrolling the page.
        `data-cursor="chart"` tells the custom cursor to stand down in favour
        of the chart's own crosshair.
      */}
      <div
        ref={containerRef}
        data-lenis-prevent
        data-cursor="chart"
        /*
          The viewport, mirrored onto the DOM. Nothing renders from these — the
          chart is drawn to canvas, whose state is otherwise unreadable from
          outside. They make the zoom and pan verifiable without a screenshot
          diff, and cost two attributes on a div that already exists.
        */
        data-chart-span={viewport.visibleCount}
        data-chart-offset={Math.round(viewport.offset)}
        className="relative w-full"
        style={{ height: totalHeight }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={
            candles.length === 0
              ? "Price chart, no data"
              : `Candlestick chart of simulated prices, ${candles.length} bars. Use arrow keys to pan and plus or minus to zoom.`
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => setHover(null)}
          onTouchMove={onTouchMove}
          onTouchEnd={() => {
            pinchRef.current = null;
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "block touch-pan-y outline-none focus-visible:ring-1 focus-visible:ring-ink",
            isPanning ? "cursor-grabbing" : "cursor-crosshair",
            // The canvas repaints every frame while panning; a CSS transition
            // here would fight it.
            !reducedMotion && "transition-none",
          )}
        />
      </div>
    </div>
  );
}

/** OHLC line above the chart — the standard readout, following the crosshair. */
function OhlcReadout({
  candle,
  live,
  settings,
}: {
  candle: Candle | null;
  live: boolean;
  settings: IndicatorSettings;
}) {
  if (!candle) return null;

  const open = priceToRupees(candle.open);
  const close = priceToRupees(candle.close);
  const rising = close >= open;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem]">
      <span className="eyebrow">{live ? "Latest" : "Hovered"}</span>
      <Field label="O" value={open} rising={rising} />
      <Field label="H" value={priceToRupees(candle.high)} rising={rising} />
      <Field label="L" value={priceToRupees(candle.low)} rising={rising} />
      <Field label="C" value={close} rising={rising} />
      {settings.volume ? (
        <span className="text-ink-tertiary">
          Vol <span className="tabular text-ink-secondary">{formatVolume(candle.volume)}</span>
        </span>
      ) : null}
    </div>
  );
}

function Field({ label, value, rising }: { label: string; value: number; rising: boolean }) {
  return (
    <span className="text-ink-tertiary">
      {label}{" "}
      <span className={cn("tabular", rising ? "text-up" : "text-down")}>{value.toFixed(2)}</span>
    </span>
  );
}
