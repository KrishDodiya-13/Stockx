"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { TradeReviewPanel } from "@/components/analysis/trade-review";
import { DEFAULT_INDICATORS } from "@/components/chart/indicator-config";
import { PriceChart } from "@/components/chart/price-chart";
import { TransportControls } from "@/components/timemachine/transport-controls";
import { Panel, PanelHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import type { Candle } from "@/domain/market";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate, formatPercent, formatTime } from "@/lib/format";
import { priceToRupees, type Paise, type PriceE4 } from "@/lib/money";
import {
  buildTimeline,
  holdExtremes,
  type ReplayEventKind,
  type RoundTrip,
} from "@/services/replay/replay-engine";
import type { PlaybackSpeed } from "@/services/timemachine/session-engine";
import { tickInterval } from "@/services/timemachine/session-engine";
import { handleSessionExpiry } from "@/lib/session-expiry";

type Status = "loading" | "ready" | "error" | "unconfigured";

const EVENT_STYLE: Record<ReplayEventKind, { label: string; tone: string }> = {
  ENTRY: { label: "Entry", tone: "border-up/40 text-up" },
  ADD: { label: "Added", tone: "border-up/40 text-up" },
  EXIT: { label: "Exit", tone: "border-down/40 text-down" },
  PARTIAL_EXIT: { label: "Partial exit", tone: "border-down/40 text-down" },
  STOP: { label: "Stop loss", tone: "border-down/40 text-down" },
  TARGET: { label: "Target", tone: "border-accent/40 text-accent" },
};

export function ReplayView() {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("trade");

  const [trips, setTrips] = useState<readonly RoundTrip[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(requestedId);
  const [detail, setDetail] = useState<{
    trip: RoundTrip;
    candles: Candle[];
    strategyDetail: Record<string, { kind: ReplayEventKind; detail: string }>;
  } | null>(null);

  // --- playback ------------------------------------------------------------
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(2);
  const loadedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/replay", { cache: "no-store" });

        if (handleSessionExpiry(response)) return;
        const payload = (await response.json()) as {
          trips?: RoundTrip[];
          error?: string;
          message?: string;
        };
        if (cancelled) return;

        if (response.status === 503 && payload.error === "database_not_configured") {
          setStatus("unconfigured");
          setMessage(payload.message ?? null);
          return;
        }
        if (!response.ok) {
          setStatus("error");
          setMessage(payload.message ?? "Could not load your trades.");
          return;
        }

        setTrips(payload.trips ?? []);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async (tripId: string) => {
    if (loadedRef.current === tripId) return;
    loadedRef.current = tripId;

    setDetail(null);
    setCursor(0);
    setPlaying(false);

    try {
      const response = await fetch(`/api/replay/${tripId}`, { cache: "no-store" });

      if (handleSessionExpiry(response)) return;
      if (!response.ok) return;

      const payload = (await response.json()) as {
        trip: RoundTrip;
        candles: Candle[];
        strategyDetail: Record<string, { kind: ReplayEventKind; detail: string }>;
      };

      setDetail(payload);

      /*
        The server may have resolved a fill id to its parent trip. Adopt the
        canonical id so the list highlights the right row — and mark it as
        already loaded first, or the id change would trigger a second,
        identical fetch.
      */
      loadedRef.current = payload.trip.id;
      setSelectedId(payload.trip.id);
      // Start with a little context visible rather than an empty chart.
      setCursor(Math.min(10, payload.candles.length));
    } catch {
      loadedRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (selectedId) void load(selectedId);
  }, [selectedId, load]);

  const frames = useMemo(() => {
    if (!detail) return [];
    return buildTimeline(
      detail.trip,
      detail.candles,
      new Map(Object.entries(detail.strategyDetail)),
    );
  }, [detail]);

  // Advance the playhead.
  useEffect(() => {
    if (!playing || frames.length === 0) return;

    const timer = window.setInterval(() => {
      setCursor((current) => {
        if (current >= frames.length) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, tickInterval(speed));

    return () => window.clearInterval(timer);
  }, [playing, speed, frames.length]);

  const visible = frames.slice(0, Math.max(cursor, 1));
  const frame = visible[visible.length - 1] ?? null;
  const revealedEvents = visible.flatMap((f) => f.events);
  const extremes = useMemo(() => holdExtremes(visible), [visible]);

  // --- states --------------------------------------------------------------

  if (status === "unconfigured") {
    return (
      <Panel className="mt-10">
        <EmptyState
          title="Replay needs a database"
          description={message ?? "Trades are stored per account, so the database must be configured."}
        />
      </Panel>
    );
  }

  if (status === "loading") return <SkeletonRows rows={4} className="mt-10" />;

  if (status === "error") {
    return (
      <Panel className="mt-10">
        <EmptyState title="Could not load your trades" description={message ?? "Try again."} />
      </Panel>
    );
  }

  if (trips.length === 0) {
    return (
      <Panel className="mt-10">
        <EmptyState
          title="You haven't completed a trade yet"
          description="Every position you open and close becomes replayable here, with the price movement around it and your entry and exit marked."
        />
      </Panel>
    );
  }

  return (
    <div className="mt-10 grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
      {/* --- trip list ----------------------------------------------------- */}
      <Panel className="h-fit">
        <PanelHeader title="Trades" description={`${trips.length} round ${trips.length === 1 ? "trip" : "trips"}`} />
        <ul className="max-h-[32rem] overflow-y-auto">
          {trips.map((trip) => (
            <li key={trip.id}>
              <button
                type="button"
                onClick={() => setSelectedId(trip.id)}
                className={cn(
                  "flex w-full flex-col gap-1 border-b border-line-subtle px-5 py-3 text-left transition-colors duration-200 last:border-b-0 md:px-6",
                  selectedId === trip.id ? "bg-ink/6" : "row-hover",
                )}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-[0.875rem] font-medium">{trip.symbol}</span>
                  <span
                    className={cn(
                      "tabular text-[0.8125rem]",
                      trip.realisedPnl >= 0 ? "text-up" : "text-down",
                    )}
                  >
                    {formatCurrency(trip.realisedPnl as Paise, { whole: true, signed: true })}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-3 text-[0.6875rem] text-ink-tertiary">
                  <span>{formatDate(trip.openedAt)}</span>
                  <span className="flex items-center gap-2">
                    {trip.automated ? <span className="text-accent">auto</span> : null}
                    {trip.status === "OPEN" ? <span>open</span> : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      {/* --- replay -------------------------------------------------------- */}
      {!detail ? (
        <Panel>
          <EmptyState
            title={selectedId ? "Loading that trade…" : "Choose a trade to replay"}
            description="The chart replays the price around your entry and exit, with each event appearing as it happened."
          />
        </Panel>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-line-subtle pb-6">
            <div>
              <span className="eyebrow">
                {detail.trip.symbol} · {formatDate(detail.trip.openedAt)}
                {detail.trip.automated ? " · automated" : ""}
              </span>
              <p className="mt-4 text-numeric-hero">
                <span className="text-ink-tertiary">₹</span>
                <span className="tabular">
                  {frame ? priceToRupees(frame.candle.close).toFixed(2) : "—"}
                </span>
              </p>
              {frame ? (
                <p className="tabular mt-2 text-[0.75rem] text-ink-tertiary">
                  {formatTime(frame.candle.time)}
                </p>
              ) : null}
            </div>

            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              <Stat label="Position" value={`${frame?.position.toLocaleString("en-IN") ?? 0} sh`} />
              <Stat
                label="Unrealised"
                value={formatCurrency((frame?.unrealisedPnl ?? 0) as Paise, { whole: true, signed: true })}
                tone={(frame?.unrealisedPnl ?? 0) >= 0 ? "up" : "down"}
              />
              <Stat
                label="Realised"
                value={formatCurrency((frame?.realisedPnl ?? 0) as Paise, { whole: true, signed: true })}
                tone={(frame?.realisedPnl ?? 0) >= 0 ? "up" : "down"}
              />
            </dl>
          </div>

          <TransportControls
            status={playing ? "running" : cursor >= frames.length ? "finished" : "paused"}
            speed={speed}
            cursor={cursor}
            total={frames.length}
            onPlay={() => {
              if (cursor >= frames.length) setCursor(1);
              setPlaying(true);
            }}
            onPause={() => setPlaying(false)}
            onStep={() => setCursor((current) => Math.min(current + 1, frames.length))}
            onReset={() => {
              setCursor(Math.min(10, frames.length));
              setPlaying(false);
            }}
            onSpeed={setSpeed}
          />

          <Panel>
            <PanelHeader title="Price" description="Revealed up to the playhead" />
            <div className="px-5 py-5 md:px-6">
              {visible.length < 2 ? (
                <div className="h-[360px]" />
              ) : (
                <PriceChart
                  candles={visible.map((f) => f.candle)}
                  settings={{ ...DEFAULT_INDICATORS, ma2: false, volume: true }}
                  height={360}
                />
              )}
            </div>
          </Panel>

          <div className="grid gap-6 md:grid-cols-2">
            <Panel>
              <PanelHeader title="Events" description="As they occurred" />
              {revealedEvents.length === 0 ? (
                <EmptyState
                  title="Nothing yet"
                  description="Press play — your entry and exit appear as the replay reaches them."
                  className="py-10"
                />
              ) : (
                <ul>
                  {revealedEvents.map((event, index) => {
                    const style = EVENT_STYLE[event.kind];
                    return (
                      <li
                        key={`${event.time}-${index}`}
                        className="border-b border-line-subtle px-5 py-3 last:border-b-0 md:px-6"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2 py-0.5 text-[0.625rem] font-medium tracking-[0.08em]",
                              style.tone,
                            )}
                          >
                            {style.label.toUpperCase()}
                          </span>
                          <span className="tabular text-[0.8125rem]">
                            {event.quantity} @ ₹{priceToRupees(event.price as PriceE4).toFixed(2)}
                          </span>
                          <span className="tabular ml-auto text-[0.6875rem] text-ink-tertiary">
                            {formatTime(event.time)}
                          </span>
                        </div>
                        {event.detail ? (
                          <p className="mt-1.5 text-[0.75rem] text-ink-secondary">{event.detail}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="This trade" description="Final outcome" />
              <dl className="px-5 py-4 text-[0.8125rem] md:px-6">
                <Row label="Quantity" value={detail.trip.quantity.toLocaleString("en-IN")} />
                <Row
                  label="Average entry"
                  value={`₹${priceToRupees(detail.trip.averageEntry as PriceE4).toFixed(2)}`}
                />
                <Row
                  label="Average exit"
                  value={
                    detail.trip.averageExit === null
                      ? "—"
                      : `₹${priceToRupees(detail.trip.averageExit as PriceE4).toFixed(2)}`
                  }
                />
                <Row
                  label="Realised P&L"
                  value={formatCurrency(detail.trip.realisedPnl as Paise, { whole: true, signed: true })}
                  tone={detail.trip.realisedPnl >= 0 ? "up" : "down"}
                />
                <Row
                  label="Return"
                  value={formatPercent(detail.trip.realisedPnlPercent, { signed: true })}
                  tone={detail.trip.realisedPnlPercent >= 0 ? "up" : "down"}
                />
                <Row
                  label="Best point in hold"
                  value={formatCurrency(extremes.bestUnrealised, { whole: true, signed: true })}
                />
                <Row
                  label="Worst point in hold"
                  value={formatCurrency(extremes.worstUnrealised, { whole: true, signed: true })}
                />
              </dl>

              <p className="border-t border-line-subtle px-5 py-3 text-[0.6875rem] leading-relaxed text-ink-tertiary md:px-6">
                Best and worst points reflect the replay up to the playhead. Prices are simulated
                and the trade was paper only.
              </p>
            </Panel>
          </div>

          {/* The review reads the whole trade, independent of the playhead. */}
          <TradeReviewPanel tripId={detail.trip.status === "CLOSED" ? detail.trip.id : null} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cn(
          "tabular mt-2 text-[0.9375rem]",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-subtle py-2.5 last:border-b-0">
      <dt className="text-ink-secondary">{label}</dt>
      <dd
        className={cn(
          "tabular text-right",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
