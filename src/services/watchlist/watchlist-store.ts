"use client";

/**
 * The watchlist as the browser sees it.
 *
 * ── Why a store rather than React state ────────────────────────────────────
 *
 * A star appears on the stocks table, on the stock detail page, and on the
 * watchlist itself, often at once. A small subscribe/notify store means
 * starring a symbol in one place updates every other immediately, without
 * threading state through unrelated components.
 *
 * ── Server-owned, not browser-owned ────────────────────────────────────────
 *
 * This used to persist to `localStorage`. That made the watchlist a property of
 * the *browser*: two people sharing a machine shared a list, and signing in
 * from a phone showed an empty one. It now mirrors `/api/watchlist`, which is
 * scoped to the signed-in account.
 *
 * Mutations are applied locally first so the star responds on the click, then
 * reconciled with the list the server returns. If the request fails the
 * optimistic change is rolled back, because a star that stays lit for something
 * that was never saved is worse than one that flickers.
 */

export interface WatchlistEntry {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly name: string;
  readonly addedAt: number;
}

type Listener = (state: WatchlistState) => void;

export interface WatchlistState {
  readonly items: readonly WatchlistEntry[];
  readonly ids: readonly string[];
  /** False until the first load resolves, so the UI can hold its skeleton. */
  readonly loaded: boolean;
  readonly error: string | null;
}

const EMPTY: WatchlistState = { items: [], ids: [], loaded: false, error: null };

interface WatchlistResponse {
  readonly watchlist?: readonly WatchlistEntry[];
  readonly message?: string;
}

class WatchlistStore {
  private state: WatchlistState = EMPTY;
  private readonly listeners = new Set<Listener>();
  private loading: Promise<void> | null = null;

  getState(): WatchlistState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    // The first subscriber triggers the load; later ones reuse it.
    void this.load();
    return () => this.listeners.delete(listener);
  }

  /** Fetch the list once. Concurrent callers share the in-flight request. */
  async load(force = false): Promise<void> {
    if (this.state.loaded && !force) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const response = await fetch("/api/watchlist", { cache: "no-store" });
        if (!response.ok) {
          /*
            A signed-out visitor gets 401 here. That is not an error worth
            showing — it just means there is no list yet — so it settles as an
            empty, loaded state rather than a red message.
          */
          this.set({ items: [], ids: [], loaded: true, error: null });
          return;
        }

        const payload = (await response.json()) as WatchlistResponse;
        this.commit(payload.watchlist ?? []);
      } catch {
        this.set({ ...this.state, loaded: true, error: "Could not load your watchlist." });
      } finally {
        this.loading = null;
      }
    })();

    return this.loading;
  }

  has(instrumentId: string): boolean {
    return this.state.ids.includes(instrumentId);
  }

  async add(entry: WatchlistEntry): Promise<boolean> {
    if (this.has(entry.instrumentId)) return true;

    const previous = this.state;
    // Optimistic: newest first, matching the server's ordering.
    this.commit([entry, ...this.state.items]);

    return this.send("POST", entry.instrumentId, previous);
  }

  async remove(instrumentId: string): Promise<boolean> {
    if (!this.has(instrumentId)) return true;

    const previous = this.state;
    this.commit(this.state.items.filter((item) => item.instrumentId !== instrumentId));

    return this.send("DELETE", instrumentId, previous);
  }

  /** Returns whether the instrument is watched after the toggle. */
  async toggle(entry: WatchlistEntry): Promise<boolean> {
    if (this.has(entry.instrumentId)) {
      await this.remove(entry.instrumentId);
      return false;
    }
    await this.add(entry);
    return true;
  }

  private async send(
    method: "POST" | "DELETE",
    instrumentId: string,
    rollbackTo: WatchlistState,
  ): Promise<boolean> {
    try {
      const response = await fetch("/api/watchlist", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrumentId }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as WatchlistResponse;
        this.set({ ...rollbackTo, error: payload.message ?? "Could not update your watchlist." });
        return false;
      }

      // Adopt the server's list rather than trusting the optimistic guess.
      const payload = (await response.json()) as WatchlistResponse;
      this.commit(payload.watchlist ?? []);
      return true;
    } catch {
      this.set({ ...rollbackTo, error: "Could not reach the server." });
      return false;
    }
  }

  private commit(items: readonly WatchlistEntry[]): void {
    this.set({
      items,
      ids: items.map((item) => item.instrumentId),
      loaded: true,
      error: null,
    });
  }

  private set(state: WatchlistState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  /** Drop everything — used on sign-out so the next user starts clean. */
  reset(): void {
    this.set(EMPTY);
  }
}

export const watchlistStore = new WatchlistStore();
