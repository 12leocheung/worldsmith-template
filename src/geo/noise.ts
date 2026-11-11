import { smoothstep } from '../core/math.ts';

/**
 * Hash-based 3D value noise.
 *
 * Terrain is sampled on the surface of a sphere rather than on a flat rectangle,
 * so continents wrap correctly at the antimeridian and do not pinch at the poles.
 * The hash is stateless: the same lattice point always yields the same value for a
 * given seed, independent of evaluation order.
 */
const hash3 = (seed: number, x: number, y: number, z: number): number => {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const latticeValue = (seed: number, ix: number, iy: number, iz: number): number =>
  hash3(seed, ix, iy, iz) * 2 - 1;

/** 3D value noise in roughly [-1, 1]. */
export const valueNoise3D = (seed: number, x: number, y: number, z: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const tz = smoothstep(z - z0);

  const c000 = latticeValue(seed, x0, y0, z0);
  const c100 = latticeValue(seed, x0 + 1, y0, z0);
  const c010 = latticeValue(seed, x0, y0 + 1, z0);
  const c110 = latticeValue(seed, x0 + 1, y0 + 1, z0);
  const c001 = latticeValue(seed, x0, y0, z0 + 1);
  const c101 = latticeValue(seed, x0 + 1, y0, z0 + 1);
  const c011 = latticeValue(seed, x0, y0 + 1, z0 + 1);
  const c111 = latticeValue(seed, x0 + 1, y0 + 1, z0 + 1);

  const x00 = c000 + (c100 - c000) * tx;
  const x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx;
  const x11 = c011 + (c111 - c011) * tx;
  const y0v = x00 + (x10 - x00) * ty;
  const y1v = x01 + (x11 - x01) * ty;
  return y0v + (y1v - y0v) * tz;
};

/** Fractal brownian motion: layered value noise, normalised to roughly [-1, 1]. */
export const fbm3D = (
  seed: number,
  x: number,
  y: number,
  z: number,
  octaves = 5,
  lacunarity = 2,
  gain = 0.5,
): number => {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    total += amplitude * valueNoise3D(seed + i * 7919, x * frequency, y * frequency, z * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return total / norm;
};

/** Ridged multifractal, useful for mountain chains. Returns roughly [0, 1]. */
export const ridged3D = (
  seed: number,
  x: number,
  y: number,
  z: number,
  octaves = 4,
): number => {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise3D(seed + i * 5851, x * frequency, y * frequency, z * frequency));
    total += amplitude * n * n;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return total / norm;
};
