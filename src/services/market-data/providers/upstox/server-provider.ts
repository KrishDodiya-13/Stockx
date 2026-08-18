import "server-only";

import type { ConnectionStatus } from "@/domain/connection";
import type {
  Candle,
  Instrument,
  MarketStatus,
  Quote,
  SectorPerformance,
  Tick,
} from "@/domain/market";
import { getMockProvider } from "@/app/api/market-data/_lib/mock-source";
import { marketPhase } from "@/services/market-data/market-hours";
import { fetchCandles, fetchQuotes } from "@/services/market-data/providers/upstox/client";
import { hasLiveFeed, liveInstrumentIds } from "@/services/market-data/providers/upstox/instrument-keys";
import { tickToQuote, upstoxFeed } from "@/services/market-data/providers/upstox/feed";
import { INSTRUMENTS } from "@/services/market-data/universe";
import type { CandleRequest, MarketDataProvider, Unsubscribe } from "@/services/market-data/types";

/**
 * The live provider as it runs *on the server*.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * `LiveMarketDataProvider` is a browser class: it reaches Upstox by fetching
 * this app's own `/api/market-data/*` routes with relative URLs. That is
 * correct in a browser and broken on a server, where a relative URL has no
 * origin to resolve against — Node throws `TypeError: Failed to parse URL`.
 *
 * Because the composition root picked that provider by mode alone, every
 * server route that priced something (orders, portfolio, backtests, replay,
 * the Time Machine) silently received an empty result the moment live mode was
 * switched on. Nothing crashed; the numbers just quietly went to zero.
 *
 * So the server gets its own provider. It calls the feed and the Upstox client
 * directly — no HTTP hop back into itself, no relative URL to resolve.
 *
 * ── What it will not do ────────────────────────────────────────────────────
 *
 * It never falls back to the simulator for a price. A missing quote stays
 * missing, because an order filled at an invented price is worse than an order
 * that could not be priced. Instrument reference data is a different matter —
 * that comes from this app's own registry, which is neither simulated nor
 * vendor-supplied.
 */
export class UpstoxServerProvider implements MarketDataProvider {
  readonly name = "upstox-server";
  readonly source = "live" as const;

  private connection: ConnectionStatus = {
    state: "idle",
    detail: "Live feed not started.",
    lastMessageAt: null,
    retryCount: 0,
  };

  private readonly connectionListeners = new Set<(status: ConnectionStatus) => void>();

  // --- reference data -------------------------------------------------------

  /*
    The instrument master is this app's own registry, not a vendor feed. It is
    static reference data — symbol, name, sector — and carries no price, so
    serving it in live mode mislabels nothing.
  */
  async listInstruments(): Promise<readonly Instrument[]> {
    return INSTRUMENTS;
  }

  async searchInstruments(query: string, limit = 12): Promise<readonly Instrument[]> {
    return getMockProvider().searchInstruments(query, limit);
  }

  // --- prices ---------------------------------------------------------------

  async getQuote(instrumentId: string): Promise<Quote | null> {
    const quotes = await this.getQuotes([instrumentId]);
    return quotes[0] ?? null;
  }

  /**
   * Live quotes, feed-first.
   *
   * The websocket cache holds the freshest print. Anything it has not seen —
   * an instrument that has not traded yet, or a cold server outside market
   * hours — falls back to Upstox's REST quote endpoint.
   */
  async getQuotes(instrumentIds: readonly string[]): Promise<readonly Quote[]> {
    if (instrumentIds.length === 0) return [];

    this.ensureFeed();

    const resolved = new Map<string, Quote>();
    for (const id of instrumentIds) {
      const tick = upstoxFeed.latest(id);
      if (tick) resolved.set(id, tickToQuote(tick));
    }

    const missing = instrumentIds.filter((id) => !resolved.has(id));
    if (missing.length > 0) {
      try {
        for (const quote of await fetchQuotes(missing)) resolved.set(quote.instrumentId, quote);
      } catch {
        /*
          Upstox is unreachable or the token has expired. The instruments stay
          unpriced and the caller renders its empty state — the app keeps
          working, it just cannot quote. Deliberately not logged per call: a
          dashboard poll would emit this dozens of times a minute, and the
          connection status already carries the same information once.
        */
        this.setConnection({
          state: "offline",
          detail: "Upstox is unreachable — live prices are unavailable.",
          lastMessageAt: this.connection.lastMessageAt,
          retryCount: this.connection.retryCount + 1,
        });
      }
    }

    return instrumentIds
      .map((id) => resolved.get(id))
      .filter((quote): quote is Quote => quote !== undefined);
  }

  async getCandles(request: CandleRequest): Promise<readonly Candle[]> {
    try {
      const candles = await fetchCandles(
        request.instrumentId,
        request.interval,
        request.from,
        request.to,
      );
      // The Time Machine's no-future-prices guarantee must not depend on a
      // vendor honouring its own `to` bound.
      return candles.filter((candle) => candle.time <= request.to);
    } catch {
      return [];
    }
  }

  /*
    Sector performance needs a market-cap-weighted roll-up of every
    constituent, which the live feed does not carry. Rather than weight a
    handful of subscribed symbols and present the result as the sector's real
    move, this returns nothing and the heatmap shows its empty state.
  */
  async getSectorPerformance(): Promise<readonly SectorPerformance[]> {
    return [];
  }

  async getMarketStatus(): Promise<MarketStatus> {
    return { phase: marketPhase(new Date()), timestamp: Date.now(), source: this.source };
  }

  // --- streaming ------------------------------------------------------------

  /**
   * Server-side subscription, straight off the feed.
   *
   * Used by the strategy runner, which evaluates conditions in-process and
   * would otherwise have no way to see a price move.
   */
  subscribe(instrumentIds: readonly string[], onTick: (tick: Tick) => void): Unsubscribe {
    const wanted = new Set(instrumentIds.filter(hasLiveFeed));
    this.ensureFeed();

    return upstoxFeed.onTick((tick) => {
      if (!wanted.has(tick.instrumentId)) return;
      const quote = tickToQuote(tick);
      onTick({
        instrumentId: tick.instrumentId,
        price: quote.price,
        volume: quote.volume,
        timestamp: quote.timestamp,
        source: "live",
        previousClose: quote.previousClose,
      });
    });
  }

  /**
   * Bring the feed up, never letting it throw into a request.
   *
   * A route handler asking for a price must not 500 because a vendor socket is
   * down. Every failure here becomes a connection status instead.
   */
  private ensureFeed(): void {
    try {
      const status = upstoxFeed.ensure(liveInstrumentIds());
      this.setConnection({
        state:
          status.state === "live"
            ? "connected"
            : status.state === "connecting"
              ? "connecting"
              : status.state === "reconnecting"
                ? "reconnecting"
                : status.state === "idle"
                  ? "idle"
                  : "offline",
        detail: status.detail,
        lastMessageAt: status.lastTickAt,
        retryCount: this.connection.retryCount,
      });
    } catch {
      this.setConnection({
        state: "offline",
        detail: "Live feed unavailable.",
        lastMessageAt: this.connection.lastMessageAt,
        retryCount: this.connection.retryCount + 1,
      });
    }
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connection;
  }

  onConnectionChange(listener: (status: ConnectionStatus) => void): Unsubscribe {
    this.connectionListeners.add(listener);
    listener(this.connection);
    return () => this.connectionListeners.delete(listener);
  }

  private setConnection(status: ConnectionStatus): void {
    this.connection = status;
    for (const listener of this.connectionListeners) listener(status);
  }

  /*
    The feed is a process-wide singleton with its own shutdown handling, so a
    provider going away must not close it — another request is still using it.
  */
  dispose(): void {
    this.connectionListeners.clear();
  }
}
