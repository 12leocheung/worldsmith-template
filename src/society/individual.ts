import { Rng } from '../core/rng.ts';
import {
  clampGene,
  defaultGenome,
  mutateGenome,
  recombineGenomes,
  sampleGenome,
  type Genome,
} from '../bio/genome.ts';
import { energyCapacityKcal, isFertileAge } from '../bio/metabolism.ts';
import type { ResolvedSpecies } from '../bio/species.ts';
import { createBrain, cognitionScore, type Brain } from '../neuro/brain.ts';
import type { ActionId } from '../neuro/actions.ts';

/**
 * One living organism. Everything an experiment needs to inspect about a person,
 * animal or hypothetical lineage hangs off this record.
 */
export interface Individual {
  id: number;
  speciesId: string;
  genome: Genome;
  brain: Brain;
  ageYears: number;
  energyKcal: number;
  /** 0..1; zero means dead. */
  health: number;
  cell: number;
  alive: boolean;
  /** Bitmask of known technologies. */
  knowledge: number;
  offspringCount: number;
  lastAction: ActionId | null;
  /** Decaying memory of recent success, 0..1. */
  memoryStrength: number;
  parentIds: [number, number] | null;
  bornTick: number;
  /** Last year at which this individual reproduced, for birth spacing. */
  lastBirthYear: number;
  /** Lifetime energy gathered, used in reports. */
  lifetimeIntakeKcal: number;
}

export interface FounderOptions {
  id: number;
  species: ResolvedSpecies;
  rng: Rng;
  cell: number;
  tick: number;
  ageYears?: number;
  /** Optional inherited knowledge, e.g. when introducing a species mid-run. */
  knowledge?: number;
  /** Tick length, so energy stores scale with the step size. */
  yearsPerTick?: number;
}

export const createIndividual = (options: FounderOptions): Individual => {
  const { species, rng, cell, tick } = options;
  const genome = sampleGenome(species.genome, species.genomeSpread, rng);
  const brain = createBrain(species.brain, genome, rng);
  const ageYears = options.ageYears ?? rng.float(0.05, 0.45) * genome.lifespanYears;
  return {
    id: options.id,
    speciesId: species.id,
    genome,
    brain,
    ageYears,
    energyKcal: energyCapacityKcal(genome, options.yearsPerTick ?? 1) * rng.float(0.6, 0.95),
    health: rng.float(0.85, 1),
    cell,
    alive: true,
    knowledge: options.knowledge ?? 0,
    offspringCount: 0,
    lastAction: null,
    memoryStrength: 0.5,
    parentIds: null,
    bornTick: tick,
    lastBirthYear: 0,
    lifetimeIntakeKcal: 0,
  };
};

export interface OffspringOptions {
  id: number;
  species: ResolvedSpecies;
  motherGenome: Genome;
  fatherGenome: Genome;
  rng: Rng;
  cell: number;
  tick: number;
  /** Cultural inheritance: fraction of parental knowledge passed without teaching. */
  inheritedKnowledge?: number;
  yearsPerTick?: number;
}

export const createOffspring = (options: OffspringOptions): Individual => {
  const { species, rng, cell, tick } = options;
  const genome = recombineGenomes(options.motherGenome, options.fatherGenome, rng, { scale: 1 });
  const brain = createBrain(species.brain, genome, rng);
  return {
    id: options.id,
    speciesId: species.id,
    genome,
    brain,
    ageYears: 0,
    energyKcal: energyCapacityKcal(genome, options.yearsPerTick ?? 1) * 0.7,
    health: rng.float(0.8, 0.98),
    cell,
    alive: true,
    knowledge: options.inheritedKnowledge ?? 0,
    offspringCount: 0,
    lastAction: null,
    memoryStrength: 0.5,
    parentIds: null,
    bornTick: tick,
    lastBirthYear: 0,
    lifetimeIntakeKcal: 0,
  };
};

/** True when the individual can conceive/produce offspring now. */
export const canReproduce = (individual: Individual, currentYear: number): boolean => {
  if (!individual.alive || individual.health < 0.35) return false;
  if (!isFertileAge(individual.genome, individual.ageYears)) return false;
  const spacing = Math.max(0.5, individual.genome.lifespanYears * 0.03);
  return currentYear - individual.lastBirthYear >= spacing;
};

/** Replace a gene value, clamping to the gene's valid range (used by experiments). */
export const setGene = (individual: Individual, key: keyof Genome, value: number): void => {
  individual.genome[key] = clampGene(key, value);
};

/** Reset an individual to the species baseline genome (useful in interventions). */
export const resetGenome = (individual: Individual, species: ResolvedSpecies): void => {
  individual.genome = defaultGenome(species.genome);
};

export const cognition = (individual: Individual): number => cognitionScore(individual.brain);

export const isAlive = (individual: Individual): boolean => individual.alive && individual.health > 0;

/** Approximate wet biomass in kg, used to price prey and compute predation. */
export const biomassKg = (individual: Individual): number => individual.genome.bodyMassKg;

/** Apply a mutation directly to a living individual (germline engineering). */
export const mutateIndividual = (individual: Individual, rng: Rng, scale = 1): void => {
  individual.genome = mutateGenome(individual.genome, rng, { scale });
};
