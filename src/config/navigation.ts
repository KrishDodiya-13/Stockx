/**
 * Navigation model.
 *
 * One definition drives the desktop sidebar, the mobile bottom bar and the
 * command palette — they cannot drift out of sync, and a new surface is added
 * in exactly one place.
 */

export type IconName =
  | "dashboard"
  | "markets"
  | "stocks"
  | "watchlist"
  | "portfolio"
  | "strategies"
  | "risk"
  | "timemachine"
  | "dna"
  | "replay"
  | "leaderboard"
  | "challenges"
  | "settings";

export interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
  /** Shown in the command palette and as the sidebar tooltip. */
  readonly description: string;
  /** Extra terms the palette should match on. */
  readonly keywords?: readonly string[];
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Trade",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: "dashboard",
        description: "Portfolio summary, open positions and market overview",
        keywords: ["home", "overview", "summary"],
      },
      {
        label: "Market Pulse",
        href: "/markets",
        icon: "markets",
        description: "Indices, movers, sector rotation and the market heatmap",
        keywords: ["indices", "nifty", "sensex", "heatmap", "gainers", "losers"],
      },
      {
        label: "Stocks",
        href: "/stocks",
        icon: "stocks",
        description: "Search and analyse individual instruments",
        keywords: ["search", "symbol", "instrument", "watchlist"],
      },
      {
        label: "Watchlist",
        href: "/watchlist",
        icon: "watchlist",
        description: "The instruments you follow, with live prices and quick trading",
        keywords: ["watch", "starred", "following", "favourites", "favorites"],
      },
      {
        label: "Portfolio",
        href: "/portfolio",
        icon: "portfolio",
        description: "Holdings, positions, allocation and realised P&L",
        keywords: ["holdings", "positions", "pnl", "cash", "allocation"],
      },
    ],
  },
  {
    label: "Build",
    items: [
      {
        label: "Strategies",
        href: "/strategies",
        icon: "strategies",
        description: "Build conditional IF/THEN strategies with targets and stops",
        keywords: ["automation", "rules", "conditions", "builder", "backtest"],
      },
      {
        label: "Risk Simulator",
        href: "/risk",
        icon: "risk",
        description: "Size a position and see the loss before you take the trade",
        keywords: ["position size", "stop loss", "reward", "exposure"],
      },
      {
        label: "Backtesting",
        href: "/backtest",
        icon: "replay",
        description: "Replay a strategy over historical data and read its equity curve",
        keywords: ["backtest", "historical", "equity curve", "drawdown", "profit factor"],
      },
      {
        label: "Time Machine",
        href: "/timemachine",
        icon: "timemachine",
        description: "Trade a historical session without seeing what comes next",
        keywords: ["historical", "replay", "simulation", "past", "backtest"],
      },
    ],
  },
  {
    label: "Study",
    items: [
      {
        label: "Strategy DNA",
        href: "/dna",
        icon: "dna",
        description: "A profile of how you actually trade, from your own history",
        keywords: ["profile", "behaviour", "analysis", "style", "momentum"],
      },
      {
        label: "Trade Replay",
        href: "/replay",
        icon: "replay",
        description: "Play any completed trade back against the surrounding price",
        keywords: ["playback", "review", "history"],
      },
      {
        label: "Leaderboard",
        href: "/leaderboard",
        icon: "leaderboard",
        description: "Rankings by risk-adjusted performance and consistency",
        keywords: ["ranking", "compete", "rank"],
      },
      {
        label: "Challenges",
        href: "/challenges",
        icon: "challenges",
        description: "Objectives on return, win rate, drawdown and discipline",
        keywords: ["achievements", "badges", "goals", "objectives"],
      },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: "settings",
  description: "Theme, motion, data source and account preferences",
  keywords: ["preferences", "theme", "dark mode", "appearance"],
};

export const ALL_NAV_ITEMS: readonly NavItem[] = [
  ...NAV_GROUPS.flatMap((group) => group.items),
  SETTINGS_ITEM,
];

/**
 * The mobile bar. Five destinations is the practical ceiling for a thumb, so
 * this is a deliberate subset rather than the full sidebar squeezed down.
 */
export const MOBILE_NAV: readonly NavItem[] = [
  ALL_NAV_ITEMS[0]!, // Dashboard
  ALL_NAV_ITEMS[1]!, // Market Pulse
  ALL_NAV_ITEMS[3]!, // Portfolio
  SETTINGS_ITEM,
];

/** Matches `/portfolio` and `/portfolio/holdings`, but not `/portfolios`. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
