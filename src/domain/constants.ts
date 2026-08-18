import { rupeesToPaise, type Paise } from "@/lib/money";

/**
 * Illustrative capital figure used by the risk simulator and the landing
 * page — not what any real account is funded with. A new account chooses its
 * own initial deposit at sign-up, between `MIN_INITIAL_DEPOSIT` and
 * `MAX_TOTAL_DEPOSIT`.
 */
export const STARTING_CAPITAL: Paise = rupeesToPaise(1_000_000);

/** Smallest deposit a user may open an account with, or add later. */
export const MIN_INITIAL_DEPOSIT_RUPEES = 1_000;
export const MIN_INITIAL_DEPOSIT: Paise = rupeesToPaise(MIN_INITIAL_DEPOSIT_RUPEES);

/**
 * Lifetime cap on virtual capital an account may ever hold, counting the
 * initial deposit and every top-up after it. Not a balance ceiling — spending
 * and re-depositing never resets this, only the amount ever put in does.
 */
export const MAX_TOTAL_DEPOSIT_RUPEES = 1_000_000;
export const MAX_TOTAL_DEPOSIT: Paise = rupeesToPaise(MAX_TOTAL_DEPOSIT_RUPEES);

/** Pre-filled in the sign-up form; the user can change it before submitting. */
export const DEFAULT_INITIAL_DEPOSIT_RUPEES = 100_000;

/** Shown wherever the user could otherwise mistake this for a real brokerage. */
export const VIRTUAL_MONEY_NOTICE =
  "Paper trading only. All positions are simulated with virtual money — no real orders are placed and no real capital is at risk.";

/**
 * The brand.
 *
 * Set as a caps wordmark because that is how it is drawn everywhere it appears
 * — `Wordmark` applies the letter-spacing, never a `text-transform`, so the
 * string that reaches a screen reader, a page title and an OG tag is the same
 * one written here.
 */
export const PRODUCT_NAME = "STOCKX";
export const PRODUCT_TAGLINE = "Trade without risk.";
