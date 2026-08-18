"use client";

import { useEffect, useMemo, useState } from "react";

import { IndicatorControls } from "@/app/(app)/stocks/[symbol]/indicator-controls";
import { WatchlistButton } from "@/app/(app)/stocks/[symbol]/watchlist-button";
import {
  DEFAULT_INDICATORS,
  DEFAULT_TIMEFRAME,
  TIMEFRAMES,
  type IndicatorSettings,
  type TimeframeOption,
} from "@/components/chart/indicator-config";
import { PriceChart } from "@/components/chart/price-chart";
import { TradePanel } from "@/components/trade/trade-panel";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Cell, CellGrid, Panel, PanelHeader } from "@/components/ui/card";
import { activeQuoteSource, DataSourceBadge } from "@/components/ui/data-source-badge";
import { PercentChange, Price } from "@/components/ui/financial";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import type { Candle, Instrument } from "@/domain/market";
import { useQuote } from "@/hooks/use-quote";
import { cn } from "@/lib/cn";
import { formatVolume, NO_VALUE } from "@/lib/format";
import { priceToRupees, type PriceE4 } from "@/lib/money";
import { getMarketDataService, relativeVolume } from "@/services/market-data";

const TIMEFRAME_TABS: readonly TabItem<string>[] = TIMEFRAMES.map((option) => ({
  value: option.id,
  label: option.label,
}));

const formatLevel = (value: number): string =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value,
  );

export function StockDetail({ instrument }: { instrument: Instrument }) {
  const { quote, state } = useQuote(instrument.id);
  /*
    No quote and no longer trying. With the simulator this never happens; with
    a live feed it is the normal state of a missing token, an expired one, or
    an instrument the vendor does not carry.
  */
  const quoteUnavailable = quote === null && state === "error";

  const [timeframe, setTimeframe] = useState<TimeframeOption>(DEFAULT_TIMEFRAME);
  const [settings, setSettings] = useState<IndicatorSettings>(DEFAULT_INDICATORS);
  const [candles, setCandles] = useState<readonly Candle[]>([]);
  const [loadingCandles, setLoadingCandles] = useState(true);
  const [candleError, setCandleError] = useState<string | null>(null);

  const service = useMemo(() => getMarketDataService(), []);

  useEffect(() => {
    let cancelled = false;
    setLoadingCandles(true);
    setCandleError(null);

    const to = Date.now();
    void service
      .getCandles({
        instrumentId: instrument.id,
        interval: timeframe.interval,
        from: to - timeframe.spanMs,
        to,
      })
      .then((next) => {
        if (cancelled) return;
        setCandles(next);
        setLoadingCandles(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCandleError(error instanceof Error ? error.message : "Could not load price history.");
        setLoadingCandles(false);
      });

    return () => {
      cancelled = true;
    };
  }, [instrument.id, service, timeframe]);

  const rvol = quote ? relativeVolume(quote) : 0;

  return (
    <>
      {/* --- header ------------------------------------------------------- */}
      <header className="border-b border-line-subtle pb-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="eyebrow">
                {instrument.exchange} · {instrument.sector ?? "Index"}
              </span>
              <DataSourceBadge source={activeQuoteSource()} />
            </div>

            <h1 className="mt-4 text-display-m">{instrument.symbol}</h1>
            <p className="mt-2 text-[0.9375rem] text-ink-secondary">{instrument.name}</p>
          </div>

          <div className="flex flex-col items-start gap-4 sm:items-end">
            {quote ? (
              <>
                {/* The price is the hero figure on this screen. */}
                <span className="text-numeric-hero">
                  <span className="text-ink-tertiary">₹</span>
                  <AnimatedNumber
                    value={priceToRupees(quote.price)}
                    format={formatLevel}
                    duration={0.5}
                    flash
                  />
                </span>
                <div className="flex items-center gap-4">
                  <Price value={quote.change} size="md" />
                  <PercentChange value={quote.changePercent} size="md" showArrow />
                </div>
              </>
            ) : (
              <Skeleton className="h-16 w-56 md:h-20" animate={state === "loading"} />
            )}

            <WatchlistButton instrumentId={instrument.id} symbol={instrument.symbol} />
          </div>
        </div>
      </header>

      {/* --- key statistics ----------------------------------------------- */}
      <section className="mt-8" aria-label="Key statistics">
        <CellGrid columns={4}>
          {/*
            Each statistic is independently optional.

            The websocket feed runs in LTPC mode, which carries a price, a
            previous close and a time — no session OHLC. Those fields used to
            be back-filled with the previous close and the last traded price,
            so this panel showed an "Open" that was really yesterday's close
            and a day range of zero width. "--" is the accurate reading.
          */}
          <Stat label="Open" value={rupeeOrDash(quote?.open)} unavailable={quoteUnavailable} />
          <Stat
            label="Previous close"
            value={rupeeOrDash(quote?.previousClose)}
            unavailable={quoteUnavailable}
          />
          <Stat
            label="Day range"
            value={
              quote && quote.dayLow !== null && quote.dayHigh !== null
                ? `₹${priceToRupees(quote.dayLow).toFixed(2)} – ₹${priceToRupees(quote.dayHigh).toFixed(2)}`
                : quote
                  ? NO_VALUE
                  : null
            }
            unavailable={quoteUnavailable}
          />
          <Stat
            label="Volume"
            value={quote ? formatVolume(quote.volume) : null}
            sub={quote && rvol > 0 ? `${rvol.toFixed(2)}× average` : undefined}
            unavailable={quoteUnavailable}
          />
        </CellGrid>
      </section>

      {/* --- chart + ticket ------------------------------------------------
          The chart column is unconstrained and the ticket is a fixed rail, so
          the chart absorbs all available width on wide screens. */}
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <Panel>
          <PanelHeader
            title="Price"
            description={`${timeframe.label} · ${timeframe.interval} bars · ${activeQuoteSource() === "live" ? "live" : "simulated"}`}
            action={
              <Tabs
                items={TIMEFRAME_TABS}
                value={timeframe.id}
                onValueChange={(id) =>
                  setTimeframe(TIMEFRAMES.find((option) => option.id === id) ?? DEFAULT_TIMEFRAME)
                }
                variant="segment"
              />
            }
          />

          <div className="border-b border-line-subtle px-5 py-3 md:px-6">
            <IndicatorControls settings={settings} onChange={setSettings} />
          </div>

          <div className="px-5 py-5 md:px-6">
            {candleError ? (
              <p className="py-16 text-center text-sm text-down">{candleError}</p>
            ) : loadingCandles ? (
              <Skeleton className="h-[380px] w-full" />
            ) : candles.length === 0 ? (
              <p className="py-16 text-center text-sm text-ink-secondary">
                No price history is available for this timeframe.
              </p>
            ) : (
              // Taller than the Phase 3 default: the chart is the primary
              // element on this screen, not a panel within it.
              <PriceChart candles={candles} settings={settings} height={520} />
            )}
          </div>

          {/* The disclosure has to match the data. Telling someone their real
              Upstox history is invented is as wrong as the reverse. */}
          <p className="border-t border-line-subtle px-5 py-3 text-[0.6875rem] text-ink-tertiary md:px-6">
            {activeQuoteSource() === "live"
              ? "Historical prices are supplied by Upstox. Past performance carries no predictive meaning."
              : "Chart data is generated by a local simulator. It is not real market history and carries no predictive meaning."}
          </p>
        </Panel>

        <div className="space-y-6">
          <TradePanel
            instrumentId={instrument.id}
            symbol={instrument.symbol}
            quote={quote}
          />

          <Panel>
            <PanelHeader title="Profile" />
            <dl className="px-5 py-4 text-[0.8125rem] md:px-6">
              <ProfileRow label="Symbol" value={instrument.symbol} />
              <ProfileRow label="Name" value={instrument.name} />
              <ProfileRow label="Exchange" value={instrument.exchange} />
              <ProfileRow label="Sector" value={instrument.sector ?? "—"} />
              <ProfileRow
                label="Market cap"
                value={
                  instrument.marketCapCr > 0
                    ? `₹${new Intl.NumberFormat("en-IN").format(instrument.marketCapCr)} Cr`
                    : "—"
                }
              />
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * One key statistic.
 *
 * `unavailable` is the difference between "still loading" and "there is no
 * price". A skeleton means the number is on its way; left up forever when the
 * feed is down it reads as a hung page, which is exactly how a missing Upstox
 * token used to present. An em dash says the value simply is not there, and
 * the connection pill next to it says why.
 */
/** A rupee figure, or "--" when the feed did not carry it. */
function rupeeOrDash(value: PriceE4 | null | undefined): string | null {
  if (value === undefined) return null;
  return value === null ? NO_VALUE : `₹${priceToRupees(value).toFixed(2)}`;
}

function Stat({
  label,
  value,
  sub,
  unavailable = false,
}: {
  label: string;
  value: string | null;
  sub?: string;
  unavailable?: boolean;
}) {
  return (
    <Cell>
      <p className="eyebrow">{label}</p>
      {value === null ? (
        unavailable ? (
          <p className="tabular mt-3.5 text-base text-ink-tertiary md:text-lg">—</p>
        ) : (
          <Skeleton className="mt-3.5 h-6 w-28" />
        )
      ) : (
        <p className={cn("tabular mt-3.5 text-base md:text-lg")}>{value}</p>
      )}
      {sub ? <p className="mt-1.5 text-[0.6875rem] text-ink-tertiary">{sub}</p> : null}
    </Cell>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-subtle py-2.5 last:border-b-0">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
