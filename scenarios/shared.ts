import type { SystemSpec } from '../src/cosmos/system.ts';
import type { FoundingSpec, WorldSpec } from '../src/engine/scenario.ts';

/**
 * A Sol-like system used by several experiments. Everything is explicit so scenarios
 * that differ only in biology share exactly the same physics.
 */
export const solLikeSystem: SystemSpec = {
  name: 'Helios',
  star: { name: 'Helios', spectralClass: 'G' },
  planets: [
    {
      id: 'ferrum',
      name: 'Ferrum',
      kind: 'rocky',
      orbit: { semiMajorAxisAu: 0.39, eccentricity: 0.06, meanAnomalyAtEpochDeg: 40 },
      targetMeanTempC: 160,
    },
    {
      id: 'terrarium',
      name: 'Terrarium',
      kind: 'ocean',
      orbit: { semiMajorAxisAu: 1, eccentricity: 0.017, inclinationDeg: 0.4, meanAnomalyAtEpochDeg: 0 },
      targetMeanTempC: 14,
    },
    {
      id: 'rubra',
      name: 'Rubra',
      kind: 'desert',
      orbit: { semiMajorAxisAu: 1.52, eccentricity: 0.09, meanAnomalyAtEpochDeg: 120 },
      targetMeanTempC: -58,
    },
    {
      id: 'colossus',
      name: 'Colossus',
      kind: 'gasGiant',
      orbit: { semiMajorAxisAu: 5.2, eccentricity: 0.05, meanAnomalyAtEpochDeg: 200 },
    },
  ],
};

export const earthLikeWorld: WorldSpec = {
  name: 'Terrarium',
  system: solLikeSystem,
  focusPlanet: 'terrarium',
  grid: { width: 64, height: 32 },
  continentScale: 1.9,
  roughness: 0.6,
  harvestedAreaFraction: 0.0015,
};

/** Humans, their livestock-equivalent grazers, and a predator guild. */
export const earthFounders: FoundingSpec[] = [
  {
    speciesId: 'human',
    count: 90,
    preferBiomes: ['savanna', 'grassland', 'temperateForest'],
    minTempC: 2,
    maxTempC: 32,
  },
  {
    speciesId: 'grazer',
    count: 520,
    preferBiomes: ['grassland', 'savanna', 'temperateForest', 'taiga'],
    minTempC: -6,
    maxTempC: 36,
  },
  {
    speciesId: 'predator',
    count: 40,
    preferBiomes: ['savanna', 'grassland', 'temperateForest'],
    minTempC: -10,
    maxTempC: 32,
  },
];

/** Founders with a substituted focal hominin species, keeping the ecosystem fixed. */
export const foundersWith = (homininId: string): FoundingSpec[] =>
  earthFounders.map((founder) => (founder.speciesId === 'human' ? { ...founder, speciesId: homininId } : founder));
