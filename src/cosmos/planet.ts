import { EARTH_MASS_KG, EARTH_RADIUS_KM, GRAVITATIONAL_CONSTANT, kelvinToCelsius, orbitalPeriodYears } from '../core/units.ts';
import type { SpectralClass, Star } from './star.ts';

export type PlanetKind = 'rocky' | 'ocean' | 'desert' | 'ice' | 'superEarth' | 'gasGiant';

export interface AtmosphereComponent {
  gas: string;
  fraction: number;
}

export interface Atmosphere {
  surfacePressureAtm: number;
  composition: AtmosphereComponent[];
}

export interface Moon {
  name: string;
  massEarth: number;
  radiusKm: number;
  distanceKm: number;
  orbitalPeriodDays: number;
}

export interface Planet {
  id: string;
  name: string;
  kind: PlanetKind;
  massEarth: number;
  radiusKm: number;
  /** Bond albedo, 0..1. */
  albedo: number;
  /**
   * Greenhouse strength parameter g in T_surf = T_eq * (1 + g)^0.25.
   * Earth is ~0.6 (255 K equilibrium -> 288 K surface).
   */
  greenhouse: number;
  rotationHours: number;
  axialTiltDeg: number;
  /** Fraction of the surface covered by liquid water, 0..1. */
  oceanFraction: number;
  atmosphere: Atmosphere;
  moons: Moon[];
}

export interface PlanetOptions extends Partial<Omit<Planet, 'id'>> {
  id?: string;
  name?: string;
  kind?: PlanetKind;
}

type PlanetPreset = Pick<Planet, 'massEarth' | 'radiusKm' | 'albedo' | 'greenhouse' | 'rotationHours' | 'axialTiltDeg' | 'oceanFraction'> & {
  atmosphere: Atmosphere;
};

export const PLANET_PRESETS: Record<PlanetKind, PlanetPreset> = {
  rocky: {
    massEarth: 0.8,
    radiusKm: 6100,
    albedo: 0.25,
    greenhouse: 0.15,
    rotationHours: 26,
    axialTiltDeg: 18,
    oceanFraction: 0.1,
    atmosphere: { surfacePressureAtm: 0.3, composition: [{ gas: 'CO2', fraction: 0.9 }, { gas: 'N2', fraction: 0.1 }] },
  },
  ocean: {
    massEarth: 1,
    radiusKm: EARTH_RADIUS_KM,
    albedo: 0.3,
    greenhouse: 0.6,
    rotationHours: 24,
    axialTiltDeg: 23.4,
    oceanFraction: 0.71,
    atmosphere: { surfacePressureAtm: 1, composition: [{ gas: 'N2', fraction: 0.78 }, { gas: 'O2', fraction: 0.21 }, { gas: 'CO2', fraction: 0.01 }] },
  },
  desert: {
    massEarth: 0.6,
    radiusKm: 5400,
    albedo: 0.35,
    greenhouse: 0.2,
    rotationHours: 30,
    axialTiltDeg: 12,
    oceanFraction: 0.02,
    atmosphere: { surfacePressureAtm: 0.15, composition: [{ gas: 'CO2', fraction: 0.95 }, { gas: 'N2', fraction: 0.05 }] },
  },
  ice: {
    massEarth: 0.5,
    radiusKm: 5000,
    albedo: 0.6,
    greenhouse: 0.08,
    rotationHours: 40,
    axialTiltDeg: 25,
    oceanFraction: 0.35,
    atmosphere: { surfacePressureAtm: 0.05, composition: [{ gas: 'N2', fraction: 0.8 }, { gas: 'CH4', fraction: 0.2 }] },
  },
  superEarth: {
    massEarth: 3.2,
    radiusKm: 11_000,
    albedo: 0.3,
    greenhouse: 0.45,
    rotationHours: 18,
    axialTiltDeg: 20,
    oceanFraction: 0.55,
    atmosphere: { surfacePressureAtm: 2.2, composition: [{ gas: 'N2', fraction: 0.7 }, { gas: 'CO2', fraction: 0.25 }, { gas: 'O2', fraction: 0.05 }] },
  },
  gasGiant: {
    massEarth: 300,
    radiusKm: 55_000,
    albedo: 0.45,
    greenhouse: 1.2,
    rotationHours: 10,
    axialTiltDeg: 3,
    oceanFraction: 0,
    atmosphere: { surfacePressureAtm: 100, composition: [{ gas: 'H2', fraction: 0.9 }, { gas: 'He', fraction: 0.1 }] },
  },
};

export const makePlanet = (options: PlanetOptions = {}): Planet => {
  const kind = options.kind ?? 'ocean';
  const preset = PLANET_PRESETS[kind];
  return {
    id: options.id ?? kind,
    name: options.name ?? 'Unnamed',
    kind,
    massEarth: options.massEarth ?? preset.massEarth,
    radiusKm: options.radiusKm ?? preset.radiusKm,
    albedo: options.albedo ?? preset.albedo,
    greenhouse: options.greenhouse ?? preset.greenhouse,
    rotationHours: options.rotationHours ?? preset.rotationHours,
    axialTiltDeg: options.axialTiltDeg ?? preset.axialTiltDeg,
    oceanFraction: options.oceanFraction ?? preset.oceanFraction,
    atmosphere: options.atmosphere ?? preset.atmosphere,
    moons: options.moons ?? [],
  };
};

/** Surface gravity in m/s². */
export const surfaceGravity = (planet: Pick<Planet, 'massEarth' | 'radiusKm'>): number => {
  const massKg = planet.massEarth * EARTH_MASS_KG;
  const radiusM = planet.radiusKm * 1000;
  return (GRAVITATIONAL_CONSTANT * massKg) / (radiusM * radiusM);
};

/** Escape velocity in km/s. */
export const escapeVelocityKmS = (planet: Pick<Planet, 'massEarth' | 'radiusKm'>): number => {
  const massKg = planet.massEarth * EARTH_MASS_KG;
  const radiusM = planet.radiusKm * 1000;
  return Math.sqrt((2 * GRAVITATIONAL_CONSTANT * massKg) / radiusM) / 1000;
};

/**
 * Blackbody equilibrium temperature in kelvin, ignoring greenhouse:
 * T_eq = 255 K * ((1-a)/0.7)^0.25 * (L/Lsun)^0.25 / sqrt(d/AU)
 */
export const equilibriumTemperatureK = (
  planet: Pick<Planet, 'albedo'>,
  star: Pick<Star, 'luminositySolar'>,
  distanceAu: number,
): number => {
  const albedo = Math.min(0.95, Math.max(0, planet.albedo));
  return 255 * ((1 - albedo) / 0.7) ** 0.25 * star.luminositySolar ** 0.25 / Math.sqrt(distanceAu);
};

/** Mean surface temperature in °C including a simple greenhouse scaling. */
export const surfaceTemperatureC = (
  planet: Pick<Planet, 'albedo' | 'greenhouse'>,
  star: Pick<Star, 'luminositySolar'>,
  distanceAu: number,
): number => {
  const equilibrium = equilibriumTemperatureK(planet, star, distanceAu);
  const surface = equilibrium * (1 + Math.max(0, planet.greenhouse)) ** 0.25;
  return kelvinToCelsius(surface);
};

/** Equilibrium temperature expressed in °C, for reporting. */
export const equilibriumTemperatureC = (
  planet: Pick<Planet, 'albedo'>,
  star: Pick<Star, 'luminositySolar'>,
  distanceAu: number,
): number => kelvinToCelsius(equilibriumTemperatureK(planet, star, distanceAu));

/** Length of the orbital year in days, from Kepler's third law. */
export const orbitalYearDays = (semiMajorAxisAu: number, starMassSolar: number): number =>
  orbitalPeriodYears(semiMajorAxisAu, starMassSolar) * 365.25;

/** Day length relative to Earth's. */
export const dayLengthRelative = (planet: Pick<Planet, 'rotationHours'>): number => planet.rotationHours / 24;

/** Earth-like surface temperature check used by scenario validation. */
export const isTemperate = (meanTempC: number): boolean => meanTempC > -10 && meanTempC < 40;

export const celsiusFromKelvin = kelvinToCelsius;

/** Spectral class helper for describing a planet's host star. */
export type HostStar = Pick<Star, 'spectralClass' | 'luminositySolar'>;
export type { SpectralClass };
