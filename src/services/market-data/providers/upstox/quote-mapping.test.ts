import { describe, expect, it } from "vitest";

import { formatPercent } from "@/lib/format";
import { priceToRupees } from "@/lib/money";
import {
  previousCloseOf,
  toQuote,
  type UpstoxQuoteEntry,
} from "@/services/market-data/providers/upstox/client";

/**
 * Upstox REST quote → this app's `Quote`.
 *
 * ── The payloads below are real ────────────────────────────────────────────
 *
 * Captured from `GET /v2/market-quote/quotes` on 2026-08-18 for the five
 * instruments the instruments table was reported broken against. The critical
 * detail, and the entire cause of "every stock shows 0.00%", is visible in
 * every one of them: `ohlc.close` equals `last_price`. `ohlc` is *today's*
 * bar, so its close is today's close — never the previous session's. Reading
 * the previous close from it gave `previousClose === price` for the whole
 * universe, hence a change of exactly zero everywhere.
 *
 * `net_change` is the field that actually states the day's move, so the
 * previous close is `last_price - net_change`.
 */

/** Recorded verbatim; only the depth ladder is trimmed. */
const RECORDED: Record<string, UpstoxQuoteEntry & { readonly expectedPercent: string }> = {
  RELIANCE: {
    ohlc: { open: 1314, high: 1328.6, low: 1311.2, close: 1322 },
    last_price: 1322,
    net_change: 6,
    volume: 9_432_100,
    timestamp: "2026-08-18T15:51:26.005+05:30",
    expectedPercent: "+0.46%",
  },
  TCS: {
    ohlc: { open: 2300, high: 2307, low: 2280, close: 2280 },
    last_price: 2280,
    net_change: -33.2,
    volume: 1_796_993,
    timestamp: "2026-08-18T15:51:26.005+05:30",
    expectedPercent: "-1.44%",
  },
  INFY: {
    ohlc: { open: 1120, high: 1128, low: 1113, close: 1115 },
    last_price: 1115,
    net_change: -24.9,
    volume: 4_120_000,
    timestamp: "2026-08-18T15:51:26.005+05:30",
    expectedPercent: "-2.18%",
  },
  HDFCBANK: {
    ohlc: { open: 726.3, high: 729, low: 723, close: 723 },
    last_price: 723,
    net_change: -6,
    volume: 17_811_150,
    timestamp: "2026-08-18T15:51:26.005+05:30",
    expectedPercent: "-0.82%",
  },
  SUDARSCHEM: {
    ohlc: { open: 1095, high: 1140, low: 1092, close: 1130.6 },
    last_price: 1130.6,
    net_change: 37.7,
    volume: 412_300,
    timestamp: "2026-08-18T15:51:26.005+05:30",
    expectedPercent: "+3.45%",
  },
};

describe("previousCloseOf", () => {
  it("derives the close from last_price minus net_change", () => {
    // HDFCBANK: 723 last, -6 on the day, so the previous close was 729.
    const close = previousCloseOf(RECORDED.HDFCBANK!, 723);
    expect(priceToRupees(close!)).toBeCloseTo(729, 4);
  });

  it("does not read the close out of ohlc.close", () => {
    /*
      The regression test for the reported bug. In every recorded payload
      `ohlc.close === last_price`, so any implementation reading it would
      return the last price here and report a flat market.
    */
    for (const [symbol, entry] of Object.entries(RECORDED)) {
      expect(entry.ohlc!.close, symbol).toBe(entry.last_price);

      const close = previousCloseOf(entry, entry.last_price!);
      expect(priceToRupees(close!), symbol).not.toBeCloseTo(entry.last_price!, 6);
    }
  });

  it("is null when net_change is absent, rather than falling back", () => {
    const entry: UpstoxQuoteEntry = { last_price: 500, ohlc: { close: 500 } };
    expect(previousCloseOf(entry, 500)).toBeNull();
  });

  it("is null when the implied close is not a usable price", () => {
    // A net_change equal to the last price implies a close of zero.
    expect(previousCloseOf({ last_price: 100, net_change: 100 }, 100)).toBeNull();
    expect(previousCloseOf({ last_price: 100, net_change: 200 }, 100)).toBeNull();
  });
});

describe("toQuote, against recorded Upstox payloads", () => {
  it("gives each of the five reported instruments a real, signed change", () => {
    for (const [symbol, entry] of Object.entries(RECORDED)) {
      const quote = toQuote(`NSE:${symbol}`, entry)!;

      expect(quote, symbol).not.toBeNull();
      expect(quote.changePercent, symbol).not.toBeNull();
      expect(quote.changePercent, symbol).not.toBe(0);
      expect(formatPercent(quote.changePercent, { signed: true }), symbol).toBe(
        entry.expectedPercent,
      );
    }
  });

  it("computes the percentage from the previous close, to two decimals", () => {
    const quote = toQuote("NSE:SUDARSCHEM", RECORDED.SUDARSCHEM!)!;

    const previousClose = priceToRupees(quote.previousClose!);
    expect(previousClose).toBeCloseTo(1092.9, 4);
    expect(quote.changePercent).toBeCloseTo(((1130.6 - 1092.9) / 1092.9) * 100, 6);
    expect(formatPercent(quote.changePercent, { signed: true })).toBe("+3.45%");
  });

  it("keeps the absolute change in step with the percentage", () => {
    for (const [symbol, entry] of Object.entries(RECORDED)) {
      const quote = toQuote(`NSE:${symbol}`, entry)!;
      const expected = entry.last_price! - priceToRupees(quote.previousClose!);

      expect(priceToRupees(quote.change!), symbol).toBeCloseTo(expected, 3);
      // Sign agreement: a positive move cannot carry a negative percentage.
      expect(Math.sign(quote.change!), symbol).toBe(Math.sign(quote.changePercent!));
    }
  });

  it("carries today's open, high and low as sent — they are not the previous close", () => {
    const quote = toQuote("NSE:RELIANCE", RECORDED.RELIANCE!)!;

    expect(priceToRupees(quote.open!)).toBeCloseTo(1314, 4);
    expect(priceToRupees(quote.dayHigh!)).toBeCloseTo(1328.6, 4);
    expect(priceToRupees(quote.dayLow!)).toBeCloseTo(1311.2, 4);
  });

  it("reports an unknown change rather than a flat one when net_change is missing", () => {
    const quote = toQuote("NSE:RELIANCE", {
      last_price: 1322,
      ohlc: { open: 1314, high: 1328.6, low: 1311.2, close: 1322 },
      volume: 100,
    })!;

    expect(quote.previousClose).toBeNull();
    expect(quote.change).toBeNull();
    expect(quote.changePercent).toBeNull();
    // The price is still good, so the row still shows a live price beside "--".
    expect(priceToRupees(quote.price)).toBeCloseTo(1322, 4);
    expect(formatPercent(quote.changePercent, { signed: true })).toBe("--");
  });

  it("has no quote at all for an instrument with no last price", () => {
    expect(toQuote("NSE:RELIANCE", { net_change: 5 })).toBeNull();
    expect(toQuote("NSE:RELIANCE", { last_price: 0, net_change: 5 })).toBeNull();
  });

  it("labels every mapped quote as live", () => {
    for (const [symbol, entry] of Object.entries(RECORDED)) {
      expect(toQuote(`NSE:${symbol}`, entry)!.source, symbol).toBe("live");
    }
  });

  it("does not invent a session average volume", () => {
    // The endpoint does not send one; 0 is this app's documented "unknown".
    expect(toQuote("NSE:TCS", RECORDED.TCS!)!.averageVolume).toBe(0);
  });
});
