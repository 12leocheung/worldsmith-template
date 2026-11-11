/**
 * Public API for Worldsmith.
 *
 * Import the engine to build experiments, or individual layers when writing a
 * specialised simulator (for example an astronomy-only or brain-only study).
 */
export { World } from './engine/world.ts';
export { validateScenario, resolveFounders } from './engine/scenario.ts';
export type {
  Scenario,
  WorldSpec,
  FoundingSpec,
  Intervention,
  RunSpec,
  GridSpec,
} from './engine/scenario.ts';
export { renderMarkdown, renderHtmlReport, comparisonMetrics } from './engine/report.ts';
export type { RunResult, Series, SpeciesSummary } from './engine/report.ts';

export { Rng, seededPick } from './core/rng.ts';
export type { Seed } from './core/rng.ts';
export { Registry, digest } from './core/registry.ts';
export * as math from './core/math.ts';
export * as units from './core/units.ts';

export { makeStar, habitableZone, frostLineAu, insideHabitableZone, SPECTRAL_PRESETS } from './cosmos/star.ts';
export type { Star, SpectralClass } from './cosmos/star.ts';
export { solveKepler, stateAt, periodYears, makeOrbit, distanceAuAt } from './cosmos/orbit.ts';
export type { OrbitalElements, OrbitalState } from './cosmos/orbit.ts';
export {
  makePlanet,
  surfaceGravity,
  equilibriumTemperatureK,
  equilibriumTemperatureC,
  surfaceTemperatureC,
  escapeVelocityKmS,
  orbitalYearDays,
  PLANET_PRESETS,
} from './cosmos/planet.ts';
export type { Planet, PlanetKind, Moon, Atmosphere } from './cosmos/planet.ts';
export { resolveSystem, findBody, describeBody, tuneGreenhouseForTemperature } from './cosmos/system.ts';
export type { StarSystem, SystemBody, SystemSpec, PlanetSpec } from './cosmos/system.ts';

export { generateTerrain, computeCellAreas, cellLatLon, cellIndex, neighbouringCells } from './geo/terrain.ts';
export type { Terrain, TerrainOptions } from './geo/terrain.ts';
export { computeClimate, seasonPhaseFor, northernSeason } from './geo/climate.ts';
export type { Climate, ClimateOptions } from './geo/climate.ts';
export { BIOMES, classifyBiome, nppKcalPerKm2Year, plantEdibleFraction } from './geo/biomes.ts';
export type { BiomeId, BiomeInfo } from './geo/biomes.ts';

export {
  GENE_SPECS,
  GENE_KEYS,
  defaultGenome,
  mutateGenome,
  recombineGenomes,
  sampleGenome,
  genomeDistance,
  meanGenome,
} from './bio/genome.ts';
export type { Genome, GeneKey, GeneSpec } from './bio/genome.ts';
export {
  basalMetabolicKcalPerDay,
  dailyEnergyDemandKcal,
  annualEnergyNeedKcal,
  thermalStressC,
  ageMortalityHazard,
  isFertileAge,
  energyCapacityKcal,
} from './bio/metabolism.ts';
export { SPECIES_PRESETS, resolveSpecies, describeSpecies } from './bio/species.ts';
export type { SpeciesSpec, ResolvedSpecies } from './bio/species.ts';

export { ACTION_IDS, ACTIONS } from './neuro/actions.ts';
export type { ActionId, ActionInfo } from './neuro/actions.ts';
export { BRAIN_REGIONS, BUILTIN_REGIONS } from './neuro/regions.ts';
export type { RegionDefinition, RegionFunction } from './neuro/regions.ts';
export {
  createBrain,
  cognitionScore,
  vitalTone,
  functionCapacity,
  actionUtilities,
  chooseAction,
  learnFromAction,
  configureRegion,
  describeBrain,
  teachingFidelity,
  innovationChancePerYear,
} from './neuro/brain.ts';
export type { Brain, BrainSpec, Perception, RegionConfig } from './neuro/brain.ts';

export { createIndividual, createOffspring, canReproduce } from './society/individual.ts';
export type { Individual } from './society/individual.ts';
export { act, buildPerception } from './society/actions.ts';
export {
  TECHNOLOGIES,
  TECH_BY_ID,
  techEffects,
  availableTechnologies,
  knownTechnologies,
  hasTech,
  addTech,
  techIds,
  techMaskOf,
  ALL_TECH_MASK,
} from './society/technology.ts';
export type { Technology, TechEffects } from './society/technology.ts';
export type { SimulationContext, SpeciesRuntime, WorldEvent } from './society/context.ts';
