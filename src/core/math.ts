/** Small numeric helpers shared by every layer. Keep this file free of simulation concepts. */

export const clamp = (x: number, min: number, max: number): number =>
  x < min ? min : x > max ? max : x;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const invLerp = (a: number, b: number, x: number): number =>
  a === b ? 0 : clamp((x - a) / (b - a), 0, 1);

/** Hermite ease between 0 and 1. */
export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export const deg2rad = (deg: number): number => (deg * Math.PI) / 180;
export const rad2deg = (rad: number): number => (rad * 180) / Math.PI;

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Platform-stable exponentiation.
 *
 * V8 changed the last bits of `Math.pow` for fractional exponents between Node 22
 * and Node 26. That is invisible for a single calculation but enough to send a
 * seeded ecology down a different path. Integer powers use repeated multiplication;
 * fractional powers use `exp(y * log(x))`, whose results agree across those versions.
 */
export const pow = (base: number, exponent: number): number => {
  if (exponent === 0) return 1;
  if (exponent === 1) return base;
  if (Number.isInteger(exponent) && exponent > 1 && exponent <= 8) {
    let result = 1;
    for (let index = 0; index < exponent; index++) result *= base;
    return result;
  }
  if (base === 0) return exponent > 0 ? 0 : Infinity;
  return Math.exp(exponent * Math.log(base));
};

export const sum = (xs: readonly number[]): number => {
  let total = 0;
  for (const x of xs) total += x;
  return total;
};

export const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : sum(xs) / xs.length);

export const variance = (xs: readonly number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) acc += (x - m) * (x - m);
  return acc / (xs.length - 1);
};

export const stdev = (xs: readonly number[]): number => Math.sqrt(variance(xs));

export const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** Round to a number of decimal places (for reports, never for simulation state). */
export const round = (x: number, places = 2): number => {
  const f = 10 ** places;
  return Math.round(x * f) / f;
};

export const safeDiv = (a: number, b: number, fallback = 0): number => (b === 0 ? fallback : a / b);
