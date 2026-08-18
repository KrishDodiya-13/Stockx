/**
 * Deterministic pseudo-randomness.
 *
 * The market simulator must be reproducible: the server and the client have to
 * derive the same opening snapshot or React hydration mismatches, and a
 * replayed historical window has to look identical every time it is opened.
 * `Math.random` cannot do either, so everything seeded goes through here.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Standard normal, via Box–Muller. */
  normal(): number;
}

/** 32-bit string hash (FNV-1a), used to turn symbols into seeds. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, good enough for visual simulation. */
export function createRng(seed: number | string): Rng {
  let state = (typeof seed === "string" ? hashString(seed) : seed) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    normal: () => {
      // Guard against log(0).
      const u = Math.max(next(), Number.EPSILON);
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

/** Calendar-day bucket, so a simulated session is stable for its whole day. */
export function dayBucket(timestamp: number = Date.now()): number {
  return Math.floor(timestamp / 86_400_000);
}
