import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.ts';
import { computeCellAreas, generateTerrain, cellLatLon } from '../src/geo/terrain.ts';
import { computeClimate } from '../src/geo/climate.ts';
import { classifyBiome, BIOMES } from '../src/geo/biomes.ts';

const options = { width: 24, height: 12, oceanFraction: 0.7, radiusKm: 6371 };

test('cell areas sum to the sphere surface', () => {
  const areas = computeCellAreas(24, 12, 6371);
  const total = [...areas].reduce((sum, area) => sum + area, 0);
  const expected = 4 * Math.PI * 6371 * 6371;
  assert.ok(Math.abs(total - expected) / expected < 1e-9);
});

test('terrain generation is deterministic and honours the ocean fraction', () => {
  const a = generateTerrain(new Rng(5), options);
  const b = generateTerrain(new Rng(5), options);
  assert.deepEqual([...a.elevationM], [...b.elevationM]);
  const oceanCount = [...a.isOcean].reduce((sum, value) => sum + value, 0);
  const fraction = oceanCount / a.isOcean.length;
  assert.ok(Math.abs(fraction - 0.7) < 0.08, `ocean fraction ${fraction}`);
  assert.ok(Math.max(...a.elevationM) > 1000);
  assert.ok(Math.min(...a.elevationM) < -1000);
});

test('different seeds produce different worlds', () => {
  const a = generateTerrain(new Rng(1), options);
  const b = generateTerrain(new Rng(2), options);
  assert.notDeepEqual([...a.elevationM], [...b.elevationM]);
});

test('climate computes latitude gradient, biomes and productivity', () => {
  const terrain = generateTerrain(new Rng(9), options);
  const climate = computeClimate(terrain, { meanSurfaceTempC: 14, axialTiltDeg: 23.4, seasonPhase: 0 });
  const equatorial: number[] = [];
  const polar: number[] = [];
  for (let j = 0; j < terrain.height; j++) {
    for (let i = 0; i < terrain.width; i++) {
      const cell = j * terrain.width + i;
      const { latDeg } = cellLatLon(i, j, terrain.width, terrain.height);
      const temp = climate.temperatureC[cell] ?? 0;
      if (Math.abs(latDeg) < 12) equatorial.push(temp);
      if (Math.abs(latDeg) > 65) polar.push(temp);
    }
  }
  const eq = equatorial.reduce((a, b) => a + b, 0) / equatorial.length;
  const pole = polar.reduce((a, b) => a + b, 0) / polar.length;
  assert.ok(eq > pole + 10, `equator ${eq} vs pole ${pole}`);
  assert.ok(climate.landFraction > 0.1 && climate.landFraction < 0.5);
  assert.ok(climate.biomeAreaFraction.ocean > 0.5);
  const landBiomes = new Set(climate.biome.filter((_, cell) => terrain.isOcean[cell] === 0));
  assert.ok(landBiomes.size >= 2);
  assert.ok([...climate.nppKcalPerKm2].some((value) => value > 0));
});

test('climate is colder at elevation on land', () => {
  const terrain = generateTerrain(new Rng(3), options);
  const climate = computeClimate(terrain, { meanSurfaceTempC: 14, axialTiltDeg: 23.4, seasonPhase: 0 });
  const pairs: [number, number][] = [];
  for (let cell = 0; cell < terrain.isOcean.length; cell++) {
    if (terrain.isOcean[cell] === 1) continue;
    const lat = cellLatLon(cell % terrain.width, Math.floor(cell / terrain.width), terrain.width, terrain.height).latDeg;
    if (Math.abs(lat) > 40) continue;
    pairs.push([terrain.elevationM[cell] as number, climate.temperatureC[cell] as number]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const low = pairs[0];
  const high = pairs[pairs.length - 1];
  if (low && high && high[0] - low[0] > 2000) {
    assert.ok(high[1] < low[1], `high ${high[1]} low ${low[1]}`);
  }
});

test('biome classification follows temperature and rainfall', () => {
  assert.equal(classifyBiome(25, 2500, 100, true), 'ocean');
  assert.equal(classifyBiome(26, 2200, 100, false), 'tropicalForest');
  assert.equal(classifyBiome(26, 900, 100, false), 'savanna');
  assert.equal(classifyBiome(26, 100, 100, false), 'desert');
  assert.equal(classifyBiome(-15, 100, 100, false), 'ice');
  assert.equal(classifyBiome(5, 600, 100, false), 'taiga');
  assert.equal(classifyBiome(15, 100, 3000, false), 'mountain');
  assert.ok(BIOMES.savanna.habitability > BIOMES.desert.habitability);
});
