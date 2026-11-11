import { clamp } from '../core/math.ts';
import { Rng } from '../core/rng.ts';

/**
 * A genome is a flat set of quantitative traits. Real genetics is discrete and
 * regulatory; this is a quantitative-genetics abstraction: each trait is a breeding
 * value, offspring inherit the mean of their parents plus mutation, and selection
 * acts on the expressed traits.
 */
export const GENE_KEYS = [
  'bodyMassKg',
  'brainMassKg',
  'lifespanYears',
  'fertility',
  'aggression',
  'curiosity',
  'sociality',
  'metabolicEfficiency',
  'diseaseResistance',
  'coldToleranceC',
  'heatToleranceC',
  'learningRate',
  'diet',
] as const;

export type GeneKey = (typeof GENE_KEYS)[number];
export type Genome = Record<GeneKey, number>;

export interface GeneSpec {
  label: string;
  unit: string;
  min: number;
  max: number;
  /** Founder population default. */
  default: number;
  /**
   * Mutation step. For log-scale genes this is a relative standard deviation;
   * for bounded genes it is a fraction of the allowed range.
   */
  mutation: number;
  logScale?: boolean;
  description: string;
}

export const GENE_SPECS: Record<GeneKey, GeneSpec> = {
  bodyMassKg: {
    label: 'Body mass',
    unit: 'kg',
    min: 0.01,
    max: 2000,
    default: 62,
    mutation: 0.03,
    logScale: true,
    description: 'Adult body mass. Sets metabolic demand, offspring cost and combat ability.',
  },
  brainMassKg: {
    label: 'Brain mass',
    unit: 'kg',
    min: 0.001,
    max: 80,
    default: 1.35,
    mutation: 0.035,
    logScale: true,
    description: 'Neural tissue mass. Expensive metabolically; carries cognitive capacity.',
  },
  lifespanYears: {
    label: 'Lifespan',
    unit: 'y',
    min: 1,
    max: 500,
    default: 72,
    mutation: 0.03,
    logScale: true,
    description: 'Characteristic maximum lifespan; mortality accelerates with age.',
  },
  fertility: {
    label: 'Fertility',
    unit: 'offspring',
    min: 1,
    max: 14,
    default: 4,
    mutation: 0.04,
    description: 'Offspring produced per successful reproduction, before mortality.',
  },
  aggression: {
    label: 'Aggression',
    unit: '0-1',
    min: 0,
    max: 1,
    default: 0.35,
    mutation: 0.04,
    description: 'Propensity to hunt and confront threats rather than avoid them.',
  },
  curiosity: {
    label: 'Curiosity',
    unit: '0-1',
    min: 0,
    max: 1,
    default: 0.5,
    mutation: 0.04,
    description: 'Drive to explore and innovate.',
  },
  sociality: {
    label: 'Sociality',
    unit: '0-1',
    min: 0,
    max: 1,
    default: 0.6,
    mutation: 0.04,
    description: 'Propensity to cooperate, teach and live at density.',
  },
  metabolicEfficiency: {
    label: 'Metabolic efficiency',
    unit: '0-1',
    min: 0,
    max: 1,
    default: 0.5,
    mutation: 0.04,
    description: 'How much of ingested energy is usable; reduces basal demand.',
  },
  diseaseResistance: {
    label: 'Disease resistance',
    unit: '0-1',
    min: 0,
    max: 1,
    default: 0.5,
    mutation: 0.04,
    description: 'Resistance to density-dependent infectious disease.',
  },
  coldToleranceC: {
    label: 'Cold tolerance',
    unit: '°C',
    min: -30,
    max: 40,
    default: 0,
    mutation: 0.04,
    description: 'Shift of the comfortable temperature band towards cold.',
  },
  heatToleranceC: {
    label: 'Heat tolerance',
    unit: '°C',
    min: -30,
    max: 40,
    default: 0,
    mutation: 0.04,
    description: 'Shift of the comfortable temperature band towards heat.',
  },
  learningRate: {
    label: 'Learning rate',
    unit: '0-1',
    min: 0,
    max: 1,
    default: 0.5,
    mutation: 0.04,
    description: 'How fast behaviour adapts to reward, and how well knowledge is retained.',
  },
  diet: {
    label: 'Diet',
    unit: '0-1',
    min: 0,
    max: 1,
    default: 0.3,
    mutation: 0.03,
    description: '0 = herbivore, 0.5 = omnivore, 1 = obligate carnivore.',
  },
};

export const defaultGenome = (overrides: Partial<Genome> = {}): Genome => {
  const genome = {} as Genome;
  for (const key of GENE_KEYS) {
    const spec = GENE_SPECS[key];
    genome[key] = clamp(overrides[key] ?? spec.default, spec.min, spec.max);
  }
  return genome;
};

export const clampGene = (key: GeneKey, value: number): number => {
  const spec = GENE_SPECS[key];
  return clamp(value, spec.min, spec.max);
};

export const clampGenome = (genome: Genome): Genome => {
  const result = {} as Genome;
  for (const key of GENE_KEYS) result[key] = clampGene(key, genome[key]);
  return result;
};

export interface MutationOptions {
  /** Multiplier on every gene's mutation step. 0 = perfect inheritance. */
  scale?: number;
}

/** Mutate a genome in place-safe fashion, returning a new genome. */
export const mutateGenome = (genome: Genome, rng: Rng, options: MutationOptions = {}): Genome => {
  const scale = options.scale ?? 1;
  const mutated = {} as Genome;
  for (const key of GENE_KEYS) {
    const spec = GENE_SPECS[key];
    const value = genome[key];
    if (scale <= 0) {
      mutated[key] = value;
      continue;
    }
    const step = spec.logScale
      ? value * Math.exp(rng.normal(0, spec.mutation * scale))
      : value + rng.normal(0, spec.mutation * scale * (spec.max - spec.min));
    mutated[key] = clampGene(key, step);
  }
  // Rare large-effect mutations: a single trait jumps, which is how novelty arrives.
  if (rng.chance(0.01 * scale)) {
    const key = rng.pick(GENE_KEYS);
    const spec = GENE_SPECS[key];
    const jump = spec.logScale
      ? mutated[key] * Math.exp(rng.normal(0, 0.25))
      : mutated[key] + rng.normal(0, 0.2) * (spec.max - spec.min);
    mutated[key] = clampGene(key, jump);
  }
  return mutated;
};

/** Founder variation around a species' base genome, as a fraction of each trait's range. */
export const sampleGenome = (
  base: Genome,
  spread: number,
  rng: Rng,
): Genome => {
  const sampled = {} as Genome;
  for (const key of GENE_KEYS) {
    const spec = GENE_SPECS[key];
    if (spec.logScale) {
      sampled[key] = clampGene(key, base[key] * Math.exp(rng.normal(0, spread)));
    } else {
      sampled[key] = clampGene(key, base[key] + rng.normal(0, spread * (spec.max - spec.min)));
    }
  }
  return sampled;
};

/** Per-gene inheritance from two parents, then mutation. */
export const recombineGenomes = (
  mother: Genome,
  father: Genome,
  rng: Rng,
  options: MutationOptions = {},
): Genome => {
  const child = {} as Genome;
  for (const key of GENE_KEYS) {
    const blended = (mother[key] + father[key]) / 2;
    const spread = Math.abs(mother[key] - father[key]) / 2;
    child[key] = clampGene(key, blended + rng.normal(0, spread * 0.5));
  }
  return mutateGenome(child, rng, options);
};

/** Normalised genetic distance in [0, 1], used for speciation heuristics and reports. */
export const genomeDistance = (a: Genome, b: Genome): number => {
  let total = 0;
  for (const key of GENE_KEYS) {
    const spec = GENE_SPECS[key];
    const range = spec.max - spec.min;
    total += Math.abs(a[key] - b[key]) / range;
  }
  return total / GENE_KEYS.length;
};

/** Mean genome of a group. */
export const meanGenome = (genomes: readonly Genome[]): Genome => {
  const result = {} as Genome;
  for (const key of GENE_KEYS) result[key] = 0;
  if (genomes.length === 0) return defaultGenome();
  for (const genome of genomes) {
    for (const key of GENE_KEYS) result[key] += genome[key] / genomes.length;
  }
  return clampGenome(result);
};

export const describeGenome = (genome: Genome): string =>
  GENE_KEYS.map((key) => {
    const spec = GENE_SPECS[key];
    return `${spec.label}: ${genome[key].toFixed(2)} ${spec.unit}`;
  }).join(', ');
