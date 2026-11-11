import { clamp, lerp } from '../core/math.ts';
import { BIOMES, classifyBiome, nppKcalPerKm2Year, type BiomeId } from './biomes.ts';
import { cellLatLon, type Terrain } from './terrain.ts';

export interface ClimateOptions {
  /** Planetary mean surface temperature, °C. */
  meanSurfaceTempC: number;
  /** Axial tilt in degrees; drives seasonal amplitude. */
  axialTiltDeg: number;
  /** Position in the year, radians; 0 = northern spring equinox. */
  seasonPhase: number;
  /** Equator-to-pole gradient in °C (half the peak-to-peak range). */
  latitudeGradientC?: number;
  /** Seasonal swing at the poles, °C, at 23.4° tilt. */
  seasonalAmplitudeC?: number;
  /** Atmospheric lapse rate, °C per km. */
  lapseRateCPerKm?: number;
}

export interface Climate {
  temperatureC: Float64Array;
  precipitationMm: Float64Array;
  biome: BiomeId[];
  /** Net primary production, kcal per km² per year. */
  nppKcalPerKm2: Float64Array;
  cellAreaKm2: Float64Array;
  meanTempC: number;
  minTempC: number;
  maxTempC: number;
  landFraction: number;
  biomeAreaFraction: Record<BiomeId, number>;
}

/** Interpolated zonal precipitation bands, by absolute latitude. */
const PRECIP_BANDS: [number, number][] = [
  [0, 2400],
  [12, 2000],
  [23, 900],
  [32, 420],
  [45, 800],
  [58, 1100],
  [70, 420],
  [90, 150],
];

const zonalPrecipitation = (absLatDeg: number): number => {
  for (let k = 0; k < PRECIP_BANDS.length - 1; k++) {
    const [lat0, p0] = PRECIP_BANDS[k] as [number, number];
    const [lat1, p1] = PRECIP_BANDS[k + 1] as [number, number];
    if (absLatDeg >= lat0 && absLatDeg <= lat1) {
      return lerp(p0, p1, (absLatDeg - lat0) / (lat1 - lat0));
    }
  }
  return 150;
};

/**
 * Compute temperature, precipitation, biome and productivity for every cell.
 *
 * This is a deliberately lightweight, transparent climate model: zonal temperature
 * with elevation lapse and seasonal migration of the thermal equator, zonal
 * precipitation bands reduced by orography and cold, then Whittaker classification.
 * It is not a general circulation model; it is enough to make latitude, seasons and
 * terrain matter for the biosphere.
 */
export const computeClimate = (terrain: Terrain, options: ClimateOptions): Climate => {
  const { width, height } = terrain;
  const size = width * height;
  const latitudeGradientC = options.latitudeGradientC ?? 16;
  const seasonalAmplitudeC = options.seasonalAmplitudeC ?? 9;
  const lapseRate = options.lapseRateCPerKm ?? 6.5;
  const tiltFactor = Math.sin((options.axialTiltDeg * Math.PI) / 180) / Math.sin((23.4 * Math.PI) / 180);

  const temperatureC = new Float64Array(size);
  const precipitationMm = new Float64Array(size);
  const biome: BiomeId[] = new Array(size);
  const nppKcalPerKm2 = new Float64Array(size);
  const biomeArea: Record<string, number> = {};
  for (const id of Object.keys(BIOMES)) biomeArea[id] = 0;

  const seasonalShift = Math.sin(options.seasonPhase) * seasonalAmplitudeC * tiltFactor;
  let minTemp = Number.POSITIVE_INFINITY;
  let maxTemp = Number.NEGATIVE_INFINITY;
  let tempTotal = 0;
  let landArea = 0;
  let totalArea = 0;

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const k = j * width + i;
      const area = terrain.cellAreaKm2[k] as number;
      const isOcean = terrain.isOcean[k] === 1;
      const elevation = terrain.elevationM[k] as number;
      const { latDeg } = cellLatLon(i, j, width, height);
      const latRad = (latDeg * Math.PI) / 180;

      const zonal = options.meanSurfaceTempC + latitudeGradientC * Math.cos(2 * latRad);
      // Seasons move the thermal equator: the summer hemisphere warms most at high latitude.
      const seasonal = seasonalShift * Math.sin(latRad);
      let temp = zonal + seasonal;
      if (isOcean) {
        // Water has a large heat capacity and is buffered towards the planetary mean.
        temp = options.meanSurfaceTempC + (temp - options.meanSurfaceTempC) * 0.65;
      } else {
        temp -= lapseRate * (Math.max(0, elevation) / 1000);
      }

      const absLat = Math.abs(latDeg);
      let precip = zonalPrecipitation(absLat);
      if (isOcean) precip *= 1.25;
      if (!isOcean) precip *= clamp(1 - Math.max(0, elevation) / 7000, 0.3, 1);
      precip *= clamp((temp + 20) / 25, 0.15, 1);
      precip *= clamp(1 + terrain.ruggedness[k] * 0.25, 1, 1.25);

      const biomeId = classifyBiome(temp, precip, elevation, isOcean);
      const info = BIOMES[biomeId];
      const temperatureFactor = clamp(1 - Math.abs(temp - 18) / 70, 0.45, 1.05);
      const npp = nppKcalPerKm2Year(info.nppGcM2Yr) * temperatureFactor;

      temperatureC[k] = temp;
      precipitationMm[k] = precip;
      biome[k] = biomeId;
      nppKcalPerKm2[k] = npp;
      biomeArea[biomeId] = (biomeArea[biomeId] ?? 0) + area;

      tempTotal += temp * area;
      totalArea += area;
      if (temp < minTemp) minTemp = temp;
      if (temp > maxTemp) maxTemp = temp;
      if (!isOcean) landArea += area;
    }
  }

  const biomeAreaFraction = {} as Record<BiomeId, number>;
  for (const id of Object.keys(BIOMES) as BiomeId[]) {
    biomeAreaFraction[id] = (biomeArea[id] ?? 0) / Math.max(totalArea, 1);
  }

  return {
    temperatureC,
    precipitationMm,
    biome,
    nppKcalPerKm2,
    cellAreaKm2: terrain.cellAreaKm2,
    meanTempC: tempTotal / Math.max(totalArea, 1),
    minTempC: minTemp,
    maxTempC: maxTemp,
    landFraction: landArea / Math.max(totalArea, 1),
    biomeAreaFraction,
  };
};

/** Phase in the year for a given time; 0 is northern spring. */
export const seasonPhaseFor = (timeYears: number): number => {
  const fraction = ((timeYears % 1) + 1) % 1;
  return fraction * 2 * Math.PI;
};

export const northernSeason = (seasonPhase: number): 'spring' | 'summer' | 'autumn' | 'winter' => {
  const p = ((seasonPhase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (p < Math.PI / 2) return 'spring';
  if (p < Math.PI) return 'summer';
  if (p < (3 * Math.PI) / 2) return 'autumn';
  return 'winter';
};
