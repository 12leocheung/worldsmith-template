import { Rng } from '../core/rng.ts';

/** Harvard spectral classes, coarse but enough to drive luminosity/colour/lifetime. */
export type SpectralClass = 'M' | 'K' | 'G' | 'F' | 'A' | 'B' | 'O';

export interface Star {
  name: string;
  spectralClass: SpectralClass;
  massSolar: number;
  luminositySolar: number;
  radiusSolar: number;
  surfaceTempK: number;
  /** Main-sequence lifetime in billions of years. */
  lifetimeGyr: number;
  colorHex: string;
}

export type StarOptions = {
  name?: string;
  spectralClass?: SpectralClass;
  massSolar?: number;
  luminositySolar?: number;
  radiusSolar?: number;
  surfaceTempK?: number;
};

type SpectralPreset = {
  massSolar: number;
  luminositySolar: number;
  radiusSolar: number;
  surfaceTempK: number;
  colorHex: string;
  /** Relative abundance when sampling a random star. */
  abundance: number;
};

export const SPECTRAL_PRESETS: Record<SpectralClass, SpectralPreset> = {
  M: { massSolar: 0.3, luminositySolar: 0.015, radiusSolar: 0.35, surfaceTempK: 3300, colorHex: '#ff6b4a', abundance: 0.6 },
  K: { massSolar: 0.75, luminositySolar: 0.35, radiusSolar: 0.75, surfaceTempK: 4800, colorHex: '#ffb46b', abundance: 0.15 },
  G: { massSolar: 1.0, luminositySolar: 1.0, radiusSolar: 1.0, surfaceTempK: 5780, colorHex: '#fff4d6', abundance: 0.08 },
  F: { massSolar: 1.3, luminositySolar: 2.5, radiusSolar: 1.25, surfaceTempK: 6700, colorHex: '#f8f7ff', abundance: 0.05 },
  A: { massSolar: 1.8, luminositySolar: 12, radiusSolar: 1.8, surfaceTempK: 8500, colorHex: '#dfe8ff', abundance: 0.02 },
  B: { massSolar: 6.0, luminositySolar: 800, radiusSolar: 4.0, surfaceTempK: 17000, colorHex: '#bcd4ff', abundance: 0.008 },
  O: { massSolar: 20, luminositySolar: 30_000, radiusSolar: 8.0, surfaceTempK: 35_000, colorHex: '#a8c0ff', abundance: 0.002 },
};

/** Main-sequence lifetime: t[Gyr] ~ 10 * M / L in solar units. */
export const mainSequenceLifetimeGyr = (massSolar: number, luminositySolar: number): number =>
  (10 * massSolar) / Math.max(luminositySolar, 1e-6);

export const makeStar = (options: StarOptions = {}): Star => {
  const spectralClass = options.spectralClass ?? 'G';
  const preset = SPECTRAL_PRESETS[spectralClass];
  const massSolar = options.massSolar ?? preset.massSolar;
  // Mass-luminosity relation is a decent fallback when only mass is specified.
  const luminositySolar =
    options.luminositySolar ?? (options.massSolar === undefined ? preset.luminositySolar : massSolar ** 3.5);
  return {
    name: options.name ?? `Star-${spectralClass}`,
    spectralClass,
    massSolar,
    luminositySolar,
    radiusSolar: options.radiusSolar ?? preset.radiusSolar,
    surfaceTempK: options.surfaceTempK ?? preset.surfaceTempK,
    lifetimeGyr: mainSequenceLifetimeGyr(massSolar, luminositySolar),
    colorHex: preset.colorHex,
  };
};

export const sampleSpectralClass = (rng: Rng): SpectralClass => {
  const ids = Object.keys(SPECTRAL_PRESETS) as SpectralClass[];
  const weights = ids.map((id) => SPECTRAL_PRESETS[id].abundance);
  return ids[Math.max(0, rng.weightedIndex(weights))] as SpectralClass;
};

/**
 * Conservative habitable zone in AU, from a simple flux scaling of the Sun's HZ
 * (0.95 - 1.37 AU). Adequate for scenario setup; not a climate model.
 */
export const habitableZone = (star: Pick<Star, 'luminositySolar'>): { innerAu: number; outerAu: number } => {
  const root = Math.sqrt(star.luminositySolar);
  return { innerAu: 0.95 * root, outerAu: 1.67 * root };
};

/** Snow line in AU: where volatiles condense, roughly 2.7 * sqrt(L). */
export const frostLineAu = (star: Pick<Star, 'luminositySolar'>): number => 2.7 * Math.sqrt(star.luminositySolar);

export const insideHabitableZone = (
  star: Pick<Star, 'luminositySolar'>,
  distanceAu: number,
): boolean => {
  const hz = habitableZone(star);
  return distanceAu >= hz.innerAu && distanceAu <= hz.outerAu;
};
