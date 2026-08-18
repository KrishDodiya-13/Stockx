import { describe, expect, it } from "vitest";

import {
  isMarketOpen,
  istMoment,
  lastSessionClose,
  marketDataEdge,
  marketPhase,
} from "@/services/market-data/market-hours";

/**
 * IST is UTC+05:30 with no daylight saving, so an IST wall-clock time maps to
 * exactly one UTC instant. These helpers build the instant from the IST time we
 * mean, which keeps each case readable as the time a trader would see.
 */
function ist(date: string, hour: number, minute: number): Date {
  const midnightUtc = new Date(`${date}T00:00:00.000Z`).getTime();
  return new Date(midnightUtc + (hour - 5) * 3_600_000 + (minute - 30) * 60_000);
}

// 2026-08-17 is a Monday, so the week runs Mon 17th … Sun 23rd, and the
// following Monday is the 24th.
const MONDAY = "2026-08-17";
const FRIDAY = "2026-08-21";
const SATURDAY = "2026-08-22";
const SUNDAY = "2026-08-23";
const NEXT_MONDAY = "2026-08-24";

describe("istMoment", () => {
  it("reads the Kolkata wall clock, not the host's", () => {
    // 04:00 UTC is 09:30 IST the same day.
    const moment = istMoment(new Date("2026-08-17T04:00:00.000Z"));
    expect(moment.minutes).toBe(9 * 60 + 30);
    expect(moment.weekday).toBe(1); // Monday
  });

  it("rolls to the next IST day after 18:30 UTC", () => {
    // 20:00 UTC Monday is 01:30 IST Tuesday.
    const moment = istMoment(new Date("2026-08-17T20:00:00.000Z"));
    expect(moment.weekday).toBe(2);
    expect(moment.minutes).toBe(90);
  });
});

describe("isMarketOpen — the boundary cases", () => {
  it("09:14 IST is CLOSED", () => {
    expect(isMarketOpen(ist(MONDAY, 9, 14))).toBe(false);
  });

  it("09:15 IST is OPEN", () => {
    expect(isMarketOpen(ist(MONDAY, 9, 15))).toBe(true);
  });

  it("15:29 IST is OPEN", () => {
    expect(isMarketOpen(ist(MONDAY, 15, 29))).toBe(true);
  });

  it("15:30 IST is CLOSED", () => {
    expect(isMarketOpen(ist(MONDAY, 15, 30))).toBe(false);
  });

  it("16:00 IST is CLOSED", () => {
    expect(isMarketOpen(ist(MONDAY, 16, 0))).toBe(false);
  });

  it("Saturday is CLOSED, even at midday", () => {
    expect(isMarketOpen(ist(SATURDAY, 12, 0))).toBe(false);
  });

  it("Sunday is CLOSED, even at midday", () => {
    expect(isMarketOpen(ist(SUNDAY, 12, 0))).toBe(false);
  });

  it("is closed overnight", () => {
    expect(isMarketOpen(ist(MONDAY, 3, 0))).toBe(false);
    expect(isMarketOpen(ist(MONDAY, 23, 59))).toBe(false);
  });

  it("is open across the whole session", () => {
    for (const [h, m] of [[9, 15], [10, 0], [12, 30], [14, 45], [15, 29]] as const) {
      expect(isMarketOpen(ist(MONDAY, h, m))).toBe(true);
    }
  });
});

describe("marketPhase", () => {
  it("reports pre-open between 09:00 and 09:15", () => {
    expect(marketPhase(ist(MONDAY, 9, 0))).toBe("pre-open");
    expect(marketPhase(ist(MONDAY, 9, 14))).toBe("pre-open");
  });

  it("reports open during the session and closed after it", () => {
    expect(marketPhase(ist(MONDAY, 9, 15))).toBe("open");
    expect(marketPhase(ist(MONDAY, 15, 29))).toBe("open");
    expect(marketPhase(ist(MONDAY, 15, 30))).toBe("closed");
  });

  it("never reports pre-open at the weekend", () => {
    expect(marketPhase(ist(SATURDAY, 9, 5))).toBe("closed");
    expect(marketPhase(ist(SUNDAY, 9, 5))).toBe("closed");
  });

  /*
    The property the bug came down to: the badge and the price simulator must
    never disagree. Anything the phase calls "open" must be a moment the
    simulator is willing to tick, and vice versa.
  */
  it("agrees with isMarketOpen at every minute of a trading day", () => {
    for (let minute = 0; minute < 1440; minute += 1) {
      const at = ist(MONDAY, Math.floor(minute / 60), minute % 60);
      expect(marketPhase(at) === "open").toBe(isMarketOpen(at));
    }
  });
});

describe("lastSessionClose", () => {
  it("is today's close once the session has ended", () => {
    const close = lastSessionClose(ist(MONDAY, 16, 0));
    expect(new Date(close).toISOString()).toBe("2026-08-17T10:00:00.000Z"); // 15:30 IST
  });

  it("is the previous weekday's close before today's open", () => {
    const close = lastSessionClose(ist(MONDAY, 8, 0));
    expect(new Date(close).toISOString()).toBe("2026-08-14T10:00:00.000Z"); // Friday
  });

  it("skips the weekend", () => {
    for (const day of [SATURDAY, SUNDAY]) {
      const close = lastSessionClose(ist(day, 12, 0));
      expect(new Date(close).toISOString()).toBe("2026-08-21T10:00:00.000Z"); // Friday
    }
  });

  it("never returns a moment in the future", () => {
    for (const [day, h, m] of [
      [MONDAY, 3, 0], [MONDAY, 9, 20], [MONDAY, 16, 0], [FRIDAY, 20, 0], [SUNDAY, 1, 0],
    ] as const) {
      const at = ist(day, h, m);
      expect(lastSessionClose(at)).toBeLessThanOrEqual(at.getTime());
    }
  });
});

describe("marketDataEdge", () => {
  it("is the present moment while trading", () => {
    const at = ist(MONDAY, 11, 0);
    expect(marketDataEdge(at)).toBe(at.getTime());
  });

  it("holds at the last close once the market shuts", () => {
    const afterClose = ist(MONDAY, 16, 0);
    const laterStill = ist(MONDAY, 22, 0);

    // The edge must not creep forward through the evening — that creep is what
    // let the chart keep growing after 15:30.
    expect(marketDataEdge(afterClose)).toBe(marketDataEdge(laterStill));
  });

  it("holds all weekend at Friday's close", () => {
    expect(marketDataEdge(ist(SATURDAY, 10, 0))).toBe(marketDataEdge(ist(SUNDAY, 20, 0)));
  });

  it("moves again once the next session opens", () => {
    // The requirement that updates resume by themselves: the edge is pinned to
    // Friday's close all weekend, then advances the moment 09:15 arrives.
    const sundayEdge = marketDataEdge(ist(SUNDAY, 20, 0));
    const mondayOpen = ist(NEXT_MONDAY, 9, 15);

    expect(marketDataEdge(mondayOpen)).toBeGreaterThan(sundayEdge);
    expect(isMarketOpen(ist(NEXT_MONDAY, 9, 14))).toBe(false);
    expect(isMarketOpen(mondayOpen)).toBe(true);
  });

  it("is never in the future", () => {
    for (const [day, h, m] of [
      [MONDAY, 9, 14], [MONDAY, 9, 15], [MONDAY, 15, 30], [SATURDAY, 12, 0],
    ] as const) {
      const at = ist(day, h, m);
      expect(marketDataEdge(at)).toBeLessThanOrEqual(at.getTime());
    }
  });
});
