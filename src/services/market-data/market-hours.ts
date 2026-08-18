import type { MarketPhase } from "@/domain/market";

/**
 * NSE session hours, in the exchange's own timezone.
 *
 * One definition, used by the simulator's tick loop, the session-phase badge
 * and the candle window alike. Before this existed the phase badge did its own
 * UTC-offset arithmetic and the price generator did no check at all, which is
 * how the market could read CLOSED while prices kept moving.
 */

/** Minutes past IST midnight. */
export const PRE_OPEN_MINUTE = 9 * 60; // 09:00
export const SESSION_OPEN_MINUTE = 9 * 60 + 15; // 09:15
export const SESSION_CLOSE_MINUTE = 15 * 60 + 30; // 15:30

/**
 * India observes no daylight saving, so IST is a fixed UTC+05:30. That makes
 * 15:30 IST exactly 10:00 UTC, which is what lets a session boundary be built
 * with plain `Date.UTC` below.
 */
const IST_CLOSE_UTC_HOUR = 10;

const IST_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export interface IstMoment {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  readonly day: number;
  /** 0 = Sunday. */
  readonly weekday: number;
  /** Minutes past IST midnight. */
  readonly minutes: number;
}

/**
 * The wall-clock moment in Kolkata.
 *
 * The weekday is derived from the IST calendar date rather than read as a
 * localised string: a short weekday name varies by locale and would silently
 * stop matching "Sat"/"Sun" if the locale ever changed. A number cannot.
 */
export function istMoment(now: Date = new Date()): IstMoment {
  const parts = IST_FORMATTER.formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const year = read("year");
  const month = read("month");
  const day = read("day");

  // Some engines render midnight as hour 24 under `hour12: false`.
  const hour = read("hour") % 24;
  const minutes = hour * 60 + read("minute");

  // Constructed as UTC purely to read the weekday of that calendar date; the
  // instant itself is not meaningful here.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return { year, month, day, weekday, minutes };
}

function isWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

/**
 * Whether the exchange is currently trading.
 *
 * The single check the price simulator consults before moving anything.
 * Deliberately excludes the pre-open window: quotes are not supposed to tick
 * between 09:00 and 09:15.
 *
 * Trading holidays are not modelled. The simulator has no holiday calendar and
 * inventing one would make it wrong in a more confident way than simply
 * following weekday hours.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  const { weekday, minutes } = istMoment(now);
  if (!isWeekday(weekday)) return false;
  return minutes >= SESSION_OPEN_MINUTE && minutes < SESSION_CLOSE_MINUTE;
}

/** Session phase, for the status badge. */
export function marketPhase(now: Date = new Date()): MarketPhase {
  const { weekday, minutes } = istMoment(now);
  if (!isWeekday(weekday)) return "closed";

  if (minutes >= SESSION_OPEN_MINUTE && minutes < SESSION_CLOSE_MINUTE) return "open";
  if (minutes >= PRE_OPEN_MINUTE && minutes < SESSION_OPEN_MINUTE) return "pre-open";
  return "closed";
}

/** Epoch milliseconds of 15:30 IST on the given IST calendar date. */
function closeInstant(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day, IST_CLOSE_UTC_HOUR, 0, 0, 0);
}

/**
 * When the most recent session ended.
 *
 * Walks back to the previous weekday when today has not closed yet, so a
 * Sunday resolves to Friday's close rather than to a day the market never
 * traded.
 */
export function lastSessionClose(now: Date = new Date()): number {
  const { year, month, day, weekday, minutes } = istMoment(now);

  if (isWeekday(weekday) && minutes >= SESSION_CLOSE_MINUTE) {
    return closeInstant(year, month, day);
  }

  const cursor = new Date(Date.UTC(year, month - 1, day));
  do {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  } while (!isWeekday(cursor.getUTCDay()));

  return closeInstant(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
}

/**
 * The latest instant that may contain market data.
 *
 * `now` while trading, the previous close otherwise. Candle windows are pulled
 * back to this so a chart opened at 20:00 — or on a Sunday — shows the last
 * real session rather than inventing bars for hours the market was shut.
 */
export function marketDataEdge(now: Date = new Date()): number {
  return isMarketOpen(now) ? now.getTime() : lastSessionClose(now);
}
