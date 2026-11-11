/**
 * Whittaker-style biome classification from temperature, precipitation and elevation.
 *
 * NPP figures are typical values in grams of carbon per square metre per year
 * (terrestrial net primary production). They feed the food model through
 * `nppKcalPerKm2Year`.
 */

export type BiomeId =
  | 'ocean'
  | 'ice'
  | 'tundra'
  | 'taiga'
  | 'temperateForest'
  | 'grassland'
  | 'savanna'
  | 'desert'
  | 'tropicalForest'
  | 'mountain';

export interface BiomeInfo {
  id: BiomeId;
  name: string;
  nppGcM2Yr: number;
  color: string;
  /** General suitability for a tool-using omnivore, 0..1. */
  habitability: number;
  description: string;
}

export const BIOMES: Record<BiomeId, BiomeInfo> = {
  ocean: { id: 'ocean', name: 'Ocean', nppGcM2Yr: 0, color: '#1b4f72', habitability: 0, description: 'Open water; no terrestrial forage.' },
  ice: { id: 'ice', name: 'Ice sheet', nppGcM2Yr: 5, color: '#e8f1f8', habitability: 0.02, description: 'Permanent ice; almost no primary production.' },
  tundra: { id: 'tundra', name: 'Tundra', nppGcM2Yr: 140, color: '#9aa88f', habitability: 0.15, description: 'Cold, treeless, short growing season.' },
  taiga: { id: 'taiga', name: 'Boreal forest', nppGcM2Yr: 800, color: '#2f5d50', habitability: 0.45, description: 'Conifer forest of the high latitudes.' },
  temperateForest: { id: 'temperateForest', name: 'Temperate forest', nppGcM2Yr: 1200, color: '#3f7d3a', habitability: 0.9, description: 'Deciduous and mixed forest with reliable rainfall.' },
  grassland: { id: 'grassland', name: 'Grassland', nppGcM2Yr: 600, color: '#a3b35b', habitability: 0.8, description: 'Open grass and shrubs; good grazing.' },
  savanna: { id: 'savanna', name: 'Savanna', nppGcM2Yr: 900, color: '#c2a552', habitability: 1, description: 'Tropical grass with scattered trees; the human cradle.' },
  desert: { id: 'desert', name: 'Desert', nppGcM2Yr: 90, color: '#d9c08b', habitability: 0.08, description: 'Arid; sparse vegetation.' },
  tropicalForest: { id: 'tropicalForest', name: 'Tropical rainforest', nppGcM2Yr: 2200, color: '#1e6b3a', habitability: 0.75, description: 'Hot, wet, extremely productive but hard to traverse.' },
  mountain: { id: 'mountain', name: 'Alpine / mountain', nppGcM2Yr: 300, color: '#8b8f96', habitability: 0.2, description: 'High elevation; thin air, steep terrain.' },
};

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

/** Energy yield of net primary production, kcal per km² per year. */
export const nppKcalPerKm2Year = (nppGcM2Yr: number): number =>
  nppGcM2Yr * 9 * 1_000_000;

export const classifyBiome = (
  tempC: number,
  precipMm: number,
  elevationM: number,
  isOcean: boolean,
): BiomeId => {
  if (isOcean) return tempC < -2 ? 'ice' : 'ocean';
  if (elevationM > 2800) return 'mountain';
  if (tempC < -8) return 'ice';
  if (tempC < 0) return precipMm < 150 ? 'desert' : 'tundra';
  if (tempC < 10) return precipMm > 450 ? 'taiga' : 'tundra';
  if (tempC < 20) {
    if (precipMm > 1000) return 'temperateForest';
    if (precipMm > 400) return 'grassland';
    return 'desert';
  }
  if (precipMm > 1800) return 'tropicalForest';
  if (precipMm > 750) return 'savanna';
  if (precipMm > 300) return 'grassland';
  return 'desert';
};

/** Relative edible plant fraction available to a herbivore, by biome. */
export const plantEdibleFraction = (biome: BiomeId): number => {
  switch (biome) {
    case 'savanna':
    case 'grassland':
      return 0.006;
    case 'temperateForest':
    case 'taiga':
      return 0.003;
    case 'tropicalForest':
      return 0.004;
    case 'tundra':
    case 'mountain':
      return 0.0015;
    case 'desert':
      return 0.0008;
    default:
      return 0;
  }
};
