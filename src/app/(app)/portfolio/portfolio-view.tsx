"use client";

import Link from "next/link";
import { useState } from "react";

import { CellGrid, Panel, PanelHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Money, PercentChange, Price, StatTile } from "@/components/ui/financial";
import { RecordCard, ResponsiveRecords } from "@/components/ui/record-list";
import { SkeletonRows, SkeletonTiles } from "@/components/ui/skeleton";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import {
  useHistory,
  usePortfolio,
  type OrderRecord,
  type TradeRecord,
} from "@/hooks/use-portfolio";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate, formatPercent, formatTime, NO_VALUE } from "@/lib/format";
import type { Paise, PriceE4 } from "@/lib/money";
import { stockRoute } from "@/lib/routes";

type HistoryTab = "trades" | "orders";

const HISTORY_TABS: readonly TabItem<HistoryTab>[] = [
  { value: "trades", label: "Trade history" },
  { value: "orders", label: "Order history" },
];

/**
 * The portfolio.
 *
 * Every figure comes from `/api/portfolio`, which values the account on the
 * server. Nothing on this page is computed in the browser — that is the whole
 * point of the engine living behind an API.
 */
export function PortfolioView() {
  const { portfolio, state, message } = usePortfolio(5000);
  const [tab, setTab] = useState<HistoryTab>("trades");

  if (state === "unconfigured") return <DatabaseSetupNotice message={message} />;

  if (state === "error") {
    return (
      <Panel className="mt-10">
        <EmptyState
          title="Could not load your portfolio"
          description={message ?? "The trading engine did not respond. Try refreshing the page."}
        />
      </Panel>
    );
  }

  if (state === "loading" || !portfolio) {
    return (
      <div className="mt-10 space-y-px">
        <SkeletonTiles count={4} />
        <SkeletonTiles count={3} />
      </div>
    );
  }

  const invested = portfolio.investedValue;

  return (
    <>
      <section className="mt-10" aria-label="Balances">
        <CellGrid columns={4}>
          <StatTile
            label="Portfolio value"
            value={<Money value={portfolio.totalValue} size="lg" whole />}
            sub="Cash + holdings"
          />
          <StatTile
            label="Available cash"
            value={<Money value={portfolio.cashBalance} size="lg" whole />}
            sub="Buying power"
          />
          <StatTile
            label="Invested"
            value={<Money value={invested} size="lg" whole />}
            sub={invested === 0 ? "No open positions" : "At cost"}
          />
          <StatTile
            label="Today's P&L"
            value={<Money value={portfolio.dayPnl} size="lg" signed whole />}
            sub={`${portfolio.dayPnlPercent >= 0 ? "+" : ""}${portfolio.dayPnlPercent.toFixed(2)}% since previous close`}
          />
        </CellGrid>
      </section>

      <section className="mt-px" aria-label="Profit and loss">
        <CellGrid columns={3}>
          <StatTile
            label="Realised P&L"
            value={<Money value={portfolio.realisedPnl} size="lg" signed whole />}
            sub="Booked on closed quantity"
          />
          <StatTile
            label="Unrealised P&L"
            value={<Money value={portfolio.unrealisedPnl} size="lg" signed whole />}
            sub="Open positions at market"
          />
          <StatTile
            label="Total P&L"
            value={<Money value={portfolio.totalPnl} size="lg" signed whole />}
            /*
              The denominator is the account's own deposited capital, not a
              fixed figure. It was hardcoded to ₹10,00,000 while the percentage
              beside it was already computed from the real `startingCapital`, so
              an account funded with ₹5,000 showed a correct percentage labelled
              with a base two hundred times too large.
            */
            sub={`${portfolio.totalPnlPercent >= 0 ? "+" : ""}${portfolio.totalPnlPercent.toFixed(2)}% on ${formatCurrency(portfolio.startingCapital, { whole: true })}`}
          />
        </CellGrid>
      </section>

      <Panel className="mt-10">
        <PanelHeader
          title="Holdings"
          description={
            portfolio.holdings.length === 0
              ? "Instruments you own"
              : `${portfolio.holdings.length} ${portfolio.holdings.length === 1 ? "instrument" : "instruments"}`
          }
        />
        {portfolio.holdings.length === 0 ? (
          <EmptyState
            title="You don't hold anything yet"
            description="Buy an instrument from its detail page and it will appear here with your average cost and live unrealised P&L."
          />
        ) : (
          <HoldingsTable holdings={portfolio.holdings} />
        )}
      </Panel>

      <Panel className="mt-6">
        <PanelHeader
          title="Activity"
          action={<Tabs items={HISTORY_TABS} value={tab} onValueChange={setTab} variant="segment" />}
        />
        {tab === "trades" ? <TradeHistory /> : <OrderHistory />}
      </Panel>
    </>
  );
}

function HoldingsTable({
  holdings,
}: {
  holdings: ReturnType<typeof usePortfolio>["portfolio"] extends infer P
    ? P extends { holdings: infer H }
      ? H
      : never
    : never;
}) {
  return (
    <ResponsiveRecords
      cards={
        <ul>
          {holdings.map((holding) => (
            <li key={holding.instrumentId}>
              <Link href={stockRoute(holding.symbol)} className="block row-hover">
                <RecordCard
                  title={holding.symbol}
                  subtitle={`${holding.quantity.toLocaleString("en-IN")} @ ₹${(holding.averagePrice / 10_000).toFixed(2)}`}
                  value={<Money value={holding.currentValue as Paise} size="sm" />}
                  meta={[
                    {
                      label: "Unrealised",
                      value: <Money value={holding.unrealisedPnl as Paise} size="sm" signed />,
                    },
                    {
                      label: "Return",
                      value: (
                        <PercentChange value={holding.unrealisedPnlPercent} size="sm" />
                      ),
                    },
                    {
                      label: "Last",
                      value:
                        holding.lastPrice === null ? (
                          "—"
                        ) : (
                          <Price value={holding.lastPrice as PriceE4} size="sm" />
                        ),
                    },
                    {
                      label: "Today",
                      value: <PercentChange value={holding.dayChangePercent} size="sm" />,
                    },
                  ]}
                />
              </Link>
            </li>
          ))}
        </ul>
      }
      table={
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-line-subtle">
            <Th className="pl-5 md:pl-6">Instrument</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Avg cost</Th>
            <Th align="right">Last</Th>
            <Th align="right">Value</Th>
            <Th align="right" className="pr-5 md:pr-6">
              Unrealised P&L
            </Th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => (
            <tr
              key={holding.instrumentId}
              className="border-b border-line-subtle last:border-b-0 row-hover"
            >
              <td className="py-3.5 pl-5 md:pl-6">
                <Link href={stockRoute(holding.symbol)} className="block">
                  <span className="block text-[0.875rem] font-medium">{holding.symbol}</span>
                  <span className="mt-0.5 block text-[0.6875rem] text-ink-tertiary">
                    {holding.dayChangePercent === null
                      ? `${NO_VALUE} today`
                      : `${formatPercent(holding.dayChangePercent, { signed: true })} today`}
                  </span>
                </Link>
              </td>
              <td className="tabular py-3.5 text-right text-[0.875rem]">
                {holding.quantity.toLocaleString("en-IN")}
              </td>
              <td className="py-3.5 text-right">
                <Price value={holding.averagePrice as PriceE4} size="sm" />
              </td>
              <td className="py-3.5 text-right">
                {holding.lastPrice === null ? (
                  <span className="text-[0.8125rem] text-ink-tertiary">—</span>
                ) : (
                  <Price value={holding.lastPrice as PriceE4} size="sm" />
                )}
              </td>
              <td className="py-3.5 text-right">
                <Money value={holding.currentValue as Paise} size="sm" />
              </td>
              <td className="py-3.5 pr-5 text-right md:pr-6">
                <Money value={holding.unrealisedPnl as Paise} size="sm" signed />
                <PercentChange
                  value={holding.unrealisedPnlPercent}
                  size="sm"
                  className="mt-0.5 block text-[0.6875rem]"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      }
    />
  );
}

function TradeHistory() {
  const { records, state, message } = useHistory<TradeRecord>("/api/trades", "trades");

  if (state === "loading") return <SkeletonRows rows={5} className="px-5 md:px-6" />;
  if (state !== "ready") {
    return <EmptyState title="Could not load trades" description={message ?? "Try again."} />;
  }
  if (records.length === 0) {
    return (
      <EmptyState
        title="No trades yet"
        description="Every filled order is recorded here with its price, value and booked P&L."
      />
    );
  }

  return (
    <ResponsiveRecords
      cards={
        <ul>
          {records.map((trade) => (
            <li key={trade.id}>
              <RecordCard
                title={
                  <span className="flex items-center gap-2">
                    {trade.symbol}
                    <SideBadge side={trade.side} />
                  </span>
                }
                subtitle={`${formatDate(trade.executedAt)} · ${formatTime(trade.executedAt)}`}
                value={
                  trade.side === "BUY" ? (
                    <Money value={trade.value as Paise} size="sm" />
                  ) : (
                    <Money value={trade.realisedPnl as Paise} size="sm" signed />
                  )
                }
                meta={[
                  { label: "Qty", value: trade.quantity.toLocaleString("en-IN") },
                  { label: "Price", value: <Price value={trade.price as PriceE4} size="sm" /> },
                ]}
                action={
                  <Link
                    href={`/replay?trade=${encodeURIComponent(trade.id)}`}
                    className="touch-target inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[0.75rem] text-ink-secondary"
                  >
                    <svg viewBox="0 0 12 12" aria-hidden className="size-2.5" fill="currentColor">
                      <path d="M3 2v8l7-4-7-4Z" />
                    </svg>
                    Replay this trade
                  </Link>
                }
              />
            </li>
          ))}
        </ul>
      }
      table={
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-line-subtle">
            <Th className="pl-5 md:pl-6">When</Th>
            <Th>Instrument</Th>
            <Th>Side</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Price</Th>
            <Th align="right">Value</Th>
            <Th align="right">Realised P&L</Th>
            <Th className="pr-5 md:pr-6">
              <span className="sr-only">Replay</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {records.map((trade) => (
            <tr key={trade.id} className="border-b border-line-subtle last:border-b-0">
              <td className="py-3.5 pl-5 text-[0.8125rem] text-ink-secondary md:pl-6">
                <span className="block">{formatDate(trade.executedAt)}</span>
                <span className="tabular block text-[0.6875rem] text-ink-tertiary">
                  {formatTime(trade.executedAt)}
                </span>
              </td>
              <td className="py-3.5">
                <Link href={stockRoute(trade.symbol)} className="text-[0.875rem] font-medium">
                  {trade.symbol}
                </Link>
              </td>
              <td className="py-3.5">
                <SideBadge side={trade.side} />
              </td>
              <td className="tabular py-3.5 text-right text-[0.8125rem]">{trade.quantity}</td>
              <td className="py-3.5 text-right">
                <Price value={trade.price as PriceE4} size="sm" />
              </td>
              <td className="py-3.5 text-right">
                <Money value={trade.value as Paise} size="sm" />
              </td>
              <td className="py-3.5 text-right">
                {trade.side === "BUY" ? (
                  <span className="text-[0.8125rem] text-ink-tertiary">—</span>
                ) : (
                  <Money value={trade.realisedPnl as Paise} size="sm" signed />
                )}
              </td>
              <td className="py-3.5 pr-5 text-right md:pr-6">
                {/*
                  Replay is keyed on the round trip this fill belongs to, which
                  the replay page resolves from the trade log — so a partial
                  exit opens the whole position, not just its own slice.
                */}
                <Link
                  href={`/replay?trade=${encodeURIComponent(trade.id)}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[0.6875rem] text-ink-tertiary transition-colors duration-200 hover:border-ink hover:text-ink"
                >
                  <svg viewBox="0 0 12 12" aria-hidden className="size-2.5" fill="currentColor">
                    <path d="M3 2v8l7-4-7-4Z" />
                  </svg>
                  Replay
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      }
    />
  );
}

function OrderHistory() {
  const { records, state, message } = useHistory<OrderRecord>("/api/orders", "orders");

  if (state === "loading") return <SkeletonRows rows={5} className="px-5 md:px-6" />;
  if (state !== "ready") {
    return <EmptyState title="Could not load orders" description={message ?? "Try again."} />;
  }
  if (records.length === 0) {
    return (
      <EmptyState
        title="No orders yet"
        description="Every order is recorded here — including any that were rejected, with the reason why."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-line-subtle">
            <Th className="pl-5 md:pl-6">Placed</Th>
            <Th>Instrument</Th>
            <Th>Side</Th>
            <Th>Type</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Price</Th>
            <Th className="pr-5 md:pr-6">Status</Th>
          </tr>
        </thead>
        <tbody>
          {records.map((order) => (
            <tr key={order.id} className="border-b border-line-subtle last:border-b-0">
              <td className="py-3.5 pl-5 text-[0.8125rem] text-ink-secondary md:pl-6">
                <span className="block">{formatDate(order.placedAt)}</span>
                <span className="tabular block text-[0.6875rem] text-ink-tertiary">
                  {formatTime(order.placedAt)}
                </span>
              </td>
              <td className="py-3.5">
                <Link href={stockRoute(order.symbol)} className="text-[0.875rem] font-medium">
                  {order.symbol}
                </Link>
              </td>
              <td className="py-3.5">
                <SideBadge side={order.side} />
              </td>
              <td className="py-3.5 text-[0.8125rem] text-ink-secondary">{order.type}</td>
              <td className="tabular py-3.5 text-right text-[0.8125rem]">
                {order.filledQuantity}/{order.quantity}
              </td>
              <td className="py-3.5 text-right">
                {order.averageFillPrice !== null ? (
                  <Price value={order.averageFillPrice as PriceE4} size="sm" />
                ) : order.limitPrice !== null ? (
                  <span className="tabular text-[0.8125rem] text-ink-secondary">
                    limit <Price value={order.limitPrice as PriceE4} size="sm" />
                  </span>
                ) : (
                  <span className="text-[0.8125rem] text-ink-tertiary">—</span>
                )}
              </td>
              <td className="py-3.5 pr-5 md:pr-6">
                <StatusBadge status={order.status} reason={order.statusReason} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SideBadge({ side }: { side: "BUY" | "SELL" }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[0.625rem] font-medium tracking-[0.08em]",
        side === "BUY" ? "border-up/40 text-up" : "border-down/40 text-down",
      )}
    >
      {side}
    </span>
  );
}

function StatusBadge({ status, reason }: { status: string; reason: string | null }) {
  const tone =
    status === "FILLED"
      ? "border-up/40 text-up"
      : status === "REJECTED"
        ? "border-down/40 text-down"
        : status === "PENDING"
          ? "border-accent/40 text-accent"
          : "border-line text-ink-tertiary";

  return (
    <span className="flex flex-col items-start gap-1">
      <span
        className={cn(
          "inline-flex rounded-full border px-2 py-0.5 text-[0.625rem] font-medium tracking-[0.08em]",
          tone,
        )}
        title={reason ?? undefined}
      >
        {status}
      </span>
      {reason ? (
        <span className="max-w-[16rem] text-[0.625rem] leading-snug text-ink-tertiary">
          {reason}
        </span>
      ) : null}
    </span>
  );
}

function Th({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn("eyebrow py-3 font-medium", align === "right" && "text-right", className)}
    >
      {children}
    </th>
  );
}

/** Shown when DATABASE_URL is absent — setup instructions, not an error. */
function DatabaseSetupNotice({ message }: { message: string | null }) {
  return (
    <Panel className="mt-10">
      <div className="px-6 py-12 md:px-10">
        <span className="eyebrow">Setup required</span>
        <h2 className="mt-5 text-display-m">Connect a database</h2>
        <p className="mt-5 max-w-xl text-[0.9375rem] leading-relaxed text-ink-secondary">
          {message ??
            "The paper trading engine stores accounts, orders and trades in PostgreSQL. Point it at a database to start trading."}
        </p>

        <ol className="mt-8 max-w-xl space-y-4">
          <Step index={1} title="Create the database">
            <Code>createdb parallel</Code>
          </Step>
          <Step index={2} title="Add the connection string to .env">
            <Code>{'DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/parallel?schema=public"'}</Code>
          </Step>
          <Step index={3} title="Create the schema">
            <Code>npx prisma migrate dev --name init</Code>
          </Step>
        </ol>

        <p className="mt-8 max-w-xl text-xs leading-relaxed text-ink-tertiary">
          You choose your starting virtual capital when you create an account, and can top it up from Settings. No
          real money is involved at any point.
        </p>
      </div>
    </Panel>
  );
}

function Step({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="border-t border-line-subtle pt-4">
      <div className="flex items-baseline gap-3">
        <span className="tabular text-[0.6875rem] text-ink-tertiary">
          {String(index).padStart(2, "0")}
        </span>
        <span className="text-[0.875rem] font-medium">{title}</span>
      </div>
      <div className="mt-2.5 pl-8">{children}</div>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="block overflow-x-auto rounded-sm border border-line bg-sunken px-3 py-2 text-[0.75rem] whitespace-pre text-ink-secondary">
      {children}
    </code>
  );
}
