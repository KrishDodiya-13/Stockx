"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Panel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Money } from "@/components/ui/financial";
import { Magnetic } from "@/components/ui/magnetic";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import type { PortfolioSummary } from "@/domain/trading";
import { usePortfolio } from "@/hooks/use-portfolio";
import type { Quote } from "@/domain/market";
import { cn } from "@/lib/cn";
import { formatCurrency } from "@/lib/format";
import { notional, priceToRupees, rupeesToPrice, subPaise, type Paise, type PriceE4 } from "@/lib/money";
import { handleSessionExpiry } from "@/lib/session-expiry";

type Side = "buy" | "sell";
type OrderType = "market" | "limit";

/** Stages an order passes through, surfaced on the execute button. */
type ExecutionStage = "idle" | "executing" | "received" | "executed" | "done";

const STAGE_LABEL: Record<ExecutionStage, string> = {
  idle: "",
  executing: "Executing…",
  received: "Order received",
  executed: "Executed",
  done: "",
};

const hold = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const SIDES: readonly TabItem<Side>[] = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
];

const ORDER_TYPES: readonly TabItem<OrderType>[] = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
];

/**
 * Order ticket, connected to the paper trading engine.
 *
 * The figures shown here are previews only. The **server** re-prices and
 * re-validates every order against its own market data and the account's real
 * balance before anything is written — a client-supplied price or a stale cash
 * figure can never produce a fill.
 */
export function TradePanel({
  instrumentId,
  symbol,
  quote,
  className,
  initialSide = "buy",
  onOrderPlaced,
}: {
  instrumentId: string;
  symbol: string;
  quote: Quote | null;
  className?: string;
  /**
   * Which tab to open on. The watchlist opens this ticket from a Buy or a Sell
   * button, so the ticket should already be on the side that was clicked. Only
   * the initial value — the user can still switch tabs inside the panel.
   */
  initialSide?: Side;
  onOrderPlaced?: () => void;
}) {
  const [side, setSide] = useState<Side>(initialSide);
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [quantityText, setQuantityText] = useState("10");
  const [limitText, setLimitText] = useState("");
  const [stage, setStage] = useState<ExecutionStage>("idle");
  const submitting = stage !== "idle" && stage !== "done";

  const { toast } = useToast();
  const { portfolio, state: portfolioState, refresh } = usePortfolio(8000);

  // The execution sequence awaits between stages; if the user navigates away
  // mid-flight, those timers must not write to an unmounted component.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const quantity = useMemo(() => {
    const value = Number(quantityText.trim());
    return Number.isInteger(value) && value > 0 ? value : 0;
  }, [quantityText]);

  const limitPrice = useMemo<PriceE4 | null>(() => {
    const value = Number(limitText.trim());
    return Number.isFinite(value) && value > 0 ? rupeesToPrice(value) : null;
  }, [limitText]);

  const effectivePrice: PriceE4 | null =
    orderType === "limit" ? limitPrice : (quote?.price ?? null);

  const orderValue = effectivePrice && quantity > 0 ? notional(effectivePrice, quantity) : null;

  const cash: Paise | null = portfolio?.cashBalance ?? null;
  const held = portfolio?.holdings.find((h) => h.instrumentId === instrumentId) ?? null;
  const ownedQuantity = held?.quantity ?? 0;

  // Local pre-checks mirror the server's rules so the user gets immediate
  // feedback. They are advisory: the server decides.
  const exceedsCash = side === "buy" && orderValue !== null && cash !== null && orderValue > cash;
  const exceedsHolding = side === "sell" && quantity > ownedQuantity;

  const quantityError =
    quantityText.trim().length > 0 && quantity === 0
      ? "Enter a whole number of shares above zero"
      : undefined;

  const limitError =
    orderType === "limit" && limitText.trim().length > 0 && limitPrice === null
      ? "Enter a limit price above zero"
      : undefined;

  const blocked =
    quantity === 0 ||
    Boolean(quantityError) ||
    Boolean(limitError) ||
    (orderType === "limit" && limitPrice === null) ||
    exceedsCash ||
    exceedsHolding ||
    portfolioState === "unconfigured";

  async function submit(): Promise<void> {
    if (blocked || submitting) return;

    /*
      Staged execution.

      The stages are shown because they are *true* — the request really is in
      flight, and really was acknowledged — not as a decorative delay. The only
      artificial pause is a short hold on "Order received" so the acknowledgement
      is readable rather than a flicker; the network work has already happened
      by then.
    */
    setStage("executing");

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrumentId,
          side: side === "buy" ? "BUY" : "SELL",
          type: orderType === "limit" ? "LIMIT" : "MARKET",
          quantity,
          // The server ignores this for pricing; it is the limit instruction.
          limitPrice: limitPrice === null ? null : priceToRupees(limitPrice),
        }),
      });

      if (handleSessionExpiry(response)) return;

      const payload = (await response.json()) as {
        ok?: boolean;
        status?: string;
        message?: string;
      };

      if (response.ok && payload.ok) {
        if (!mountedRef.current) return;
        setStage("received");
        await hold(520);
        if (!mountedRef.current) return;
        setStage("executed");

        toast({
          title: payload.status === "PENDING" ? "Order resting" : "Order filled",
          description: payload.message,
          tone: "success",
        });
        refresh();
        onOrderPlaced?.();

        await hold(900);
        if (!mountedRef.current) return;
        setStage("idle");
      } else {
        setStage("idle");
        toast({
          title: "Order rejected",
          description: payload.message ?? "The order could not be placed.",
          tone: "error",
        });
        refresh();
      }
    } catch {
      setStage("idle");
      toast({
        title: "Could not reach the trading engine",
        description: "Your order was not placed. Check your connection and try again.",
        tone: "error",
      });
    }
  }

  return (
    <Panel className={className}>
      <div className="space-y-4 border-b border-line px-5 py-4 md:px-6">
        <Tabs items={SIDES} value={side} onValueChange={setSide} variant="segment" />

        {/* What you are trading, and at what — stated before the inputs. */}
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[0.9375rem] font-medium tracking-[-0.01em]">{symbol}</span>
          <span className="tabular text-numeric-m">
            {quote ? `₹${priceToRupees(quote.price).toFixed(2)}` : "—"}
          </span>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5 md:px-6">
        <Tabs items={ORDER_TYPES} value={orderType} onValueChange={setOrderType} variant="segment" />

        <Input
          label="Quantity"
          numeric
          inputMode="numeric"
          value={quantityText}
          onChange={(event) => setQuantityText(event.target.value)}
          trailing="shares"
          error={quantityError}
          hint={
            side === "sell" && ownedQuantity > 0
              ? `You hold ${ownedQuantity.toLocaleString("en-IN")} shares`
              : undefined
          }
        />

        {orderType === "limit" ? (
          <Input
            label="Limit price"
            numeric
            inputMode="decimal"
            leading="₹"
            value={limitText}
            onChange={(event) => setLimitText(event.target.value)}
            placeholder={quote ? priceToRupees(quote.price).toFixed(2) : ""}
            error={limitError}
            hint="Rests until the market reaches this price"
          />
        ) : (
          <Field label="Price">
            <div className="flex h-11 items-center justify-between rounded-sm border border-line px-3.5">
              <span className="text-[0.8125rem] text-ink-tertiary">At market</span>
              <span className="tabular text-[0.9375rem]">
                {quote ? `₹${priceToRupees(quote.price).toFixed(2)}` : "—"}
              </span>
            </div>
          </Field>
        )}

        <dl className="border-t border-line-subtle pt-4 text-[0.8125rem]">
          <Row label="Order value">
            {orderValue ? <Money value={orderValue} size="sm" /> : <span className="tabular">—</span>}
          </Row>
          <Row label="Available cash">
            {cash === null ? (
              <span className="tabular text-ink-tertiary">—</span>
            ) : (
              <span className="tabular">{formatCurrency(cash, { whole: true })}</span>
            )}
          </Row>
          {side === "buy" && cash !== null && orderValue !== null ? (
            <Row label="Cash after">
              <span className={cn("tabular", exceedsCash && "text-down")}>
                {formatCurrency(subPaise(cash, orderValue), { whole: true })}
              </span>
            </Row>
          ) : null}
        </dl>

        {exceedsCash ? (
          <p className="text-xs text-down" role="alert">
            This order costs more than the available virtual cash.
          </p>
        ) : null}
        {exceedsHolding ? (
          <p className="text-xs text-down" role="alert">
            {ownedQuantity === 0
              ? "You do not hold any shares of this instrument."
              : `You hold ${ownedQuantity.toLocaleString("en-IN")} shares; this would sell more than you own.`}
          </p>
        ) : null}
        {portfolioState === "unconfigured" ? (
          <p className="text-xs text-accent" role="alert">
            The trading database is not configured, so orders cannot be placed yet.
          </p>
        ) : null}

        <Magnetic className="block w-full" strength={4}>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={blocked || submitting}
            aria-live="polite"
            className={cn(
              "relative flex h-12 w-full items-center justify-center overflow-hidden rounded-full",
              "text-[0.9375rem] font-medium",
              "transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
              "hover:-translate-y-px active:translate-y-0 active:scale-[0.99]",
              "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0",
              side === "buy"
                ? "bg-up text-white hover:bg-up/90"
                : "bg-down text-white hover:bg-down/90",
            )}
          >
            {/* A progress sweep during flight, so the wait is legible. */}
            {submitting ? (
              <span
                aria-hidden
                className="absolute inset-0 origin-left animate-[sweep_1.1s_ease-in-out_infinite] bg-white/15"
              />
            ) : null}

            <span className="relative">
              {stage === "idle"
                ? `${side === "buy" ? "Execute paper buy" : "Execute paper sell"}`
                : STAGE_LABEL[stage]}
            </span>
          </button>
        </Magnetic>

        <p className="text-center text-[0.6875rem] leading-relaxed text-ink-tertiary">
          Paper trading — this places a simulated order against virtual money. No real order reaches
          any exchange or broker.
        </p>
      </div>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-ink-secondary">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export type { PortfolioSummary };
