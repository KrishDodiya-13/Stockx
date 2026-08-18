import { describe, expect, it } from "vitest";

import { formatPercent } from "@/lib/format";
import { priceToRupees } from "@/lib/money";
import { INSTRUMENTS } from "@/services/market-data/universe";
import {
  INSTRUMENT_ID_BY_UPSTOX_KEY,
  UNMAPPED_SYMBOLS,
  UPSTOX_INSTRUMENT_KEY_BY_ID,
  fromUpstoxKey,
  hasLiveFeed,
  LIVE_INSTRUMENT_IDS,
  liveInstrumentIds,
  mappedInstrumentIds,
  toUpstoxKey,
} from "@/services/market-data/providers/upstox/instrument-keys";
import { tickToQuote, upstoxFeed, type LiveTick } from "@/services/market-data/providers/upstox/feed";

/**
 * The vendor boundary.
 *
 * Two things are worth pinning down here, because getting either wrong fails
 * silently rather than loudly: the *format* of the instrument key (a wrong
 * format subscribes to nothing and looks like a quiet market), and the
 * conversion from a vendor float to this app's integer money (a wrong scale
 * shows a ₹1,400 stock at ₹0.14 or ₹14,00,000).
 */

/** The five the integration was specified against. */
const NAMED = ["RELIANCE", "HDFCBANK", "TCS", "INFY", "SUDARSCHEM"] as const;

describe("Upstox instrument keys", () => {
  it("uses the V3 pipe-and-ISIN format, not the v2 colon-and-symbol one", () => {
    for (const [id, key] of UPSTOX_INSTRUMENT_KEY_BY_ID) {
      expect(key, id).toMatch(/^(NSE_EQ|NSE_INDEX|BSE_INDEX)\|/);
      // `NSE_EQ:RELIANCE` is the v2 REST form; the V3 feed ignores it.
      expect(key, id).not.toContain(":");
    }
  });

  it("puts each instrument in the segment its own exchange publishes", () => {
    /*
      An equity is an equity and an index is an index, on the exchange that
      lists it. This is the assertion that would have caught SENSEX being
      mapped as `NSE_EQ|SENSEX` or given the app id `NSE:SENSEX` — a BSE index
      dressed as an NSE share, which subscribes to nothing and prices nothing.
    */
    for (const [id, key] of UPSTOX_INSTRUMENT_KEY_BY_ID) {
      const instrument = INSTRUMENTS.find((candidate) => candidate.id === id);
      expect(instrument, id).toBeDefined();

      const segment = key.split("|")[0]!;
      expect(segment, id).toBe(
        `${instrument!.exchange}_${instrument!.kind === "index" ? "INDEX" : "EQ"}`,
      );
    }
  });

  it("maps every equity key to an ISIN", () => {
    for (const [id, key] of UPSTOX_INSTRUMENT_KEY_BY_ID) {
      if (!key.startsWith("NSE_EQ|")) continue;
      expect(key.slice("NSE_EQ|".length), id).toMatch(/^INE[0-9A-Z]{9}$/);
    }
  });

  it("resolves each of the five named instruments", () => {
    for (const symbol of NAMED) {
      const key = toUpstoxKey(`NSE:${symbol}`);
      expect(key, symbol).toBeDefined();
      expect(key, symbol).toMatch(/^NSE_EQ\|INE/);
    }
  });

  it("gives SUDARSCHEM a key from the registry like any other instrument", () => {
    // No special case, no hardcoded price — it resolves through the same map.
    expect(toUpstoxKey("NSE:SUDARSCHEM")).toBe("NSE_EQ|INE659A01023");
    expect(hasLiveFeed("NSE:SUDARSCHEM")).toBe(true);
  });

  it("round-trips id -> key -> id", () => {
    for (const id of mappedInstrumentIds()) {
      expect(fromUpstoxKey(toUpstoxKey(id)!)).toBe(id);
    }
  });

  it("assigns a distinct key to every instrument", () => {
    // A duplicate would silently give two symbols the same company's price.
    expect(INSTRUMENT_ID_BY_UPSTOX_KEY.size).toBe(UPSTOX_INSTRUMENT_KEY_BY_ID.size);
  });

  it("points every mapped id at a real registry instrument", () => {
    const known = new Set(INSTRUMENTS.map((instrument) => instrument.id));
    for (const id of mappedInstrumentIds()) expect(known, id).toContain(id);
  });

  it("maps the registry apart from the symbols Upstox's master omits", () => {
    const equities = INSTRUMENTS.filter((instrument) => instrument.kind === "equity");
    const mapped = new Set(mappedInstrumentIds());
    const covered = equities.filter((instrument) => mapped.has(instrument.id));
    expect(covered.length).toBe(equities.length - UNMAPPED_SYMBOLS.length);
  });

  it("reports no feed rather than a guessed key for unmapped symbols", () => {
    // These are genuinely absent from Upstox's master. An invented key would
    // subscribe to another company, which is worse than no price at all.
    for (const symbol of UNMAPPED_SYMBOLS) {
      expect(toUpstoxKey(`NSE:${symbol}`), symbol).toBeUndefined();
      expect(hasLiveFeed(`NSE:${symbol}`), symbol).toBe(false);
    }
  });

  it("enables the five equities and all three indices", () => {
    // Upstox caps instruments per connection, and a short list is far easier to
    // diagnose than ninety. `UPSTOX_LIVE_SYMBOLS` widens it.
    //
    // The indices are here because they were mapped but not enabled, so the
    // dashboard's NIFTY and BANKNIFTY tiles had no feed and sat frozen while
    // the equities beside them moved. SENSEX was worse still: unmapped
    // entirely, so its tile had nothing to show at all.
    expect(liveInstrumentIds()).toEqual([
      "NSE:RELIANCE",
      "NSE:HDFCBANK",
      "NSE:TCS",
      "NSE:INFY",
      "NSE:SUDARSCHEM",
      "NSE:NIFTY50",
      "NSE:BANKNIFTY",
      "BSE:SENSEX",
    ]);
    expect(LIVE_INSTRUMENT_IDS).toBe(liveInstrumentIds());
  });

  it("gives the indices their INDEX keys, not equity ones", () => {
    // An index carries no ISIN; its key is the exchange segment and the index
    // name. Sending an NSE_EQ key for one subscribes to nothing.
    expect(toUpstoxKey("NSE:NIFTY50")).toBe("NSE_INDEX|Nifty 50");
    expect(toUpstoxKey("NSE:BANKNIFTY")).toBe("NSE_INDEX|Nifty Bank");
    expect(hasLiveFeed("NSE:NIFTY50")).toBe(true);
    expect(hasLiveFeed("NSE:BANKNIFTY")).toBe(true);
  });

  it("subscribes SENSEX as a BSE index, and only under that id", () => {
    // Verified against Upstox's published BSE master: the SENSEX row is
    // `BSE_INDEX|SENSEX`, named "BSE SENSEX". There is no NSE listing of it,
    // so `NSE:SENSEX` must resolve to nothing at all.
    expect(toUpstoxKey("BSE:SENSEX")).toBe("BSE_INDEX|SENSEX");
    expect(hasLiveFeed("BSE:SENSEX")).toBe(true);

    expect(toUpstoxKey("NSE:SENSEX")).toBeUndefined();
    expect(hasLiveFeed("NSE:SENSEX")).toBe(false);
  });

  it("distinguishes 'enabled for the feed' from 'has a vendor key'", () => {
    // TATASTEEL is in Upstox's master but not in the starting five, so it has
    // a key and no live feed. Conflating the two would make the app expect
    // ticks that were never subscribed.
    expect(toUpstoxKey("NSE:TATASTEEL")).toBeDefined();
    expect(hasLiveFeed("NSE:TATASTEEL")).toBe(false);
    expect(mappedInstrumentIds().length).toBeGreaterThan(liveInstrumentIds().length);
  });

  it("enables only instruments that also have a vendor key", () => {
    for (const id of liveInstrumentIds()) expect(toUpstoxKey(id), id).toBeDefined();
  });

  it("has no feed for an instrument that does not exist", () => {
    expect(hasLiveFeed("NSE:NOTAREALSYMBOL")).toBe(false);
    expect(fromUpstoxKey("NSE_EQ|INE000000000")).toBeUndefined();
  });
});

function tick(overrides: Partial<LiveTick> = {}): LiveTick {
  return {
    instrumentId: "NSE:RELIANCE",
    ltp: 1_402.35,
    cp: 1_390.1,
    ltt: 1_770_000_000_000,
    receivedAt: 1_770_000_000_100,
    ...overrides,
  };
}

describe("converting an Upstox tick to a quote", () => {
  it("keeps the last traded price exactly, to the paisa", () => {
    const quote = tickToQuote(tick({ ltp: 1_402.35 }));
    expect(priceToRupees(quote.price)).toBeCloseTo(1_402.35, 4);
  });

  it("uses LTP as the current price and CP as the previous close", () => {
    const quote = tickToQuote(tick({ ltp: 1_402.35, cp: 1_390.1 }));
    expect(priceToRupees(quote.price)).toBeCloseTo(1_402.35, 4);
    expect(priceToRupees(quote.previousClose!)).toBeCloseTo(1_390.1, 4);
  });

  it("derives the day's change from LTP against CP", () => {
    const quote = tickToQuote(tick({ ltp: 1_402.35, cp: 1_390.1 }));
    expect(priceToRupees(quote.change!)).toBeCloseTo(12.25, 4);
    expect(quote.changePercent).toBeCloseTo((12.25 / 1_390.1) * 100, 6);
  });

  it("reports a fall as a negative change", () => {
    const quote = tickToQuote(tick({ ltp: 1_380, cp: 1_400 }));
    expect(priceToRupees(quote.change!)).toBeCloseTo(-20, 4);
    expect(quote.changePercent!).toBeLessThan(0);
  });

  it("matches the worked example: 150 against a close of 145 is +3.45%", () => {
    const quote = tickToQuote(tick({ ltp: 150, cp: 145 }));
    expect(quote.changePercent).toBeCloseTo(3.4483, 3);
    expect(formatPercent(quote.changePercent, { signed: true })).toBe("+3.45%");
  });

  it("labels the quote as live, never as simulated", () => {
    // This is what drives the data-source badge. Mislabelling real data as
    // simulated (or the reverse) is the one thing this must never do.
    expect(tickToQuote(tick()).source).toBe("live");
  });

  it("carries Upstox's last-traded time, not the receipt time", () => {
    const quote = tickToQuote(tick({ ltt: 1_770_000_000_000, receivedAt: 1_770_000_009_999 }));
    expect(quote.timestamp).toBe(1_770_000_000_000);
  });

  it("reports an unknown change, not a flat one, when Upstox sends no close", () => {
    /*
      This test used to assert the opposite — that a missing `cp` should be
      backfilled with the last traded price, producing a change of exactly
      zero. That is what put 0.00% against every row of the instruments table,
      and it read as "the entire market is unchanged" rather than as "we were
      not told". Null is the only honest answer, and the UI renders it "--".
    */
    const quote = tickToQuote(tick({ ltp: 900, cp: 0 }));
    expect(quote.previousClose).toBeNull();
    expect(quote.change).toBeNull();
    expect(quote.changePercent).toBeNull();
    // The price itself is still perfectly good and must survive.
    expect(priceToRupees(quote.price)).toBeCloseTo(900, 4);
    expect(formatPercent(quote.changePercent, { signed: true })).toBe("--");
  });

  it("does not invent an open or a day range in LTPC mode", () => {
    // The feed subscribes in LTPC mode, which carries no OHLC at all. `open`
    // was being filled with the previous close and the range with the last
    // price, which showed as a real session open and a zero-width day range.
    const quote = tickToQuote(tick({ ltp: 900, cp: 880 }));
    expect(quote.open).toBeNull();
    expect(quote.dayHigh).toBeNull();
    expect(quote.dayLow).toBeNull();
  });

  it("does not invent volume it was not sent", () => {
    // LTPC mode carries no cumulative volume. Zero is the honest answer; a
    // plausible-looking number would be fabrication.
    const quote = tickToQuote(tick());
    expect(quote.volume).toBe(0);
    expect(quote.averageVolume).toBe(0);
  });

  it("preserves sub-rupee precision across the integer conversion", () => {
    for (const ltp of [0.05, 12.34, 999.99, 1_234.56, 78_900.01]) {
      expect(priceToRupees(tickToQuote(tick({ ltp, cp: ltp })).price), String(ltp)).toBeCloseTo(
        ltp,
        4,
      );
    }
  });
});

describe("the feed's gates", () => {
  it("reports a missing token instead of attempting a connection", () => {
    // No UPSTOX_ACCESS_TOKEN is set in the test environment.
    const status = upstoxFeed.ensure(["NSE:RELIANCE"]);
    expect(status.state).toBe("no-token");
    expect(status.subscribed).toBe(0);
  });

  it("has no price for anything it has never received a tick for", () => {
    // The alternative — a placeholder or a simulated value — would be a
    // fabricated market print.
    expect(upstoxFeed.latest("NSE:RELIANCE")).toBeNull();
    expect(upstoxFeed.snapshot()).toHaveLength(0);
  });

  it("exposes only these five fields, so a credential cannot ride along", () => {
    // This object is what the SSE route serialises to the browser. Pinning the
    // key set means a field added to the feed's internals cannot reach the
    // client without this test failing first.
    expect(Object.keys(upstoxFeed.getStatus()).sort()).toEqual([
      "detail",
      "lastTickAt",
      "receiving",
      "state",
      "subscribed",
    ]);
  });

  it("does not claim to be receiving before any tick has been decoded", () => {
    /*
      The distinction the UI depends on. A socket can be open and subscribed and
      still deliver nothing — a wrong key or a schema mismatch look exactly like
      health from the outside — so LIVE is gated on this rather than on the
      connection existing.
    */
    expect(upstoxFeed.getStatus().receiving).toBe(false);
    expect(upstoxFeed.tickingCount()).toBe(0);
  });

  it("carries nothing resembling a bearer token in its values", () => {
    // Upstox tokens are long opaque strings; the status' values are a short
    // enum, a sentence, a count and a timestamp.
    for (const value of Object.values(upstoxFeed.getStatus())) {
      if (typeof value !== "string") continue;
      expect(value).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    }
  });
});
