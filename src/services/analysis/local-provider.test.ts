import { describe, expect, it } from "vitest";

import { rupeesToPaise, rupeesToPrice, type Paise } from "@/lib/money";
import { BANNED_PHRASING, containsBannedPhrasing } from "@/services/analysis/llm-provider";
import { LocalAnalysisProvider } from "@/services/analysis/local-provider";
import type { TradeFacts, TradeReview } from "@/services/analysis/trade-analysis";

const provider = new LocalAnalysisProvider();

function facts(overrides: Partial<TradeFacts> = {}): TradeFacts {
  return {
    symbol: "RELIANCE",
    quantity: 100,
    entryPrice: rupeesToPrice(100),
    exitPrice: rupeesToPrice(110),
    realisedPnl: rupeesToPaise(1000),
    realisedPnlPercent: 10,
    holdMs: 2 * 3_600_000,
    cost: rupeesToPaise(10_000),
    exposurePercent: 10,
    maxFavourable: rupeesToPaise(1500),
    maxAdverse: rupeesToPaise(-200),
    captureRatio: 66.7,
    marketMovePercent: 8,
    postExitMovePercent: 1,
    automated: false,
    barsHeld: 24,
    ...overrides,
  };
}

function allText(review: TradeReview): string {
  return [
    review.headline,
    ...review.wentWell,
    ...review.couldImprove,
    ...review.riskObservations,
    ...review.behaviouralObservations,
  ].join(" ");
}

describe("determinism", () => {
  it("produces identical output for identical input", async () => {
    /*
      The reason the local provider is the default: a user returning to a trade
      finds the same reading, and the output can be tested exactly.
    */
    const a = await provider.analyse(facts());
    const b = await provider.analyse(facts());

    expect(a).toEqual(b);
  });

  it("changes when the trade changes", async () => {
    const win = await provider.analyse(facts({ realisedPnl: rupeesToPaise(1000) }));
    const loss = await provider.analyse(facts({ realisedPnl: rupeesToPaise(-1000) }));

    expect(win.headline).not.toBe(loss.headline);
  });
});

describe("language guarantees", () => {
  it("never predicts, guarantees or instructs — across many trade shapes", async () => {
    /*
      Swept across the full space of outcomes rather than one example, because
      a banned phrase is most likely to slip into a branch that a single happy
      -path test never reaches.
    */
    const shapes: Partial<TradeFacts>[] = [
      {},
      { realisedPnl: rupeesToPaise(-5000), captureRatio: null, maxFavourable: 0 as Paise },
      { captureRatio: 10, maxFavourable: rupeesToPaise(9000) },
      { exposurePercent: 80, cost: rupeesToPaise(800_000) },
      { maxAdverse: rupeesToPaise(-9000) },
      { postExitMovePercent: 12 },
      { postExitMovePercent: -12 },
      { automated: true },
      { holdMs: 30_000, realisedPnl: rupeesToPaise(-200) },
      { marketMovePercent: -15, realisedPnl: rupeesToPaise(3000) },
      { exitPrice: null, realisedPnl: 0 as Paise },
    ];

    for (const shape of shapes) {
      const review = await provider.analyse(facts(shape));
      expect(allText(review)).not.toMatch(BANNED_PHRASING);
      expect(containsBannedPhrasing(review)).toBe(false);
    }
  });

  it("always attaches the disclaimer", async () => {
    const review = await provider.analyse(facts());
    expect(review.disclaimer).toMatch(/not financial advice/i);
    expect(review.disclaimer).toMatch(/not a prediction/i);
  });

  it("labels its own source", async () => {
    expect((await provider.analyse(facts())).source).toBe("local");
  });
});

describe("grounding", () => {
  it("quotes the numbers it was given rather than inventing any", async () => {
    const review = await provider.analyse(
      facts({ quantity: 250, symbol: "TCS", realisedPnl: rupeesToPaise(4321) }),
    );

    const text = allText(review);
    expect(text).toContain("250");
    expect(text).toContain("TCS");
    expect(text).toContain("4,321");
  });

  it("reports the share of the available move that was captured", async () => {
    const review = await provider.analyse(
      facts({ captureRatio: 20, maxFavourable: rupeesToPaise(5000), realisedPnl: rupeesToPaise(1000) }),
    );

    expect(review.couldImprove.join(" ")).toMatch(/20% of the move available/);
  });

  it("notes when a position was in profit before closing at a loss", async () => {
    const review = await provider.analyse(
      facts({ realisedPnl: rupeesToPaise(-800), maxFavourable: rupeesToPaise(2000), captureRatio: null }),
    );

    expect(review.couldImprove.join(" ")).toMatch(/in profit by as much as/i);
  });

  it("flags a concentrated position", async () => {
    const review = await provider.analyse(facts({ exposurePercent: 60 }));
    expect(review.riskObservations.join(" ")).toMatch(/concentrated/i);
  });

  it("credits a gain made while the instrument fell", async () => {
    const review = await provider.analyse(
      facts({ realisedPnl: rupeesToPaise(2000), marketMovePercent: -6 }),
    );
    expect(review.wentWell.join(" ")).toMatch(/while RELIANCE fell/i);
  });

  it("distinguishes automated from manual fills", async () => {
    const auto = await provider.analyse(facts({ automated: true }));
    const manual = await provider.analyse(facts({ automated: false }));

    expect(auto.behaviouralObservations.join(" ")).toMatch(/automated strategy/i);
    expect(manual.behaviouralObservations.join(" ")).toMatch(/placed manually/i);
  });
});

describe("completeness", () => {
  it("never leaves a section empty", async () => {
    const shapes: Partial<TradeFacts>[] = [
      {},
      { realisedPnl: 0 as Paise, maxFavourable: 0 as Paise, maxAdverse: 0 as Paise, captureRatio: null },
      { captureRatio: null, maxFavourable: 0 as Paise },
    ];

    for (const shape of shapes) {
      const review = await provider.analyse(facts(shape));

      // An empty section would read as a missing feature rather than a finding.
      expect(review.wentWell.length).toBeGreaterThan(0);
      expect(review.couldImprove.length).toBeGreaterThan(0);
      expect(review.riskObservations.length).toBeGreaterThan(0);
      expect(review.behaviouralObservations.length).toBeGreaterThan(0);
      expect(review.headline.length).toBeGreaterThan(0);
    }
  });

  it("handles a trade with no exit price without throwing", async () => {
    const review = await provider.analyse(facts({ exitPrice: null }));
    expect(review.headline).toBeTruthy();
  });
});

describe("banned-phrasing filter", () => {
  it("catches predictions and guarantees in model output", () => {
    const bad: TradeReview = {
      source: "model",
      headline: "This stock will rise next week.",
      wentWell: [],
      couldImprove: [],
      riskObservations: [],
      behaviouralObservations: [],
      disclaimer: "",
    };

    expect(containsBannedPhrasing(bad)).toBe(true);
  });

  it("catches advice phrased as instruction", () => {
    const bad: TradeReview = {
      source: "model",
      headline: "",
      wentWell: [],
      couldImprove: ["You should hold winners longer."],
      riskObservations: [],
      behaviouralObservations: [],
      disclaimer: "",
    };

    expect(containsBannedPhrasing(bad)).toBe(true);
  });

  it("passes a purely descriptive review", () => {
    const good: TradeReview = {
      source: "model",
      headline: "The position closed for a gain of ₹1,000.",
      wentWell: ["The exit captured 66% of the available move."],
      couldImprove: ["Price rose a further 2% after the exit."],
      riskObservations: ["The position was 10% of capital."],
      behaviouralObservations: ["Held for 2 hours."],
      disclaimer: "",
    };

    expect(containsBannedPhrasing(good)).toBe(false);
  });
});
