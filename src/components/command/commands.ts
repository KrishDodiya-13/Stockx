import type { IconName } from "@/config/navigation";
import { ALL_NAV_ITEMS } from "@/config/navigation";

export type CommandGroup = "Navigate" | "Trade" | "Build" | "Appearance";

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly group: CommandGroup;
  readonly icon: IconName;
  readonly keywords: readonly string[];
  /** Where this command goes, if it navigates. */
  readonly href?: string;
  /** Named side effect, resolved by the palette. */
  readonly action?: "toggle-theme" | "buy" | "sell";
}

/**
 * The command registry.
 *
 * Navigation commands are derived from the nav config rather than restated, so
 * a new destination appears in the palette automatically.
 */
export const COMMANDS: readonly Command[] = [
  ...ALL_NAV_ITEMS.map<Command>((item) => ({
    id: `nav:${item.href}`,
    label: item.label,
    description: item.description,
    group: "Navigate",
    icon: item.icon,
    keywords: [...(item.keywords ?? []), "open", "go to"],
    href: item.href,
  })),
  {
    id: "action:buy",
    label: "Buy stock",
    description: "Place a paper buy order without leaving the palette",
    group: "Trade",
    icon: "stocks",
    keywords: ["buy", "long", "order", "purchase", "trade"],
    action: "buy",
  },
  {
    id: "action:sell",
    label: "Sell stock",
    description: "Place a paper sell order without leaving the palette",
    group: "Trade",
    icon: "stocks",
    keywords: ["sell", "exit", "close", "order", "trade"],
    action: "sell",
  },
  {
    id: "action:new-strategy",
    label: "Create strategy",
    description: "Start a new conditional IF/THEN strategy",
    group: "Build",
    icon: "strategies",
    keywords: ["new", "strategy", "rule", "automation", "condition"],
    href: "/strategies",
  },
  {
    id: "action:theme",
    label: "Toggle theme",
    description: "Switch between the light and dark surface",
    group: "Appearance",
    icon: "settings",
    keywords: ["dark", "light", "mode", "appearance", "theme"],
    action: "toggle-theme",
  },
];

export const GROUP_ORDER: readonly CommandGroup[] = ["Navigate", "Trade", "Build", "Appearance"];

/**
 * Subsequence match with positional weighting.
 *
 * A prefix hit on the label outranks a hit in the middle, which outranks a
 * keyword-only hit — so typing "port" puts Portfolio first rather than
 * whichever command happens to mention the word.
 */
export function scoreCommand(command: Command, query: string): number {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return 1;

  const label = command.label.toLowerCase();

  if (label === needle) return 1000;
  if (label.startsWith(needle)) return 800 - label.length;
  if (label.includes(needle)) return 600 - label.indexOf(needle);

  for (const keyword of command.keywords) {
    const term = keyword.toLowerCase();
    if (term.startsWith(needle)) return 400;
    if (term.includes(needle)) return 300;
  }

  if (command.description.toLowerCase().includes(needle)) return 200;

  // Fall back to a subsequence match so "tmch" still reaches Time Machine.
  return isSubsequence(needle, label) ? 100 : 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return index === needle.length;
}

export function filterCommands(query: string): readonly Command[] {
  return COMMANDS.map((command) => ({ command, score: scoreCommand(command, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.command);
}
