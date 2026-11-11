import type { Rng } from '../core/rng.ts';
import type { Planet } from '../cosmos/planet.ts';
import type { Star } from '../cosmos/star.ts';
import type { Climate } from '../geo/climate.ts';
import type { Terrain } from '../geo/terrain.ts';
import type { ResolvedSpecies } from '../bio/species.ts';
import type { Individual } from './individual.ts';
import type { TechEffects } from './technology.ts';

/** Per-species bookkeeping while a run is in progress. */
export interface SpeciesRuntime {
  resolved: ResolvedSpecies;
  /** Union of technologies known by living members. */
  knowledgeMask: number;
  effects: TechEffects;
  births: number;
  deaths: number;
  peakPopulation: number;
  extinct: boolean;
  extinctionTick: number | null;
}

export interface WorldEvent {
  tick: number;
  kind: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * The surface that behavioural code is allowed to touch.
 *
 * Actions do not import the engine; they receive this context. That keeps the
 * behaviour layer testable in isolation and lets alternate engines (a web app, a
 * parallel runner) reuse the same rules.
 */
export interface SimulationContext {
  readonly tick: number;
  readonly currentYear: number;
  readonly yearsPerTick: number;
  readonly rng: Rng;
  readonly climate: Climate;
  readonly terrain: Terrain;
  readonly planet: Planet;
  readonly star: Star;
  readonly individuals: Individual[];
  readonly speciesById: Map<string, SpeciesRuntime>;
  readonly maxPopulation: number;
  /** Available plant food energy per cell for this tick, kcal. */
  readonly foodStock: Float64Array;
  /** Plant food energy that regenerates in the cell per tick, kcal. */
  readonly foodCapacity: Float64Array;
  /** Total prey biomass per cell at the start of the tick, kg. */
  readonly preyBiomassKg: Float64Array;
  /** Predator biomass per cell at the start of the tick, kg. */
  readonly predatorBiomassKg: Float64Array;
  /** Cumulative climate offset from interventions, °C. */
  readonly temperatureOffsetC: number;
  readonly harvestedAreaFraction: number;
  nextId(): number;
  /** Living members of one species. The population ceiling is per species. */
  populationOf(speciesId: string): number;
  occupantsIn(cell: number): readonly Individual[];
  sameSpeciesCount(cell: number, speciesId: string): number;
  move(individual: Individual, toCell: number): void;
  addOffspring(individual: Individual): void;
  recordBirth(speciesId: string): void;
  recordDeath(speciesId: string, cause: string): void;
  recordAction(action: string): void;
  recordSpeciesAction(speciesId: string, action: string): void;
  event(kind: string, message: string, data?: Record<string, unknown>): void;
  techEffectsFor(speciesId: string): TechEffects;
}
