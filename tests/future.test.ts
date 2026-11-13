import test from 'node:test';
import assert from 'node:assert/strict';
import earthlike from '../scenarios/earthlike.ts';
import { buildFutureHistory, type FutureHistoryOptions } from '../src/society/future.ts';
import { World } from '../src/engine/world.ts';

const baseOptions: FutureHistoryOptions = {
  seed: 42,
  startYear: 600,
  initialPopulation: 5_000,
  initialSettlements: 200,
  initialTechnologies: [
    'Fire',
    'Stone tools',
    'Language',
    'Cooking',
    'Clothing and shelter',
    'Agriculture',
    'Animal husbandry',
    'Pottery',
    'Writing',
    'Metallurgy',
    'Mathematics',
    'Sanitation',
    'Medicine',
    'Printing',
  ],
  species: [{ id: 'human', name: 'Human', color: '#f2c14e', population: 5_000, sapient: true }],
  region: {
    width: 3,
    height: 2,
    originX: 0,
    originY: 0,
    centerX: 1,
    centerY: 1,
    biome: ['grassland', 'grassland', 'grassland', 'grassland', 'temperateForest', 'temperateForest'],
    population: [10, 20, 30, 40, 50, 60],
  },
  mapWidth: 3,
  centerCell: 4,
  place: 'Testbrook',
  deepTime: {
    luminositySolar: 1,
    massSolar: 1,
    lifetimeGyr: 10,
    baseTempC: 14,
    orbitAu: 1,
    simulationEndYear: 600,
    targetYears: 10_000_000_000,
  },
  deepTimeEvents: [{ year: 6_300_000_000 }],
};

test('future history is deterministic and populated past the historical run', () => {
  const a = buildFutureHistory(baseOptions);
  const b = buildFutureHistory(baseOptions);

  assert.deepEqual(a, b);
  assert.equal(a.frames.at(-1)?.year, 10_000_000_000);
  const at950 = a.frames.find((frame) => frame.year === 950);
  assert.ok(at950, 'the first future frame after the old cutoff exists');
  assert.ok((at950?.population ?? 0) > 0, 'people do not vanish at the old boundary');
  assert.ok((at950?.residents.length ?? 0) > 0, 'the frame has named residents');

  const present = a.frames.find((frame) => frame.year === 2026);
  assert.ok(present, '2026 is explicitly represented');
  assert.ok((present?.population ?? 0) > 0);
  assert.ok((present?.residents.length ?? 0) > 0);
  assert.ok(present?.technologies.includes('Printing'), 'starts from the historical knowledge set');
  assert.ok(a.events.some((event) => event.title.endsWith(' discovered')), 'technologies are discovered, not assigned');
  assert.ok((present?.technologies.length ?? 0) > 0);
});

test('future technology rises monotonically and frames keep their residents', () => {
  const history = buildFutureHistory(baseOptions);
  for (let index = 0; index < history.frames.length; index++) {
    const frame = history.frames[index]!;
    if (index > 0) {
      assert.ok(frame.techLevel >= history.frames[index - 1]!.techLevel, 'technology does not go backwards');
      assert.ok(frame.technologies.length >= history.frames[index - 1]!.technologies.length, 'knowledge does not go backwards');
    }
    if (frame.population > 0) {
      assert.ok(frame.residents.length > 0, 'a populated frame has residents');
      assert.ok(frame.residents.every((resident) => resident.name.length > 0));
    }
  }
});

test('a small, low-knowledge world is not handed 2026 technologies', () => {
  const history = buildFutureHistory({
    ...baseOptions,
    initialPopulation: 50,
    initialSettlements: 2,
    initialTechnologies: ['Stone tools'],
    species: [{ id: 'human', name: 'Human', color: '#f2c14e', population: 50, sapient: true }],
  });
  const present = history.frames.find((frame) => frame.year === 2026);

  assert.ok(present, '2026 still exists as a date');
  assert.ok((present?.population ?? 0) > 0);
  assert.ok(!present?.technologies.includes('Computers'));
  assert.ok(!present?.technologies.includes('Artificial intelligence'));
  assert.ok(!present?.technologies.includes('Cars'));
});

test('society tracks demographic change, adoption, resources and off-world settlement', () => {
  const history = buildFutureHistory(baseOptions);
  const present = history.frames.find((frame) => frame.year === 2026);

  assert.ok(present);
  assert.ok(present.fertility < 4.6, 'fertility falls during the demographic transition');
  assert.ok(present.literacy > 0 && present.literacy <= 1);
  assert.ok(present.technologyAccess > 0 && present.technologyAccess <= 1);
  assert.ok(present.energyPerCapita > 0);
  assert.ok(present.resourceStock >= 0 && present.resourceStock <= 1);
  assert.ok(present.pollution >= 0 && present.pollution <= 1);
  assert.ok(present.biosphereHealth >= 0 && present.biosphereHealth <= 1);
  assert.ok(present.foodPerCapita >= 0 && present.foodPerCapita <= 1.2);
  const ageShare = present.ageStructure.children + present.ageStructure.working + present.ageStructure.elders;
  assert.ok(Math.abs(ageShare - 1) < 1e-9, 'age shares sum to one');

  const withOrbitals = history.frames.find((frame) => frame.orbitalPopulation > 0);
  assert.ok(withOrbitals, 'orbital population appears once habitats exist');
  assert.ok(withOrbitals.technologies.includes('Orbital habitats'));
  assert.ok(withOrbitals.orbitalPopulation <= withOrbitals.population);
  assert.ok(history.frames.some((frame) => frame.residents.some((resident) => resident.offWorld)));
});

test('technology paths are mutually exclusive and recorded', () => {
  const history = buildFutureHistory(baseOptions);
  const energy = ['Renewable energy', 'Fossil fuel renaissance'];
  const governance = ['Open information order', 'Centralized automation'];

  assert.ok(history.frames.some((frame) => frame.branches.length > 0), 'at least one path is chosen');
  for (const frame of history.frames) {
    assert.ok(frame.branches.filter((name) => energy.includes(name)).length <= 1);
    assert.ok(frame.branches.filter((name) => governance.includes(name)).length <= 1);
  }
});

test('machine disruption cannot happen before artificial intelligence', () => {
  const history = buildFutureHistory(baseOptions);
  const ai = history.events.find((event) => event.title === 'Artificial intelligence discovered');
  const disruptions = history.events.filter((event) => event.title.startsWith('Machine disruption'));

  for (const disruption of disruptions) {
    assert.ok(ai, 'machine disruption requires AI to exist');
    assert.ok(disruption.year >= ai.year, 'machine disruption cannot predate AI');
  }
  assert.ok(!history.events.some((event) => event.year === 625 && event.title.startsWith('Machine disruption')));
});

test('different seeds produce different futures', () => {
  const a = buildFutureHistory(baseOptions);
  const b = buildFutureHistory({ ...baseOptions, seed: 43 });
  const populationsA = a.frames.map((frame) => frame.population);
  const populationsB = b.frames.map((frame) => frame.population);

  assert.notDeepEqual(populationsA, populationsB);
  assert.notDeepEqual(a.events, b.events);
});

test('a generated world records a populated future including 2026', () => {
  const result = new World(earthlike, { ticks: 4 }).run();
  const future = result.chronicle.future;

  assert.equal(future.frames.at(-1)?.year, 10_000_000_000);
  assert.ok(future.frames.some((frame) => frame.year === 2026 && frame.population > 0));
  assert.ok(future.events.some((event) => event.title.endsWith(' discovered')));
});
