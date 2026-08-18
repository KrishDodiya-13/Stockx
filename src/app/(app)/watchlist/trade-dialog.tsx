"use client";

import type { Quote } from "@/domain/market";
import { Modal } from "@/components/ui/modal";
import { TradePanel } from "@/components/trade/trade-panel";

/**
 * The order ticket, opened from a watchlist row.
 *
 * Deliberately thin. All the order logic — quantity, market or limit, cash
 * checks, the market-hours rejection — already lives in `TradePanel`, which the
 * stock detail page uses. Reimplementing any of that here would give the app
 * two order paths that could drift apart; this only supplies the instrument and
 * the quote it already has.
 *
 * The order still goes to `POST /api/orders`, which prices it server-side and
 * settles it against STOCKX virtual cash. Nothing here reaches Upstox — Upstox
 * supplies prices, never orders.
 */
export function TradeDialog({
  instrumentId,
  symbol,
  name,
  side,
  quote,
  onClose,
}: {
  instrumentId: string;
  symbol: string;
  name: string;
  /** Which tab the ticket opens on. The user can still switch inside it. */
  side: "buy" | "sell";
  quote: Quote | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
      description={name}
    >
      <TradePanel
        instrumentId={instrumentId}
        symbol={symbol}
        quote={quote}
        initialSide={side}
        // Close on a filled order so the user lands back on the list they were
        // working through, rather than on a ticket they have finished with.
        onOrderPlaced={onClose}
      />
    </Modal>
  );
}
