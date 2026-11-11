import type { BrainSpec } from '../neuro/brain.ts';
import { defaultGenome, GENE_SPECS, type Genome } from './genome.ts';

/**
 * Species definitions are data, not code. A scenario supplies a base genome plus a
 * brain architecture; everything else (population dynamics, tool use, culture) emerges
 * from those two descriptions.
 */
export interface SpeciesSpec {
  id: string;
  name: string;
  kind: 'human' | 'animal' | 'custom';
  description: string;
  baseGenome?: Partial<Genome>;
  /** Founder variation around the base genome, as a fraction of trait range. */
  genomeSpread?: number;
  brain?: BrainSpec;
  color: string;
  /** Population seeded when a scenario does not specify founders. */
  defaultCount?: number;
  /** Optional explicit trophic role; otherwise derived from diet. */
  role?: 'herbivore' | 'carnivore' | 'omnivore';
}

export interface ResolvedSpecies {
  id: string;
  name: string;
  kind: SpeciesSpec['kind'];
  description: string;
  genome: Genome;
  genomeSpread: number;
  brain: BrainSpec;
  color: string;
  role: 'herbivore' | 'carnivore' | 'omnivore';
  defaultCount: number;
}

export const SPECIES_PRESETS: Record<string, SpeciesSpec> = {
  human: {
    id: 'human',
    name: 'Human',
    kind: 'human',
    description:
      'Tool-using omnivore with a large cortex, long juvenile dependency and high sociality. The reference species.',
    baseGenome: {
      bodyMassKg: 62,
      brainMassKg: 1.35,
      lifespanYears: 72,
      fertility: 4,
      aggression: 0.35,
      curiosity: 0.5,
      sociality: 0.65,
      metabolicEfficiency: 0.5,
      diseaseResistance: 0.45,
      coldToleranceC: 0,
      heatToleranceC: 2,
      learningRate: 0.6,
      diet: 0.3,
    },
    genomeSpread: 0.04,
    brain: { note: 'Vertebrate default: all six regions present.' },
    color: '#f2c14e',
    defaultCount: 80,
    role: 'omnivore',
  },
  grazer: {
    id: 'grazer',
    name: 'Grazer',
    kind: 'animal',
    description: 'Large herd herbivore. Converts grass into meat; the base of the predator food chain.',
    baseGenome: {
      bodyMassKg: 420,
      brainMassKg: 0.45,
      lifespanYears: 18,
      fertility: 2,
      aggression: 0.05,
      curiosity: 0.1,
      sociality: 0.8,
      metabolicEfficiency: 0.75,
      diseaseResistance: 0.35,
      coldToleranceC: 4,
      heatToleranceC: 4,
      learningRate: 0.2,
      diet: 0.02,
    },
    genomeSpread: 0.05,
    brain: { regions: { cortex: { scale: 0.18 }, hippocampus: { scale: 0.7 } }, exploration: 0.15 },
    color: '#b7a27a',
    defaultCount: 120,
    role: 'herbivore',
  },
  predator: {
    id: 'predator',
    name: 'Predator',
    kind: 'animal',
    description: 'Social pack carnivore with acute threat circuitry and a heavy hunt drive.',
    baseGenome: {
      bodyMassKg: 48,
      brainMassKg: 0.35,
      lifespanYears: 16,
      fertility: 4,
      aggression: 0.9,
      curiosity: 0.3,
      sociality: 0.4,
      metabolicEfficiency: 0.8,
      diseaseResistance: 0.4,
      coldToleranceC: 2,
      heatToleranceC: 3,
      learningRate: 0.35,
      diet: 0.97,
    },
    genomeSpread: 0.05,
    brain: { regions: { amygdala: { scale: 1.6 }, cortex: { scale: 0.35 } }, exploration: 0.2 },
    color: '#8c4f4f',
    defaultCount: 40,
    role: 'carnivore',
  },
  'hyper-human': {
    id: 'hyper-human',
    name: 'Hypercognitive hominin',
    kind: 'custom',
    description:
      'A lineage with a greatly enlarged, denser cortex and faster plasticity. Tests whether raw cognition accelerates culture.',
    baseGenome: {
      bodyMassKg: 58,
      brainMassKg: 2.4,
      lifespanYears: 95,
      fertility: 3,
      aggression: 0.25,
      curiosity: 0.9,
      sociality: 0.7,
      metabolicEfficiency: 0.55,
      diseaseResistance: 0.5,
      coldToleranceC: 0,
      heatToleranceC: 3,
      learningRate: 0.85,
      diet: 0.25,
    },
    genomeSpread: 0.03,
    brain: {
      regions: { cortex: { scale: 1.45, efficiency: 1.2 }, hippocampus: { scale: 1.2 }, cerebellum: { scale: 1.1 } },
      plasticity: 1.4,
      note: 'Enlarged cortex, higher neural density, faster learning.',
    },
    color: '#6ee7b7',
    defaultCount: 80,
    role: 'omnivore',
  },
  'medulla-less': {
    id: 'medulla-less',
    name: 'Medulla-less hominin',
    kind: 'custom',
    description:
      'Identical to humans except the medulla is absent and nothing replaces it. Autonomic failure should be rapidly lethal.',
    baseGenome: {
      bodyMassKg: 62,
      brainMassKg: 1.35,
      lifespanYears: 72,
      fertility: 4,
      aggression: 0.35,
      curiosity: 0.5,
      sociality: 0.65,
      metabolicEfficiency: 0.5,
      diseaseResistance: 0.45,
      learningRate: 0.6,
      diet: 0.3,
    },
    genomeSpread: 0.04,
    brain: { regions: { medulla: { present: false } }, note: 'No autonomic control region at all.' },
    color: '#ef4444',
    defaultCount: 80,
    role: 'omnivore',
  },
  'ganglion-race': {
    id: 'ganglion-race',
    name: 'Ganglion hominin',
    kind: 'custom',
    description:
      'A lineage that replaced the medulla with distributed ganglia: autonomic tone without a vertebrate brainstem.',
    baseGenome: {
      bodyMassKg: 62,
      brainMassKg: 1.4,
      lifespanYears: 70,
      fertility: 4,
      aggression: 0.3,
      curiosity: 0.55,
      sociality: 0.65,
      metabolicEfficiency: 0.5,
      diseaseResistance: 0.45,
      learningRate: 0.6,
      diet: 0.3,
    },
    genomeSpread: 0.04,
    brain: {
      regions: { medulla: { present: false }, ganglion: { present: true, scale: 1 } },
      note: 'Distributed ganglia substitute for the medulla.',
    },
    color: '#f59e0b',
    defaultCount: 80,
    role: 'omnivore',
  },
  'heat-adapted': {
    id: 'heat-adapted',
    name: 'Thermophile hominin',
    kind: 'custom',
    description: 'A lineage adapted to a hot, tidally locked world: high heat tolerance and efficient water use.',
    baseGenome: {
      bodyMassKg: 55,
      brainMassKg: 1.2,
      lifespanYears: 55,
      fertility: 4,
      aggression: 0.3,
      curiosity: 0.6,
      sociality: 0.7,
      metabolicEfficiency: 0.65,
      diseaseResistance: 0.4,
      coldToleranceC: -10,
      heatToleranceC: 22,
      learningRate: 0.65,
      diet: 0.25,
    },
    genomeSpread: 0.04,
    brain: {},
    color: '#f97316',
    defaultCount: 60,
    role: 'omnivore',
  },
};

/** Fill in defaults and derive the trophic role. */
export const resolveSpecies = (spec: SpeciesSpec): ResolvedSpecies => {
  const genome = defaultGenome(spec.baseGenome ?? {});
  const role =
    spec.role ??
    (genome.diet > 0.6 ? 'carnivore' : genome.diet < 0.25 ? 'herbivore' : 'omnivore');
  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    description: spec.description,
    genome,
    genomeSpread: spec.genomeSpread ?? 0.04,
    brain: spec.brain ?? {},
    color: spec.color,
    role,
    defaultCount: spec.defaultCount ?? 40,
  };
};

/** Human-readable list of how a species differs from the human baseline. */
export const describeSpecies = (species: ResolvedSpecies): string => {
  const differences: string[] = [];
  const human = defaultGenome(SPECIES_PRESETS.human?.baseGenome ?? {});
  for (const key of Object.keys(GENE_SPECS) as (keyof Genome)[]) {
    const spec = GENE_SPECS[key];
    const difference = species.genome[key] - human[key];
    if (Math.abs(difference) > 0.08 * (spec.max - spec.min)) {
      differences.push(`${spec.label} ${difference > 0 ? '+' : ''}${difference.toFixed(2)} ${spec.unit}`);
    }
  }
  const brainNotes = species.brain.note ? [species.brain.note] : [];
  return [...brainNotes, ...differences].join('; ') || 'Matches the human baseline.';
};
