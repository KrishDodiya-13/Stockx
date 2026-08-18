/**
 * Upstox instrument-key mapping.
 *
 * Upstox's V3 market-data feed identifies instruments by an ISIN-based key —
 * `NSE_EQ|INE002A01018` — not by trading symbol. There is no rule that derives
 * one from the other, so the mapping comes from Upstox's own published master
 * via `scripts/refresh-upstox-keys.mjs`, and lives in the generated file next
 * to this one.
 *
 * This module stays thin on purpose: it is the only place that knows a vendor
 * key exists, so the app's own `Instrument` shape stays vendor-agnostic.
 *
 * Note the format change. An earlier version of this file used
 * `NSE_EQ:RELIANCE` — the colon-and-symbol form the *v2 REST* quote endpoint
 * takes. The V3 feed does not accept it, so those keys would have subscribed
 * to nothing at all.
 */

import { instrumentId } from "@/services/market-data/universe";
import {
  UNMAPPED_SYMBOLS,
  UPSTOX_KEY_BY_SYMBOL,
} from "@/services/market-data/providers/upstox/instrument-keys.generated";

export { UNMAPPED_SYMBOLS };

/**
 * The exchange a vendor key belongs to.
 *
 * Read off the key's own segment prefix (`NSE_EQ`, `NSE_INDEX`, `BSE_INDEX`)
 * rather than assumed. This used to be hardcoded to NSE, which was true only
 * while SENSEX was unmapped: adding the BSE index under that assumption would
 * have produced the id `NSE:SENSEX`, which matches nothing in the registry, so
 * the tile would have stayed blank while looking wired up.
 */
function exchangeOf(upstoxKey: string): "NSE" | "BSE" {
  return upstoxKey.startsWith("BSE_") ? "BSE" : "NSE";
}

function appId(symbol: string, upstoxKey: string): string {
  return instrumentId(exchangeOf(upstoxKey), symbol);
}

const entries: readonly (readonly [string, string])[] = Object.entries(UPSTOX_KEY_BY_SYMBOL).map(
  ([symbol, key]) => [appId(symbol, key), key] as const,
);

/** This app's instrument id -> Upstox instrument_key. */
export const UPSTOX_INSTRUMENT_KEY_BY_ID: ReadonlyMap<string, string> = new Map(entries);

/** Upstox instrument_key -> this app's instrument id. */
export const INSTRUMENT_ID_BY_UPSTOX_KEY: ReadonlyMap<string, string> = new Map(
  entries.map(([id, key]) => [key, id]),
);

export function toUpstoxKey(instrumentId: string): string | undefined {
  return UPSTOX_INSTRUMENT_KEY_BY_ID.get(instrumentId);
}

export function fromUpstoxKey(upstoxKey: string): string | undefined {
  return INSTRUMENT_ID_BY_UPSTOX_KEY.get(upstoxKey);
}

/**
 * The instruments the live feed is allowed to subscribe to.
 *
 * Deliberately a short list rather than the whole registry. Upstox caps how
 * many instruments one connection may carry, and a dashboard that opens with
 * ninety subscriptions is both slower to first price and harder to diagnose
 * when something is wrong. Widen it through `UPSTOX_LIVE_SYMBOLS` once the
 * feed is known good.
 */
const DEFAULT_LIVE_SYMBOLS = [
  "RELIANCE",
  "HDFCBANK",
  "TCS",
  "INFY",
  "SUDARSCHEM",
  // The three indices the dashboard's market strip reads. They were mapped but
  // never enabled, so those tiles had no feed to update from and sat frozen
  // while the equities around them moved. SENSEX is a BSE index and subscribes
  // through the BSE_INDEX segment; it is not an NSE equity and must never be
  // requested as one.
  "NIFTY50",
  "BANKNIFTY",
  "SENSEX",
] as const;

function parseLiveSymbols(raw: string | undefined): readonly string[] {
  if (!raw) return DEFAULT_LIVE_SYMBOLS;
  if (raw.trim() === "*") return Object.keys(UPSTOX_KEY_BY_SYMBOL);

  const symbols = raw
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  return symbols.length > 0 ? symbols : DEFAULT_LIVE_SYMBOLS;
}

/*
  Read from the bare environment rather than `serverEnv` so this module stays
  importable from anywhere. It is a list of ticker symbols, not a secret, and
  it resolves to the default list in the browser where the variable is absent.
*/
const LIVE_SYMBOLS = parseLiveSymbols(process.env.UPSTOX_LIVE_SYMBOLS);

/**
 * App instrument ids the feed may subscribe to, in registry order.
 *
 * A symbol with no vendor key drops out here rather than becoming an id that
 * resolves to nothing — the exchange comes from the key, so an unmapped symbol
 * has no id to form in the first place.
 */
export const LIVE_INSTRUMENT_IDS: readonly string[] = LIVE_SYMBOLS.flatMap((symbol) => {
  const key = UPSTOX_KEY_BY_SYMBOL[symbol];
  return key ? [appId(symbol, key)] : [];
});

const LIVE_INSTRUMENT_SET: ReadonlySet<string> = new Set(LIVE_INSTRUMENT_IDS);

/** Instruments that can receive a live feed. */
export function liveInstrumentIds(): readonly string[] {
  return LIVE_INSTRUMENT_IDS;
}

/** Every instrument with a vendor key, whether or not it is enabled. */
export function mappedInstrumentIds(): readonly string[] {
  return [...UPSTOX_INSTRUMENT_KEY_BY_ID.keys()];
}

/**
 * True when this instrument is enabled for the live feed.
 *
 * Note this is narrower than "has a vendor key" — an instrument can be
 * mappable but switched off. Callers use this to decide whether a live price
 * is expected at all, so it must reflect what is actually subscribed.
 */
export function hasLiveFeed(instrumentId: string): boolean {
  return LIVE_INSTRUMENT_SET.has(instrumentId);
}
