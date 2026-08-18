/**
 * Keyboard shortcut matching.
 *
 * Pure logic, separated from the React binding so the awkward parts —
 * modifiers, chords, and knowing when *not* to fire — can be tested directly.
 *
 * The model is a terminal's: single keys and two-key chords (`g` then `d`)
 * rather than a wall of modifier combinations. Chords keep the shortcut space
 * large without colliding with the browser's own bindings.
 */

export interface ShortcutDefinition {
  readonly id: string;
  /** A single key ("k"), a modifier combo ("mod+k"), or a chord ("g d"). */
  readonly keys: string;
  readonly label: string;
  readonly group: "Navigate" | "Trade" | "General";
}

/** How long a chord's first key stays armed, in milliseconds. */
export const CHORD_TIMEOUT_MS = 1200;

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { id: "palette", keys: "mod+k", label: "Command palette", group: "General" },
  { id: "help", keys: "?", label: "Keyboard shortcuts", group: "General" },
  { id: "search", keys: "/", label: "Search instruments", group: "General" },

  { id: "nav-dashboard", keys: "g d", label: "Dashboard", group: "Navigate" },
  { id: "nav-markets", keys: "g m", label: "Market Pulse", group: "Navigate" },
  { id: "nav-stocks", keys: "g s", label: "Stocks", group: "Navigate" },
  { id: "nav-portfolio", keys: "g p", label: "Portfolio", group: "Navigate" },
  { id: "nav-strategies", keys: "g t", label: "Strategies", group: "Navigate" },
  { id: "nav-risk", keys: "g r", label: "Risk Simulator", group: "Navigate" },
  { id: "nav-backtest", keys: "g b", label: "Backtesting", group: "Navigate" },
  { id: "nav-timemachine", keys: "g h", label: "Time Machine", group: "Navigate" },
  { id: "nav-dna", keys: "g a", label: "Strategy DNA", group: "Navigate" },
  { id: "nav-replay", keys: "g y", label: "Trade Replay", group: "Navigate" },
  { id: "nav-leaderboard", keys: "g l", label: "Leaderboard", group: "Navigate" },

  { id: "buy", keys: "b", label: "Buy", group: "Trade" },
  { id: "sell", keys: "s", label: "Sell", group: "Trade" },
];

/** Routes for the navigation shortcuts, keyed by shortcut id. */
export const SHORTCUT_ROUTES: Record<string, string> = {
  "nav-dashboard": "/dashboard",
  "nav-markets": "/markets",
  "nav-stocks": "/stocks",
  "nav-portfolio": "/portfolio",
  "nav-strategies": "/strategies",
  "nav-risk": "/risk",
  "nav-backtest": "/backtest",
  "nav-timemachine": "/timemachine",
  "nav-dna": "/dna",
  "nav-replay": "/replay",
  "nav-leaderboard": "/leaderboard",
};

export interface KeyEventLike {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Whether a key event should be ignored because the user is typing.
 *
 * The single most important rule in a shortcut system. Without it, typing "s"
 * into a quantity field fires the sell shortcut — which in a trading
 * application is not a cosmetic bug.
 *
 * Modifier combinations are still allowed through: ⌘K should open the palette
 * from anywhere, including from inside a text field.
 */
export function shouldIgnoreTarget(target: EventTarget | null, event: KeyEventLike): boolean {
  if (event.metaKey || event.ctrlKey) return false;

  const element = target as HTMLElement | null;
  if (!element) return false;

  const tag = element.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (element.isContentEditable) return true;
  // A custom control that has taken focus, such as the Select trigger.
  if (element.getAttribute?.("role") === "combobox") return true;

  return false;
}

/** Normalise an event into a comparable token, e.g. "mod+k" or "g". */
export function tokenFor(event: KeyEventLike): string | null {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  // Alt-combinations are left to the operating system.
  if (event.altKey) return null;

  if (event.metaKey || event.ctrlKey) return `mod+${key}`;

  // "?" requires shift on most layouts; treat it as its own token.
  if (key === "?") return "?";
  if (event.shiftKey && key.length === 1) return null;

  return key;
}

export interface ChordState {
  /** The armed prefix, or null when no chord is in progress. */
  readonly prefix: string | null;
  /** When the prefix was armed, for expiry. */
  readonly armedAt: number;
}

export const IDLE_CHORD: ChordState = { prefix: null, armedAt: 0 };

export type MatchResult =
  | { kind: "none" }
  /** A chord prefix was armed; wait for the next key. */
  | { kind: "armed"; state: ChordState }
  | { kind: "match"; id: string };

/**
 * Match a key event against the shortcut table.
 *
 * Chord prefixes are derived from the table rather than hardcoded, so adding
 * `g x` to `SHORTCUTS` needs no change here.
 */
export function matchShortcut(
  event: KeyEventLike,
  chord: ChordState,
  now: number,
  shortcuts: readonly ShortcutDefinition[] = SHORTCUTS,
): MatchResult {
  const token = tokenFor(event);
  if (token === null) return { kind: "none" };

  // Continue an armed chord if it has not expired.
  if (chord.prefix !== null && now - chord.armedAt <= CHORD_TIMEOUT_MS) {
    const combined = `${chord.prefix} ${token}`;
    const hit = shortcuts.find((shortcut) => shortcut.keys === combined);
    return hit ? { kind: "match", id: hit.id } : { kind: "none" };
  }

  const direct = shortcuts.find((shortcut) => shortcut.keys === token);
  if (direct) return { kind: "match", id: direct.id };

  // Arm a prefix only if some chord actually begins with this key.
  const isPrefix = shortcuts.some((shortcut) => shortcut.keys.startsWith(`${token} `));
  if (isPrefix) return { kind: "armed", state: { prefix: token, armedAt: now } };

  return { kind: "none" };
}

/** Render a shortcut for display: "g d" → ["G", "D"], "mod+k" → ["⌘", "K"]. */
export function renderKeys(keys: string, isMac: boolean): string[] {
  if (keys.includes("+")) {
    return keys.split("+").map((part) => (part === "mod" ? (isMac ? "⌘" : "Ctrl") : part.toUpperCase()));
  }
  return keys.split(" ").map((part) => (part.length === 1 ? part.toUpperCase() : part));
}
