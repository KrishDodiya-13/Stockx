/**
 * Model-backed trade review — placeholder.
 *
 * The seam a language model plugs into. Not implemented against any vendor,
 * and deliberately inert: `available` is false unless a key is configured, and
 * the composition root falls back to the local provider, which is fully
 * featured rather than a stub.
 *
 * ── Rules any implementation must keep ─────────────────────────────────────
 *
 *  1. **Server only.** This runs where `serverEnv` is readable. A key must
 *     never reach the browser, so the browser calls `/api/analysis`, and that
 *     route calls the vendor.
 *
 *  2. **Facts in, prose out.** The model receives `TradeFacts` — already
 *     computed — and is asked to describe them. It is never asked to calculate
 *     a P&L, a percentage or a price, because a model that does arithmetic
 *     will eventually do it wrong and state the result confidently.
 *
 *  3. **No prediction, no advice.** The system prompt below forbids forecasts,
 *     recommendations and guarantees. Output is checked against the same banned
 *     phrasing the local provider is tested for, and a response that fails the
 *     check is discarded in favour of the local review rather than shown.
 *
 *  4. **Failure falls back, never fabricates.** Any error returns the local
 *     provider's review. A trade review is never left blank and never invented.
 */

import { serverEnv } from "@/config/env";
import { LocalAnalysisProvider } from "@/services/analysis/local-provider";
import {
  REVIEW_DISCLAIMER,
  type TradeAnalysisProvider,
  type TradeFacts,
  type TradeReview,
} from "@/services/analysis/trade-analysis";

/**
 * Phrasing that must never appear in a generated review.
 *
 * Applied to model output before it is shown. The local provider is tested
 * against the same list.
 */
export const BANNED_PHRASING =
  /\b(will (?:rise|fall|go|continue|reach)|guarantee[ds]?|guaranteed|you should|we recommend|is certain to|risk-free|sure thing|profit is assured)\b/i;

export const SYSTEM_PROMPT = `You review a single completed paper trade for an educational trading simulator.

You are given pre-computed facts. Describe them. Do not calculate anything: every number you mention must be one you were given, quoted as given.

You must not:
- predict future prices or outcomes
- give financial advice, recommendations, or instructions
- guarantee or imply any return
- judge the trader as good or bad

You must:
- describe what happened, using the figures supplied
- note where the numbers show a gap between what was available and what was captured
- stay neutral in tone

One completed trade is a sample of one and is dominated by chance. Never imply a pattern from it.`;

export class LlmAnalysisProvider implements TradeAnalysisProvider {
  readonly name = "model";
  private readonly fallback = new LocalAnalysisProvider();
  private readonly apiKey: string | undefined;

  constructor() {
    // Reading server env here is safe: this class is only ever constructed on
    // the server, by the composition root below.
    this.apiKey = typeof window === "undefined" ? serverEnv.analysisApiKey : undefined;
  }

  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async analyse(facts: TradeFacts): Promise<TradeReview> {
    if (!this.available) return this.fallback.analyse(facts);

    try {
      const generated = await this.requestReview(facts);

      // No vendor wired up yet, or the call produced nothing usable.
      if (!generated) return this.fallback.analyse(facts);

      // Never show output that breaks the phrasing rules; fall back to the
      // deterministic review rather than publish a claim the product does not
      // stand behind.
      if (containsBannedPhrasing(generated)) return this.fallback.analyse(facts);

      return { ...generated, source: "model", disclaimer: REVIEW_DISCLAIMER };
    } catch {
      return this.fallback.analyse(facts);
    }
  }

  /**
   * Call the vendor.
   *
   * Implement against the chosen model here: send `SYSTEM_PROMPT` and `facts`
   * as JSON, parse the response into a `TradeReview`, and return null on
   * anything unexpected. Returning null is always safe — the caller falls back
   * to the complete local review.
   */
  private async requestReview(_facts: TradeFacts): Promise<TradeReview | null> {
    return null;
  }
}

export function containsBannedPhrasing(review: TradeReview): boolean {
  const text = [
    review.headline,
    ...review.wentWell,
    ...review.couldImprove,
    ...review.riskObservations,
    ...review.behaviouralObservations,
  ].join(" ");

  return BANNED_PHRASING.test(text);
}

/**
 * Composition root.
 *
 * Server-side only. Chooses the model provider when a key is configured and
 * the local one otherwise — and the local one is the full experience, so an
 * unconfigured deployment loses nothing but stylistic variety.
 */
export function createAnalysisProvider(): TradeAnalysisProvider {
  const model = new LlmAnalysisProvider();
  return model.available ? model : new LocalAnalysisProvider();
}
