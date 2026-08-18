import { describe, expect, it } from "vitest";

import {
  EQUITY_INSTRUMENTS,
  INDEX_IDS,
  INDEX_INSTRUMENTS,
  INSTRUMENTS,
  INSTRUMENT_BY_ID,
  isIndexId,
  isTradable,
} from "@/services/market-data/universe";
import { EQUITY_OPTIONS } from "@/lib/instrument-options";

/**
 * Indices are not equities.
 *
 * SENSEX, NIFTY 50 and NIFTY BANK are levels computed from a basket. They have
 * no shares, no order book and no BSE scrip to settle, so nothing about them
 * belongs in a tradable list. These tests pin the registry-level rule that
 * every trading surface is built on — the stock browser, the pickers, the
 * watchlist and the order route all filter through `EQUITY_INSTRUMENTS` or
 * `isTradable`, so if this holds, none of them can offer a BUY for an index.
 */

const SENSEX = "BSE:SENSEX";
const NIFTY = "NSE:NIFTY50";
const BANKNIFTY = "NSE:BANKNIFTY";

describe("the instrument registry separates indices from equities", () => {
  it("knows the three indices, and only those, as indices", () => {
    expect(INDEX_INSTRUMENTS.map((instrument) => instrument.id)).toEqual([
      NIFTY,
      BANKNIFTY,
      SENSEX,
    ]);
  });

  it("holds no index in the equity list", () => {
    for (const instrument of EQUITY_INSTRUMENTS) {
      expect(instrument.kind, instrument.id).toBe("equity");
    }
    expect(EQUITY_INSTRUMENTS.some((instrument) => instrument.symbol === "SENSEX")).toBe(false);
  });

  it("partitions the registry exactly — nothing is in both lists or neither", () => {
    expect(EQUITY_INSTRUMENTS.length + INDEX_INSTRUMENTS.length).toBe(INSTRUMENTS.length);

    const equityIds = new Set(EQUITY_INSTRUMENTS.map((instrument) => instrument.id));
    for (const id of INDEX_IDS) expect(equityIds.has(id), id).toBe(false);
  });

  it("lists SENSEX on the BSE and the NIFTY indices on the NSE", () => {
    // The exchange is declared per row, not derived from the symbol. Getting
    // this wrong is how an index ends up requested from the wrong segment.
    expect(INSTRUMENT_BY_ID.get(SENSEX)?.exchange).toBe("BSE");
    expect(INSTRUMENT_BY_ID.get(NIFTY)?.exchange).toBe("NSE");
    expect(INSTRUMENT_BY_ID.get(BANKNIFTY)?.exchange).toBe("NSE");
  });

  it("has no NSE listing of SENSEX", () => {
    // `NSE:SENSEX` is the id an exchange-guessing rule would have produced.
    expect(INSTRUMENT_BY_ID.get("NSE:SENSEX")).toBeUndefined();
  });

  it("gives no index a sector, so it cannot be swept into a sector roll-up", () => {
    for (const instrument of INDEX_INSTRUMENTS) {
      expect(instrument.sector, instrument.id).toBeNull();
    }
  });
});

describe("isTradable", () => {
  it("refuses every index", () => {
    for (const id of INDEX_IDS) expect(isTradable(id), id).toBe(false);
  });

  it("accepts every equity", () => {
    for (const instrument of EQUITY_INSTRUMENTS) {
      expect(isTradable(instrument.id), instrument.id).toBe(true);
    }
  });

  it("refuses an instrument that does not exist at all", () => {
    expect(isTradable("NSE:NOT-A-SYMBOL")).toBe(false);
  });
});

describe("isIndexId", () => {
  it("recognises the three indices by their real ids", () => {
    expect(isIndexId(SENSEX)).toBe(true);
    expect(isIndexId(NIFTY)).toBe(true);
    expect(isIndexId(BANKNIFTY)).toBe(true);
  });

  it("does not recognise an index under the wrong exchange", () => {
    expect(isIndexId("NSE:SENSEX")).toBe(false);
  });

  it("does not mistake an equity for an index", () => {
    expect(isIndexId("NSE:RELIANCE")).toBe(false);
  });
});

describe("the pickers that lead to an order", () => {
  it("offer no index", () => {
    const labels = new Set(EQUITY_OPTIONS.map((option) => option.label));

    for (const instrument of INDEX_INSTRUMENTS) {
      expect(labels.has(instrument.symbol), instrument.symbol).toBe(false);
    }
  });

  it("offer every equity", () => {
    expect(EQUITY_OPTIONS).toHaveLength(EQUITY_INSTRUMENTS.length);
  });
});
