import type { SystemSpec } from '../cosmos/system.ts';
import type { BiomeId } from '../geo/biomes.ts';
import { BRAIN_REGIONS } from '../neuro/regions.ts';
import { TECH_BY_ID } from '../society/technology.ts';
import type { SpeciesSpec } from '../bio/species.ts';

/**
 * A scenario is a declarative experiment: a physical world, a set of species,
 * where they start, how long to run, and optional interventions.
 *
 * Scenarios are TypeScript modules so they are type-checked by the compiler. There is
 * no runtime schema to drift out of sync with the simulation.
 */
export interface GridSpec {
  width: number;
  height: number;
}

export interface WorldSpec {
  name?: string;
  system?: SystemSpec;
  /** Planet id or name to simulate the surface of. Defaults to the first ocean world. */
  focusPlanet?: string;
  grid?: GridSpec;
  /** Override the focus planet's ocean coverage (0..1). */
  oceanFraction?: number;
  continentScale?: number;
  roughness?: number;
  /**
   * Fraction of each grid cell that is actually exploited. A 64x32 cell covers a
   * whole region, of which only a small part is forageable; this keeps carrying
   * capacity in a realistic range. Default 0.001.
   */
  harvestedAreaFraction?: number;
}

export interface FoundingSpec {
  speciesId: string;
  count?: number;
  preferBiomes?: BiomeId[];
  minTempC?: number;
  maxTempC?: number;
  startingTech?: string[];
}

export type Intervention =
  | {
      atTick: number;
      kind: 'ablateRegion';
      /** Omit to affect every species. */
      speciesId?: string;
      regionId: string;
      /** Fraction of the species affected, 0..1. Default 1. */
      fraction?: number;
    }
  | {
      atTick: number;
      kind: 'boostRegion';
      speciesId?: string;
      regionId: string;
      scale: number;
      fraction?: number;
    }
  | {
      atTick: number;
      kind: 'plague';
      speciesId?: string;
      /** Per-tick mortality probability before resistance. */
      mortality: number;
    }
  | {
      atTick: number;
      kind: 'teach';
      speciesId?: string;
      technology: string;
      fraction?: number;
    }
  | {
      atTick: number;
      kind: 'climateShock';
      deltaC: number;
      durationTicks: number;
    }
  | {
      atTick: number;
      kind: 'introduceSpecies';
      speciesId: string;
      count: number;
    };

export interface RunSpec {
  ticks: number;
  /** Simulation years per tick. 1 = annual; 5 = coarse multi-year steps. */
  yearsPerTick: number;
  maxPopulation?: number;
}

export interface Scenario {
  name: string;
  description: string;
  /** Base seed; the CLI can override it for replication. */
  seed?: number;
  world: WorldSpec;
  species: SpeciesSpec[];
  /** Optional explicit founding populations. Defaults to every species with its defaultCount. */
  founders?: FoundingSpec[];
  run: RunSpec;
  interventions?: Intervention[];
}

const TECH_IDS = new Set(TECH_BY_ID.keys());

/** Validate a scenario and throw a single error listing every problem found. */
export const validateScenario = (scenario: Scenario): void => {
  const problems: string[] = [];
  if (!scenario.name?.trim()) problems.push('scenario.name is required');
  if (!scenario.run) problems.push('scenario.run is required');
  else {
    if (!Number.isFinite(scenario.run.ticks) || scenario.run.ticks <= 0) problems.push('run.ticks must be a positive number');
    if (!Number.isFinite(scenario.run.yearsPerTick) || scenario.run.yearsPerTick <= 0) problems.push('run.yearsPerTick must be positive');
    if (scenario.run.ticks > 100_000) problems.push('run.ticks above 100000 is not supported');
  }

  const grid = scenario.world?.grid;
  if (grid) {
    if (!Number.isInteger(grid.width) || grid.width < 4 || grid.width > 512) problems.push('world.grid.width must be an integer in [4, 512]');
    if (!Number.isInteger(grid.height) || grid.height < 4 || grid.height > 256) problems.push('world.grid.height must be an integer in [4, 256]');
  }

  if (!Array.isArray(scenario.species) || scenario.species.length === 0) {
    problems.push('scenario.species must list at least one species');
  } else {
    const seen = new Set<string>();
    for (const species of scenario.species) {
      if (!species.id) problems.push('every species needs an id');
      if (seen.has(species.id)) problems.push(`duplicate species id "${species.id}"`);
      seen.add(species.id);
      if (species.brain?.regions) {
        for (const regionId of Object.keys(species.brain.regions)) {
          if (!BRAIN_REGIONS.has(regionId)) {
            problems.push(`species "${species.id}" references unknown brain region "${regionId}" (known: ${BRAIN_REGIONS.ids().join(', ')})`);
          }
        }
      }
    }
  }

  const speciesIds = new Set(scenario.species?.map((s) => s.id) ?? []);
  for (const founder of scenario.founders ?? []) {
    if (!speciesIds.has(founder.speciesId)) problems.push(`founders reference unknown species "${founder.speciesId}"`);
    if (founder.count !== undefined && (!Number.isFinite(founder.count) || founder.count < 0)) {
      problems.push(`founders for "${founder.speciesId}" need a non-negative count`);
    }
    for (const tech of founder.startingTech ?? []) {
      if (!TECH_IDS.has(tech)) problems.push(`founders for "${founder.speciesId}" reference unknown technology "${tech}"`);
    }
  }

  scenario.interventions?.forEach((intervention, index) => {
    const label = `intervention #${index + 1} (${intervention.kind})`;
    if (!Number.isFinite(intervention.atTick) || intervention.atTick < 0) problems.push(`${label} needs a non-negative atTick`);
    if ('speciesId' in intervention && intervention.speciesId && !speciesIds.has(intervention.speciesId)) {
      problems.push(`${label} references unknown species "${intervention.speciesId}"`);
    }
    if (intervention.kind === 'ablateRegion' || intervention.kind === 'boostRegion') {
      if (!BRAIN_REGIONS.has(intervention.regionId)) {
        problems.push(`${label} references unknown brain region "${intervention.regionId}"`);
      }
      if (intervention.kind === 'boostRegion' && !(intervention.scale > 0)) problems.push(`${label} needs a positive scale`);
    }
    if (intervention.kind === 'teach' && !TECH_IDS.has(intervention.technology)) {
      problems.push(`${label} references unknown technology "${intervention.technology}"`);
    }
    if (intervention.kind === 'plague' && !(intervention.mortality >= 0 && intervention.mortality <= 1)) {
      problems.push(`${label} mortality must be within [0, 1]`);
    }
    if (intervention.kind === 'introduceSpecies' && !speciesIds.has(intervention.speciesId)) {
      problems.push(`${label} references unknown species "${intervention.speciesId}"`);
    }
  });

  if (problems.length > 0) {
    throw new Error(`Invalid scenario "${scenario.name ?? '(unnamed)'}":\n- ${problems.join('\n- ')}`);
  }
};

/** Founding specs after defaults are applied. */
export const resolveFounders = (scenario: Scenario): FoundingSpec[] => {
  if (scenario.founders && scenario.founders.length > 0) return scenario.founders;
  return scenario.species.map((species) => ({ speciesId: species.id, count: species.defaultCount ?? 40 }));
};
