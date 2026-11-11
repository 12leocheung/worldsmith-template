/**
 * Deterministic pseudo-random numbers.
 *
 * One `Rng` is never shared across systems. Instead each subsystem derives its own
 * stream with `fork(label)`, so adding a new system or changing how often an existing
 * one draws numbers does not perturb unrelated parts of the simulation. This is the
 * property that makes experiments comparable: a brain mutation experiment and its
 * baseline see identical terrain, climate and starting population.
 *
 * Algorithm: mulberry32 for the stream, splitmix32 for seed derivation.
 */

const hashString = (text: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

const mix32 = (seed: number): number => {
  let z = (seed + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
};

export type Seed = number | string;

export class Rng {
  readonly label: string;
  /** Original seed used to derive independent streams. */
  readonly seed: number;
  #state: number;
  #spareNormal: number | null = null;

  constructor(seed: Seed, label = 'root') {
    this.label = label;
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.#state = mix32(this.seed);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  float(min = 0, max = 1): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, maxExclusive). */
  int(min: number, maxExclusive: number): number {
    if (maxExclusive <= min) return Math.floor(min);
    return min + Math.floor(this.next() * (maxExclusive - min));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick called with an empty collection');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Standard normal via Box-Muller, cached spare value included. */
  normal(meanValue = 0, sd = 1): number {
    if (this.#spareNormal !== null) {
      const spare = this.#spareNormal;
      this.#spareNormal = null;
      return meanValue + sd * spare;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    this.#spareNormal = magnitude * Math.sin(angle);
    return meanValue + sd * magnitude * Math.cos(angle);
  }

  /** Positive, right-skewed value with the given median. */
  logNormal(medianValue: number, sigma = 0.35): number {
    return medianValue * Math.exp(sigma * this.normal(0, 1));
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle([...items]).slice(0, Math.max(0, Math.min(count, items.length)));
  }

  /** Choose an index from parallel weights; returns -1 when all weights are non-positive. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return -1;
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= Math.max(0, weights[i] as number);
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  /**
   * Derive an independent stream. Forking from the original seed (not the current
   * state) keeps streams stable no matter how many numbers another stream consumed.
   */
  fork(label: string): Rng {
    return new Rng(mix32(this.seed ^ hashString(label)), `${this.label}/${label}`);
  }
}

/** Convenience: one-off deterministic draw without keeping the generator. */
export const seededPick = <T>(seed: Seed, label: string, items: readonly T[]): T =>
  new Rng(seed, label).pick(items);
