"use client";

import { useEffect, useState } from "react";

import { useToast } from "@/components/ui/toast";
import type { Instrument, Quote } from "@/domain/market";
import { cn } from "@/lib/cn";
import { formatCurrency } from "@/lib/format";
import { notional, priceToRupees, type Paise } from "@/lib/money";
import { getMarketDataService } from "@/services/market-data";
import { handleSessionExpiry } from "@/lib/session-expiry";

export type OrderSide = "BUY" | "SELL";

type Stage = "entry" | "submitting" | "done";

/**
 * The quantity-and-confirm step of a palette order.
 *
 * Kept as its own component because it is the one part of the palette that
 * *changes an account* rather than navigating. It shows the live price, the
 * resulting order value and the cash effect before anything is sent, and the
 * server re-prices and re-validates regardless — the palette is a fast path to
 * the same engine, never a shortcut around its checks.
 */
export function OrderFlow({
  instrument,
  side,
  onDone,
  onCancel,
}: {
  instrument: Instrument;
  side: OrderSide;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [quantity, setQuantity] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [stage, setStage] = useState<Stage>("entry");
  const [error, setError] = useState<string | null>(null);

  // Live price for the confirmation line.
  useEffect(() => {
    const service = getMarketDataService();
    let cancelled = false;

    void service.getQuote(instrument.id).then((next) => {
      if (!cancelled) setQuote(next);
    });

    const unsubscribe = service.subscribeQuote(instrument.id, (next) => {
      if (!cancelled) setQuote(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [instrument.id]);

  const parsed = Number(quantity.trim());
  const valid = Number.isInteger(parsed) && parsed > 0;
  const value = valid && quote ? notional(quote.price, parsed) : null;

  async function submit(): Promise<void> {
    if (!valid || stage !== "entry") return;

    setStage("submitting");
    setError(null);

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrumentId: instrument.id,
          side,
          type: "MARKET",
          quantity: parsed,
          limitPrice: null,
        }),
      });

      if (handleSessionExpiry(response)) return;

      const payload = (await response.json()) as { ok?: boolean; message?: string };

      if (response.ok && payload.ok) {
        setStage("done");
        toast({
          title: `${side === "BUY" ? "Bought" : "Sold"} ${parsed} ${instrument.symbol}`,
          description: payload.message,
          tone: "success",
        });
        onDone();
        return;
      }

      // A rejection is shown in place rather than closing the palette, so the
      // quantity can be corrected without starting over.
      setStage("entry");
      setError(payload.message ?? "The order was rejected.");
    } catch {
      setStage("entry");
      setError("Could not reach the trading engine.");
    }
  }

  return (
    <div className="px-4 py-5">
      <div className="flex items-baseline justify-between gap-4">
        <span
          className={cn(
            "text-[0.6875rem] font-medium uppercase tracking-[0.14em]",
            side === "BUY" ? "text-up" : "text-down",
          )}
        >
          {side}
        </span>
        <span className="tabular text-[0.8125rem] text-ink-secondary">
          {quote ? `₹${priceToRupees(quote.price).toFixed(2)}` : "—"}
        </span>
      </div>

      <p className="mt-2 text-[1.0625rem] font-medium">{instrument.symbol}</p>
      <p className="mt-0.5 text-[0.75rem] text-ink-tertiary">{instrument.name}</p>

      <label className="mt-5 block">
        <span className="eyebrow mb-2 block">Quantity</span>
        <input
          // Focused on mount so the flow is keyboard-continuous.
          autoFocus
          value={quantity}
          inputMode="numeric"
          onChange={(event) => setQuantity(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder="Shares"
          className="tabular h-12 w-full rounded-sm border border-line bg-transparent px-3.5 text-[1.0625rem] focus:border-ink focus:outline-none"
        />
      </label>

      <dl className="mt-4 space-y-1.5 text-[0.8125rem]">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-secondary">Order value</dt>
          <dd className="tabular">
            {value === null ? "—" : formatCurrency(value as Paise, { whole: true })}
          </dd>
        </div>
      </dl>

      {error ? (
        <p className="mt-3 text-[0.75rem] text-down" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!valid || stage !== "entry"}
          className={cn(
            "h-10 flex-1 rounded-full text-[0.875rem] font-medium text-white transition-all duration-200",
            "disabled:pointer-events-none disabled:opacity-40",
            side === "BUY" ? "bg-up hover:bg-up/90" : "bg-down hover:bg-down/90",
          )}
        >
          {stage === "submitting" ? "Placing…" : `Execute paper ${side.toLowerCase()}`}
        </button>

        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-full border border-line px-4 text-[0.8125rem] text-ink-secondary transition-colors hover:border-ink hover:text-ink"
        >
          Back
        </button>
      </div>

      <p className="mt-3 text-center text-[0.625rem] text-ink-tertiary">
        Paper trading · virtual money · press Enter to execute
      </p>
    </div>
  );
}
