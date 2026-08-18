/**
 * Trade replay.
 *
 * Pure reconstruction: turns a flat list of fills into round trips, and a round
 * trip plus its candles into a replayable timeline.
 *
 * The unit of replay is a **round trip**, not a single fill. A trade is only
 * meaningful as a complete story — entry, whatever happened in between, exit —
 * and a partial sale in isolation says nothing about whether the decision was
 * any good. So fills are grouped back into the position they belonged to.
 */

import type { Candle } from "@/domain/market";
import {
  addPaise,
  averagePrice,
  notional,
  percentChange,
  priceToRupees,
  subPaise,
  ZERO_PAISE,
  ZERO_PRICE,
  type Paise,
  type PriceE4,
} from "@/lib/money";

export interface Fill {
  readonly id: string;
  readonly orderId: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: PriceE4;
  readonly realisedPnl: Paise;
  readonly source: string;
  readonly executedAt: number;
}

export type RoundTripStatus = "OPEN" | "CLOSED";

export interface RoundTrip {
  /** The opening fill's id — stable, and unique per trip. */
  readonly id: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly status: RoundTripStatus;

  readonly openedAt: number;
  readonly closedAt: number | null;

  readonly fills: readonly Fill[];

  /** Total shares bought across the trip. */
  readonly quantity: number;
  readonly averageEntry: PriceE4;
  /** Volume-weighted exit, or null while still open. */
  readonly averageExit: PriceE4 | null;

  readonly realisedPnl: Paise;
  readonly realisedPnlPercent: number;
  /** Whether any part of this trip came from an automated strategy. */
  readonly automated: boolean;
}

/**
 * Group fills into round trips.
 *
 * Walks each instrument's fills in time order, tracking the running position. A
 * trip opens when the position leaves flat and closes when it returns to flat,
 * so scaling in and partial exits stay inside one trip rather than fragmenting
 * into several.
 *
 * A trip still open at the end of the list is returned with `status: "OPEN"` —
 * it is genuinely part of the history and hiding it would misrepresent what the
 * account did.
 */
export function buildRoundTrips(fills: readonly Fill[]): readonly RoundTrip[] {
  const byInstrument = new Map<string, Fill[]>();

  for (const fill of fills) {
    const list = byInstrument.get(fill.instrumentId) ?? [];
    list.push(fill);
    byInstrument.set(fill.instrumentId, list);
  }

  const trips: RoundTrip[] = [];

  for (const [instrumentId, list] of byInstrument) {
    const ordered = [...list].sort((a, b) => a.executedAt - b.executedAt);

    let open: Fill[] = [];
    let position = 0;

    for (const fill of ordered) {
      // A sell with no position is an orphan — it belongs to a trip whose
      // opening fills predate the window we were given. Skip rather than
      // fabricate an entry for it.
      if (position === 0 && fill.side === "SELL") continue;

      open.push(fill);
      position += fill.side === "BUY" ? fill.quantity : -fill.quantity;

      if (position === 0) {
        trips.push(toRoundTrip(instrumentId, open, "CLOSED"));
        open = [];
      }
    }

    if (open.length > 0) trips.push(toRoundTrip(instrumentId, open, "OPEN"));
  }

  // Newest first — the trade someone wants to review is usually the last one.
  return trips.sort((a, b) => b.openedAt - a.openedAt);
}

function toRoundTrip(
  instrumentId: string,
  fills: readonly Fill[],
  status: RoundTripStatus,
): RoundTrip {
  const first = fills[0]!;

  const buys = fills.filter((fill) => fill.side === "BUY");
  const sells = fills.filter((fill) => fill.side === "SELL");

  const boughtQuantity = buys.reduce((total, fill) => total + fill.quantity, 0);
  const soldQuantity = sells.reduce((total, fill) => total + fill.quantity, 0);

  const buyCost = buys.reduce<Paise>(
    (total, fill) => addPaise(total, notional(fill.price, fill.quantity)),
    ZERO_PAISE,
  );
  const sellProceeds = sells.reduce<Paise>(
    (total, fill) => addPaise(total, notional(fill.price, fill.quantity)),
    ZERO_PAISE,
  );

  const averageEntry = boughtQuantity === 0 ? ZERO_PRICE : averagePrice(buyCost, boughtQuantity);
  const averageExit = soldQuantity === 0 ? null : averagePrice(sellProceeds, soldQuantity);

  // Sum the engine's per-fill realised P&L rather than recomputing from
  // averages — partial exits make the two differ, and the fills are the record.
  const realisedPnl = fills.reduce<Paise>(
    (total, fill) => addPaise(total, fill.realisedPnl),
    ZERO_PAISE,
  );

  // Cost basis of the closed portion only, so the percentage is comparable
  // between a fully closed trip and a partially closed one.
  const closedCost =
    boughtQuantity === 0 ? ZERO_PAISE : notional(averageEntry, Math.min(soldQuantity, boughtQuantity));

  return {
    id: first.id,
    instrumentId,
    symbol: first.symbol,
    status,
    openedAt: first.executedAt,
    closedAt: status === "CLOSED" ? fills[fills.length - 1]!.executedAt : null,
    fills,
    quantity: boughtQuantity,
    averageEntry,
    averageExit,
    realisedPnl,
    realisedPnlPercent: closedCost === 0 ? 0 : (realisedPnl / closedCost) * 100,
    automated: fills.some((fill) => fill.source === "STRATEGY"),
  };
}

// --- timeline --------------------------------------------------------------

export type ReplayEventKind = "ENTRY" | "ADD" | "EXIT" | "PARTIAL_EXIT" | "STOP" | "TARGET";

export interface ReplayEvent {
  readonly time: number;
  readonly kind: ReplayEventKind;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: PriceE4;
  readonly realisedPnl: Paise;
  /** Rule description when a strategy produced this fill. */
  readonly detail: string | null;
}

export interface ReplayFrame {
  readonly candle: Candle;
  /** Shares held after any events on this bar. */
  readonly position: number;
  /** Unrealised P&L on the open position at this bar's close. */
  readonly unrealisedPnl: Paise;
  /** Realised P&L booked up to and including this bar. */
  readonly realisedPnl: Paise;
  /** Events that occurred on this bar. Usually empty. */
  readonly events: readonly ReplayEvent[];
}

/**
 * Build the frame-by-frame timeline.
 *
 * Each candle becomes a frame carrying the position and P&L *as of that bar*,
 * so scrubbing to any point shows what was true then rather than the final
 * outcome. Events are attached to the bar containing their timestamp.
 */
export function buildTimeline(
  trip: RoundTrip,
  candles: readonly Candle[],
  /** Optional per-order rule descriptions, keyed by orderId. */
  strategyDetail: ReadonlyMap<string, { kind: ReplayEventKind; detail: string }> = new Map(),
): readonly ReplayFrame[] {
  if (candles.length === 0) return [];

  const barMs = candles.length > 1 ? candles[1]!.time - candles[0]!.time : 60_000;

  const frames: ReplayFrame[] = [];

  let position = 0;
  let invested: Paise = ZERO_PAISE;
  let realised: Paise = ZERO_PAISE;
  let fillIndex = 0;

  const ordered = [...trip.fills].sort((a, b) => a.executedAt - b.executedAt);

  for (const candle of candles) {
    const events: ReplayEvent[] = [];
    const barEnd = candle.time + barMs;

    // Attach every fill that happened within this bar's span.
    while (fillIndex < ordered.length && ordered[fillIndex]!.executedAt < barEnd) {
      const fill = ordered[fillIndex]!;
      fillIndex += 1;

      const override = strategyDetail.get(fill.orderId);
      const value = notional(fill.price, fill.quantity);

      if (fill.side === "BUY") {
        events.push({
          time: fill.executedAt,
          kind: override?.kind ?? (position === 0 ? "ENTRY" : "ADD"),
          side: "BUY",
          quantity: fill.quantity,
          price: fill.price,
          realisedPnl: ZERO_PAISE,
          detail: override?.detail ?? null,
        });

        position += fill.quantity;
        invested = addPaise(invested, value);
      } else {
        // Proportional slice of cost, matching how the trading engine books it.
        const costOfSold =
          position === 0
            ? ZERO_PAISE
            : (Math.round((invested * Math.min(fill.quantity, position)) / position) as Paise);

        position -= fill.quantity;
        invested = subPaise(invested, costOfSold);
        realised = addPaise(realised, fill.realisedPnl);

        events.push({
          time: fill.executedAt,
          kind: override?.kind ?? (position <= 0 ? "EXIT" : "PARTIAL_EXIT"),
          side: "SELL",
          quantity: fill.quantity,
          price: fill.price,
          realisedPnl: fill.realisedPnl,
          detail: override?.detail ?? null,
        });
      }
    }

    const unrealised =
      position <= 0 ? ZERO_PAISE : subPaise(notional(candle.close, position), invested);

    frames.push({
      candle,
      position: Math.max(0, position),
      unrealisedPnl: unrealised,
      realisedPnl: realised,
      events,
    });
  }

  return frames;
}

/**
 * The window of candles worth showing around a trip.
 *
 * Padded on both sides so the entry is not flush against the left edge and the
 * exit not against the right — context before and after is most of what makes a
 * replay instructive.
 */
export function replayWindow(
  trip: RoundTrip,
  paddingRatio = 0.3,
): { from: number; to: number } {
  const end = trip.closedAt ?? Date.now();
  const span = Math.max(end - trip.openedAt, 60_000);
  const padding = Math.max(span * paddingRatio, 5 * 60_000);

  return { from: trip.openedAt - padding, to: Math.min(end + padding, Date.now()) };
}

/** Peak unrealised gain and worst unrealised loss during the hold. */
export function holdExtremes(frames: readonly ReplayFrame[]): {
  bestUnrealised: Paise;
  worstUnrealised: Paise;
} {
  let best: Paise = ZERO_PAISE;
  let worst: Paise = ZERO_PAISE;

  for (const frame of frames) {
    if (frame.position <= 0) continue;
    if (frame.unrealisedPnl > best) best = frame.unrealisedPnl;
    if (frame.unrealisedPnl < worst) worst = frame.unrealisedPnl;
  }

  return { bestUnrealised: best, worstUnrealised: worst };
}

export { percentChange, priceToRupees };
