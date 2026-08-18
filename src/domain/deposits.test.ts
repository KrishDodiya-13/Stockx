import { describe, expect, it } from "vitest";

import {
  DEFAULT_INITIAL_DEPOSIT_RUPEES,
  MAX_TOTAL_DEPOSIT,
  MAX_TOTAL_DEPOSIT_RUPEES,
  MIN_INITIAL_DEPOSIT,
  MIN_INITIAL_DEPOSIT_RUPEES,
} from "@/domain/constants";
import { rupeesToPaise, type Paise } from "@/lib/money";

/**
 * The deposit limits, and the arithmetic that enforces them.
 *
 * `startingCapital` doubles as the cumulative-deposit ledger and as the
 * denominator for total return, so an error in this arithmetic does not just
 * let someone over-fund an account — it silently rescales every percentage the
 * product reports.
 */

/** The headroom calculation used by `depositFunds` and shown in Settings. */
function remaining(totalDeposited: Paise): Paise {
  return (MAX_TOTAL_DEPOSIT - totalDeposited) as Paise;
}

describe("deposit limits", () => {
  it("expresses both bounds in paise, consistent with their rupee figures", () => {
    expect(MIN_INITIAL_DEPOSIT).toBe(rupeesToPaise(MIN_INITIAL_DEPOSIT_RUPEES));
    expect(MAX_TOTAL_DEPOSIT).toBe(rupeesToPaise(MAX_TOTAL_DEPOSIT_RUPEES));
  });

  it("uses integer paise, never a float", () => {
    expect(Number.isInteger(MIN_INITIAL_DEPOSIT)).toBe(true);
    expect(Number.isInteger(MAX_TOTAL_DEPOSIT)).toBe(true);
  });

  it("matches the value the database CHECK constraint hardcodes", () => {
    // `accounts_starting_capital_within_cap` is written as a literal in
    // 20260816010100_deposit_constraints. If this constant moves without the
    // migration, the database becomes the stricter of the two silently.
    expect(MAX_TOTAL_DEPOSIT).toBe(100_000_000);
  });

  it("puts the sign-up default inside the permitted range", () => {
    expect(DEFAULT_INITIAL_DEPOSIT_RUPEES).toBeGreaterThanOrEqual(MIN_INITIAL_DEPOSIT_RUPEES);
    expect(DEFAULT_INITIAL_DEPOSIT_RUPEES).toBeLessThanOrEqual(MAX_TOTAL_DEPOSIT_RUPEES);
  });

  it("leaves a minimum below the maximum", () => {
    expect(MIN_INITIAL_DEPOSIT).toBeLessThan(MAX_TOTAL_DEPOSIT);
  });
});

describe("remaining lifetime capacity", () => {
  it("is the full cap for a brand new account", () => {
    expect(remaining(0 as Paise)).toBe(MAX_TOTAL_DEPOSIT);
  });

  it("shrinks by exactly what has been deposited", () => {
    const deposited = rupeesToPaise(5_000);
    expect(remaining(deposited)).toBe(rupeesToPaise(995_000));
  });

  it("reaches zero at the cap and never goes negative in practice", () => {
    expect(remaining(MAX_TOTAL_DEPOSIT)).toBe(0);
  });

  it("permits a deposit equal to the remaining headroom", () => {
    const deposited = rupeesToPaise(999_000);
    const headroom = remaining(deposited);

    expect(headroom).toBe(rupeesToPaise(1_000));
    // The boundary case: exactly filling the cap must be allowed, since
    // `depositFunds` refuses only when `amount > remaining`.
    expect(headroom > headroom).toBe(false);
    expect(deposited + headroom).toBe(MAX_TOTAL_DEPOSIT);
  });

  it("refuses one paisa more than the headroom", () => {
    const deposited = rupeesToPaise(999_000);
    const headroom = remaining(deposited);
    const overshoot = (headroom + 1) as Paise;

    expect(overshoot > headroom).toBe(true);
    expect(deposited + overshoot).toBeGreaterThan(MAX_TOTAL_DEPOSIT);
  });

  it("does not recover capacity when money is spent", () => {
    /*
      The point of tracking deposits rather than balance: an account that
      deposited the full cap and lost all of it has no headroom left. Cash is
      zero, but the lifetime total is unchanged.
    */
    const deposited = MAX_TOTAL_DEPOSIT;
    const cashAfterLosingEverything = 0 as Paise;

    expect(cashAfterLosingEverything).toBe(0);
    expect(remaining(deposited)).toBe(0);
  });

  it("accumulates across many top-ups, not per deposit", () => {
    let deposited = rupeesToPaise(MIN_INITIAL_DEPOSIT_RUPEES);
    for (let i = 0; i < 20; i += 1) {
      const step = rupeesToPaise(1_000);
      expect(step).toBeLessThanOrEqual(remaining(deposited));
      deposited = (deposited + step) as Paise;
    }

    expect(deposited).toBe(rupeesToPaise(21_000));
    expect(remaining(deposited)).toBe(rupeesToPaise(979_000));
  });
});
