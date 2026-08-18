/**
 * Motion tokens.
 *
 * One vocabulary of durations and easings for the whole product, so a modal, a
 * page transition and a number tween all feel like the same hand. Components
 * must not invent their own timings — that is what makes an interface feel
 * assembled rather than designed.
 */

/** Seconds. Named by intent, not by number. */
export const DURATION = {
  /** Hover, press, focus — must feel instantaneous. */
  instant: 0.16,
  /** Toggles, tabs, small state changes. */
  quick: 0.28,
  /** Panels, dropdowns, most UI motion. */
  base: 0.42,
  /** Page and section transitions. */
  slow: 0.66,
  /** Editorial reveals; the longest anything should ever take. */
  reveal: 0.95,
} as const;

/**
 * Easings.
 *
 * `exit` is the workhorse: a strong deceleration curve that arrives fast and
 * settles, which reads as responsive. Symmetric easings (`inOut`) are reserved
 * for things that genuinely move both ways.
 */
export const EASE = {
  /** Decelerate hard — for anything entering or responding to input. */
  out: "expo.out",
  /** Gentler deceleration for larger travel. */
  outSoft: "power3.out",
  /** Both ends eased — for elements that traverse the screen. */
  inOut: "power2.inOut",
  /** No easing — for scrubbed, scroll-linked motion. */
  none: "none",
} as const;

/** CSS equivalents, for transitions that live in Tailwind classes. */
export const CSS_EASE = {
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  inOut: "cubic-bezier(0.76, 0, 0.24, 1)",
} as const;

/** Default stagger between siblings in a group reveal. */
export const STAGGER = {
  tight: 0.04,
  base: 0.07,
  loose: 0.12,
} as const;

/** Distance in pixels for slide/rise motion. Small — this is not a carousel. */
export const TRAVEL = {
  small: 12,
  base: 24,
  large: 48,
} as const;

/**
 * How long the hero waits before it begins.
 *
 * Equal to the header wordmark's reveal (`DURATION.slow`), so the brand has
 * settled before the badge moves and the sequence reads brand → badge →
 * headline rather than three things arriving at once.
 *
 * It lives here rather than in either component because the two are mounted
 * independently and neither owns the other's timing — a literal in one file
 * would silently drift from the other the first time a duration changed.
 */
export const HERO_BADGE_DELAY = DURATION.slow;
