import { clamp, pow } from '../core/math.ts';
import { Rng } from '../core/rng.ts';
import { fbm3D, ridged3D } from './noise.ts';

export interface TerrainOptions {
  width: number;
  height: number;
  /** Desired ocean fraction of the surface, 0..1. Controls the sea level. */
  oceanFraction?: number;
  /** Continent scale: lower is larger. */
  continentScale?: number;
  /** Mountain intensity, 0..1. */
  roughness?: number;
  radiusKm?: number;
}

export interface Terrain {
  width: number;
  height: number;
  elevationM: Float64Array;
  isOcean: Uint8Array;
  /** Local elevation gradient, normalised 0..1. */
  ruggedness: Float64Array;
  /** Area of each cell in km², accounting for latitude convergence. */
  cellAreaKm2: Float64Array;
  oceanFraction: number;
}

/** Latitude/longitude (degrees) of a grid cell centre. Row 0 is the north pole. */
export const cellLatLon = (i: number, j: number, width: number, height: number): { latDeg: number; lonDeg: number } => {
  const latDeg = 90 - ((j + 0.5) / height) * 180;
  const lonDeg = ((i + 0.5) / width) * 360 - 180;
  return { latDeg, lonDeg };
};

/** Convert a cell to a unit vector on the sphere. */
export const cellToUnitVector = (i: number, j: number, width: number, height: number): [number, number, number] => {
  const { latDeg, lonDeg } = cellLatLon(i, j, width, height);
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
};

/**
 * Per-cell surface area on a sphere: each row is a spherical band whose area is
 * proportional to the difference of sines of its latitude bounds.
 */
export const computeCellAreas = (width: number, height: number, radiusKm: number): Float64Array => {
  const areas = new Float64Array(width * height);
  const total = 4 * Math.PI * radiusKm * radiusKm;
  for (let j = 0; j < height; j++) {
    const north = Math.sin(((90 - (j / height) * 180) * Math.PI) / 180);
    const south = Math.sin(((90 - ((j + 1) / height) * 180) * Math.PI) / 180);
    const band = (total * Math.abs(north - south)) / 2;
    const perCell = band / width;
    for (let i = 0; i < width; i++) areas[j * width + i] = perCell;
  }
  return areas;
};

/** Nearest cell index for a latitude/longitude, wrapping longitude. */
export const cellIndex = (latDeg: number, lonDeg: number, width: number, height: number): number => {
  const j = clamp(Math.floor(((90 - latDeg) / 180) * height), 0, height - 1);
  const wrappedLon = ((lonDeg + 180) % 360 + 360) % 360;
  const i = clamp(Math.floor((wrappedLon / 360) * width), 0, width - 1);
  return j * width + i;
};

const quantile = (values: Float64Array, fraction: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.floor(fraction * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[index] as number;
};

/**
 * Build a spherical heightmap.
 *
 * Continent shapes come from low-frequency 3D noise sampled on the sphere; mountain
 * chains are blended in with ridged noise modulated by a separate mask. The sea level
 * is chosen from a quantile so the requested ocean fraction is realised exactly,
 * which keeps climate and biology independent of noise tuning.
 */
export const generateTerrain = (rng: Rng, options: TerrainOptions): Terrain => {
  const { width, height } = options;
  const radiusKm = options.radiusKm ?? 6371;
  const oceanFraction = clamp(options.oceanFraction ?? 0.7, 0, 1);
  const continentScale = options.continentScale ?? 1.9;
  const roughness = clamp(options.roughness ?? 0.6, 0, 1);
  const seed = rng.int(1, 2 ** 31 - 1);

  const size = width * height;
  const raw = new Float64Array(size);
  const mountainMask = new Float64Array(size);

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const [x, y, z] = cellToUnitVector(i, j, width, height);
      const continents = fbm3D(seed, x * continentScale, y * continentScale, z * continentScale, 5, 2.05, 0.52);
      // A second, coarser field breaks the noise's uniformity at continental scale.
      const plates = fbm3D(seed + 1013, x * continentScale * 0.45 + 3.1, y * continentScale * 0.45 - 1.7, z * continentScale * 0.45, 3);
      const base = continents * 0.72 + plates * 0.28;
      // Ridge noise only builds mountains where the base is already elevated.
      const uplift = clamp((base + 0.2) / 0.9, 0, 1);
      const ridge = ridged3D(seed + 4241, x * 3.2, y * 3.2, z * 3.2, 4);
      raw[j * width + i] = base + ridge * uplift * roughness * 0.35;
      mountainMask[j * width + i] = ridge * uplift;
    }
  }

  const seaLevel = quantile(raw, oceanFraction);
  const landMax = Math.max(1e-6, quantile(raw, 0.9995) - seaLevel);
  const elevationM = new Float64Array(size);
  const isOcean = new Uint8Array(size);

  for (let k = 0; k < size; k++) {
    const value = (raw[k] as number) - seaLevel;
    if (value <= 0) {
      isOcean[k] = 1;
      elevationM[k] = value * 5200;
    } else {
      const normalised = clamp(value / landMax, 0, 1);
      // Hypsometric curve: most land is low, mountain chains rise steeply.
      elevationM[k] = pow(normalised, 1.6) * 7200 + pow(mountainMask[k] as number, 3) * 1800 * roughness;
    }
  }

  const ruggedness = new Float64Array(size);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const east = elevationM[j * width + ((i + 1) % width)] as number;
      const west = elevationM[j * width + ((i - 1 + width) % width)] as number;
      const north = elevationM[Math.max(0, j - 1) * width + i] as number;
      const south = elevationM[Math.min(height - 1, j + 1) * width + i] as number;
      const gradient = Math.hypot(east - west, north - south) / 2000;
      ruggedness[j * width + i] = clamp(gradient, 0, 1);
    }
  }

  return {
    width,
    height,
    elevationM,
    isOcean,
    ruggedness,
    cellAreaKm2: computeCellAreas(width, height, radiusKm),
    oceanFraction,
  };
};

/** Land area within a radius in km (great-circle), used for settlement selection. */
export const neighbouringCells = (index: number, width: number, height: number): number[] => {
  const j = Math.floor(index / width);
  const i = index % width;
  const result: number[] = [];
  for (const dj of [-1, 0, 1]) {
    const nj = j + dj;
    if (nj < 0 || nj >= height) continue;
    for (const di of [-1, 0, 1]) {
      if (dj === 0 && di === 0) continue;
      const ni = (i + di + width) % width;
      result.push(nj * width + ni);
    }
  }
  return result;
};
