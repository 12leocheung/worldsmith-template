import { SPECIES_PRESETS } from '../src/bio/species.ts';
import type { SpeciesSpec } from '../src/bio/species.ts';
import type { SystemSpec } from '../src/cosmos/system.ts';
import type { Scenario } from '../src/engine/scenario.ts';

/**
 * A compact M-dwarf system: a scorched inner world, a temperate tidally locked ocean
 * world in the habitable zone, and an ice world beyond the snow line. The focus planet
 * orbits every ~35 days and rotates once per orbit, so one hemisphere faces the star.
 *
 * The inhabitants are heat-adapted: high heat tolerance and efficient metabolism.
 * This scenario shows that the astronomy and climate layers accept a very different
 * physical setting without touching the biology or society code.
 */
const emberSystem: SystemSpec = {
  name: 'Ember',
  star: { name: 'Ember', spectralClass: 'M' },
  planets: [
    {
      id: 'cinder',
      name: 'Cinder',
      kind: 'desert',
      orbit: { semiMajorAxisAu: 0.06, eccentricity: 0.04 },
      targetMeanTempC: 110,
    },
    {
      id: 'veridia',
      name: 'Veridia',
      kind: 'ocean',
      orbit: { semiMajorAxisAu: 0.14, eccentricity: 0.01, inclinationDeg: 1.2 },
      targetMeanTempC: 29,
      axialTiltDeg: 2,
      rotationHours: 840,
      oceanFraction: 0.45,
    },
    {
      id: 'frost',
      name: 'Frost',
      kind: 'ice',
      orbit: { semiMajorAxisAu: 0.42, eccentricity: 0.03 },
      targetMeanTempC: -70,
    },
  ],
};

const emberGrazer: SpeciesSpec = {
  id: 'ember-grazer',
  name: 'Ember grazer',
  kind: 'animal',
  description: 'A small, heat-tolerant herd herbivore of the substellar savanna.',
  baseGenome: {
    bodyMassKg: 180,
    brainMassKg: 0.22,
    lifespanYears: 12,
    fertility: 3,
    aggression: 0.05,
    curiosity: 0.1,
    sociality: 0.85,
    metabolicEfficiency: 0.8,
    diseaseResistance: 0.35,
    coldToleranceC: -30,
    heatToleranceC: 25,
    learningRate: 0.2,
    diet: 0.02,
  },
  genomeSpread: 0.05,
  brain: { regions: { cortex: { scale: 0.15 }, hippocampus: { scale: 0.6 } }, exploration: 0.15 },
  color: '#fbbf24',
  defaultCount: 220,
  role: 'herbivore',
};

const scenario: Scenario = {
  name: 'Tidally locked M-dwarf world',
  description:
    'A close-in ocean world around an M dwarf, with a heat-adapted hominin and a native grazer. One orbit is 35 days and the planet rotates once per orbit; the year-round climate is hot.',
  seed: 7,
  world: {
    name: 'Veridia',
    system: emberSystem,
    focusPlanet: 'veridia',
    grid: { width: 48, height: 24 },
    continentScale: 1.6,
    roughness: 0.5,
    harvestedAreaFraction: 0.0015,
  },
  species: [SPECIES_PRESETS['heat-adapted'], emberGrazer],
  founders: [
    {
      speciesId: 'heat-adapted',
      count: 70,
      preferBiomes: ['savanna', 'grassland', 'desert', 'tropicalForest'],
      minTempC: 12,
    },
    {
      speciesId: 'ember-grazer',
      count: 240,
      preferBiomes: ['savanna', 'grassland'],
      minTempC: 8,
    },
  ],
  run: { ticks: 300, yearsPerTick: 1, maxPopulation: 1400 },
};

export default scenario;
