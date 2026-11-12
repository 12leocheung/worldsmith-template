import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeepTimeProjection, deepTimeStateAt } from '../src/cosmos/deep-time.ts';
import earthlike from '../scenarios/earthlike.ts';
import { World } from '../src/engine/world.ts';

test('deep time is deterministic and reaches ten billion years', () => {
  const options = {
    luminositySolar: 1,
    massSolar: 1,
    lifetimeGyr: 10,
    baseTempC: 15,
    orbitAu: 1,
    simulationEndYear: 600,
    targetYears: 10_000_000_000,
  };
  const a = buildDeepTimeProjection(options);
  const b = buildDeepTimeProjection(options);

  assert.deepEqual(a, b);
  assert.equal(a.frames.length, 36);
  assert.equal(a.frames.at(-1)?.year, 10_000_000_000);
  assert.ok((a.frames[0]?.year ?? 0) > 600, 'projection begins after the simulated run');
  for (let i = 1; i < a.frames.length; i++) {
    assert.ok((a.frames[i]?.year ?? 0) > (a.frames[i - 1]?.year ?? 0), 'frame years increase');
  }
});

test('the deep-time projection records the habitable window closing and the star dying', () => {
  const projection = buildDeepTimeProjection({
    luminositySolar: 1,
    massSolar: 1,
    lifetimeGyr: 10,
    baseTempC: 15,
    orbitAu: 1,
    simulationEndYear: 600,
  });
  const titles = projection.events.map((event) => event.title);

  assert.ok(titles.includes('Runaway greenhouse'));
  assert.ok(titles.includes('Oceans evaporate'));
  assert.ok(titles.includes('Biosphere collapses'));
  assert.ok(titles.includes('Star leaves the main sequence'));
  assert.ok(titles.includes('Planet engulfed'));

  const years = projection.events.map((event) => event.year);
  assert.deepEqual(years, [...years].sort((x, y) => x - y), 'events are chronological');

  const last = projection.frames.at(-1);
  assert.ok(last, 'a final frame exists');
  assert.ok(last.temperatureC > 150);
  assert.ok(last.luminositySolar > 100);
  assert.ok(last.epoch === 'Red giant' || last.epoch === 'Stellar remnant');
});

test('a long-lived low-mass star keeps its planet through ten billion years', () => {
  const projection = buildDeepTimeProjection({
    luminositySolar: 0.05,
    massSolar: 0.3,
    lifetimeGyr: 100,
    baseTempC: 5,
    orbitAu: 0.2,
    simulationEndYear: 600,
  });
  const titles = projection.events.map((event) => event.title);

  assert.equal(projection.frames.at(-1)?.year, 10_000_000_000);
  assert.ok(!titles.includes('Star leaves the main sequence'));
  assert.ok(!titles.includes('Planet engulfed'));
  const last = projection.frames.at(-1);
  assert.ok(last && last.temperatureC < 100, 'the slow-brightening star does not boil the planet');
});

test('a low-luminosity star is not artificially overheated by the luminosity floor', () => {
  const state = deepTimeStateAt(
    {
      luminositySolar: 0.015,
      massSolar: 0.3,
      lifetimeGyr: 200,
      baseTempC: 29,
      orbitAu: 0.2,
      simulationEndYear: 300,
    },
    2026,
  );
  assert.ok(state.temperatureC < 40, `expected a temperate M-dwarf surface, got ${state.temperatureC}`);
  assert.ok(state.habitable);
});

test('every generated world carries a deep-time projection ending at ten billion years', () => {
  const result = new World(earthlike, { ticks: 4 }).run();

  assert.equal(result.chronicle.deepTime.targetYears, 10_000_000_000);
  assert.equal(result.chronicle.deepTime.frames.at(-1)?.year, 10_000_000_000);
  assert.ok(result.chronicle.deepTime.events.length > 0);
});
