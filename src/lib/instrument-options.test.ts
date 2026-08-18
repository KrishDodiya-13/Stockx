import { describe, expect, it } from "vitest";

import {
  ALL_INSTRUMENT_OPTIONS,
  EQUITY_OPTIONS,
  INSTRUMENT_SEARCH_PLACEHOLDER,
} from "@/lib/instrument-options";
import { INSTRUMENTS } from "@/services/market-data";

/**
 * The options every instrument picker renders.
 *
 * Mirrors the filter the dropdown applies, so the three search cases the
 * feature was asked for — symbol, company name and BSE code — are asserted
 * against the real registry rather than a fixture that could drift from it.
 */
function matches(option: (typeof EQUITY_OPTIONS)[number], query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;

  return [option.label, option.hint ?? "", ...(option.keywords ?? [])].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

function search(query: string) {
  return EQUITY_OPTIONS.filter((option) => matches(option, query));
}

describe("instrument options", () => {
  it("derives from the shared registry, not a private list", () => {
    expect(EQUITY_OPTIONS).toHaveLength(INSTRUMENTS.filter((i) => i.kind === "equity").length);
    expect(ALL_INSTRUMENT_OPTIONS).toHaveLength(INSTRUMENTS.length);
  });

  it("carries the whole universe, well past the original forty", () => {
    expect(EQUITY_OPTIONS.length).toBeGreaterThan(40);
  });

  it("shows the symbol as the label and the company as the hint", () => {
    const reliance = EQUITY_OPTIONS.find((option) => option.label === "RELIANCE");
    expect(reliance?.hint).toBe("Reliance Industries");
    expect(reliance?.value).toBe("NSE:RELIANCE");
  });

  it("includes indices only in the all-instruments list", () => {
    expect(ALL_INSTRUMENT_OPTIONS.some((o) => o.label === "NIFTY50")).toBe(true);
    expect(EQUITY_OPTIONS.some((o) => o.label === "NIFTY50")).toBe(false);
  });

  it("names all three searchable fields in the placeholder", () => {
    expect(INSTRUMENT_SEARCH_PLACEHOLDER).toMatch(/symbol/i);
    expect(INSTRUMENT_SEARCH_PLACEHOLDER).toMatch(/company/i);
    expect(INSTRUMENT_SEARCH_PLACEHOLDER).toMatch(/BSE/i);
  });
});

describe("searching for Sudarshan Chemical", () => {
  const isSudarshan = (o: { label: string }) => o.label === "SUDARSCHEM";

  it("finds it by NSE symbol", () => {
    expect(search("SUDARSCHEM").some(isSudarshan)).toBe(true);
  });

  it("finds it by a partial company name", () => {
    expect(search("Sudarshan").some(isSudarshan)).toBe(true);
  });

  it("finds it by the full company name", () => {
    expect(search("Sudarshan Chemical Industries").some(isSudarshan)).toBe(true);
  });

  it("finds it by BSE scrip code", () => {
    const hits = search("506655");
    expect(hits.some(isSudarshan)).toBe(true);
    // The code is specific enough to identify one instrument.
    expect(hits).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    for (const query of ["sudarschem", "SUDARSCHEM", "sUdArScHeM", "sudarshan"]) {
      expect(search(query).some(isSudarshan), query).toBe(true);
    }
  });

  it("does not display the BSE code, only searches by it", () => {
    const sudarshan = EQUITY_OPTIONS.find(isSudarshan)!;
    expect(sudarshan.label).toBe("SUDARSCHEM");
    expect(sudarshan.hint).toBe("Sudarshan Chemical Industries");
    expect(sudarshan.keywords).toContain("506655");
  });
});

describe("search behaviour in general", () => {
  it("matches on a company name that differs from the symbol", () => {
    // The case that makes name search worth having.
    const hits = search("Larsen");
    expect(hits.some((o) => o.label === "LT")).toBe(true);
  });

  it("narrows as the query lengthens", () => {
    const broad = search("ta").length;
    const narrow = search("tata").length;
    expect(narrow).toBeLessThanOrEqual(broad);
    expect(narrow).toBeGreaterThan(0);
  });

  it("returns everything for an empty query", () => {
    expect(search("")).toHaveLength(EQUITY_OPTIONS.length);
    expect(search("   ")).toHaveLength(EQUITY_OPTIONS.length);
  });

  it("returns nothing for a query that matches no instrument", () => {
    // What puts the dropdown into its "No instruments found" state.
    expect(search("zzzzzznotathing")).toHaveLength(0);
  });

  it("does not match a BSE code against an instrument that has none", () => {
    const withoutCode = EQUITY_OPTIONS.filter((o) => !o.keywords);
    expect(withoutCode.length).toBeGreaterThan(0);
    expect(withoutCode.some((o) => matches(o, "506655"))).toBe(false);
  });
});
