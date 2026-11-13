import test from 'node:test';
import assert from 'node:assert/strict';
import earthlike from '../scenarios/earthlike.ts';
import {
  branchChoice,
  buildFutureHistory,
  eligibleCrises,
  type CrisisContext,
  type FutureHistoryOptions,
  type FutureState,
} from '../src/society/future.ts';
import { World } from '../src/engine/world.ts';

const crisisBaseState: FutureState = {
  population: 1_000,
  surfacePopulation: 1_000,
  orbitalPopulation: 0,
  fertility: 2.1,
  lifeExpectancy: 70,
  literacy: 0.6,
  institutions: 0.6,
  urbanization: 0.4,
  technologyAccess: 0.8,
  energyPerCapita: 10,
  resources: 0.8,
  pollution: 0.1,
  biosphere: 0.8,
  trade: 0.5,
  inequality: 0.3,
  pathBias: 0.5,
};

const stateWith = (overrides: Partial<FutureState>): FutureState => ({
  ...crisisBaseState,
  ...overrides,
});

const crisisContext = (overrides: Partial<CrisisContext> = {}): CrisisContext => ({
  state: stateWith(overrides.state ?? {}),
  known: overrides.known ?? new Set<string>(),
  foodSecurity: 1,
  density: 1,
  unrest: 0.2,
  resourceStress: 0,
  climateStress: 0,
  temperatureC: 20,
  ...overrides,
});

const crisisIds = (overrides: Partial<CrisisContext> = {}): string[] =>
  eligibleCrises(crisisContext(overrides)).map((crisis) => crisis.id);

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
  assert.ok(withOrbitals.orbitalSettlements > 0);
  assert.ok(history.frames.some((frame) => frame.residents.some((resident) => resident.offWorld)));
});

test('crisis conditions follow food, crowding and public health', () => {
  assert.ok(crisisIds({ foodSecurity: 0.5 }).includes('famine'));
  assert.ok(
    !crisisIds({ foodSecurity: 0.5, state: stateWith({ surfacePopulation: 0 }) }).includes('famine'),
    'famine requires a surface population',
  );

  const crowded = { density: 1.5, state: stateWith({ urbanization: 0.5 }) };
  assert.ok(crisisIds(crowded).includes('epidemic'));
  assert.ok(!crisisIds({ ...crowded, density: 1 }).includes('epidemic'));
});

test('crisis conditions follow conflict, depletion and automation', () => {
  const unequal = {
    density: 2,
    state: stateWith({ inequality: 0.6, institutions: 0.5, literacy: 0.6 }),
  };
  assert.ok(crisisIds(unequal).includes('war'));
  assert.ok(crisisIds(unequal).includes('revolution'));
  assert.ok(crisisIds({ resourceStress: 0.8 }).includes('resource bust'));

  const automated = { state: stateWith({ urbanization: 0.5, inequality: 0.5 }) };
  assert.ok(!crisisIds(automated).includes('machine disruption'));
  assert.ok(
    crisisIds({ ...automated, known: new Set(['Artificial intelligence']) }).includes('machine disruption'),
    'machine disruption requires AI',
  );
});

test('crisis conditions follow ecology and prosperity', () => {
  assert.ok(crisisIds({ temperatureC: 32 }).includes('climate shock'));
  assert.ok(crisisIds({ state: stateWith({ biosphere: 0.3 }) }).includes('climate shock'));

  const golden = {
    state: stateWith({ population: 500, surfacePopulation: 500, institutions: 0.8, trade: 0.8, resources: 0.8 }),
    foodSecurity: 1,
  };
  assert.ok(crisisIds(golden).includes('golden age'));
  assert.ok(!crisisIds({ ...golden, foodSecurity: 0.8 }).includes('golden age'));
});

test('technology branch choices follow present conditions', () => {
  const open = { pathBias: 0.9, institutions: 0.8, pollution: 0.4, literacy: 0.9 };

  assert.equal(branchChoice('energy', open), 'Renewable energy');
  assert.equal(
    branchChoice('energy', { ...open, pathBias: 0, institutions: 0, pollution: 0 }),
    'Fossil fuel renaissance',
  );
  assert.equal(branchChoice('governance', open), 'Open information order');
  assert.equal(
    branchChoice('governance', { ...open, pathBias: 0, institutions: 0.1, literacy: 0 }),
    'Centralized automation',
  );
});

test('population splits and settlement counts stay consistent', () => {
  const history = buildFutureHistory(baseOptions);

  for (const frame of history.frames) {
    assert.equal(frame.surfacePopulation + frame.orbitalPopulation, frame.population);
    if (frame.surfacePopulation === 0) {
      assert.equal(frame.settlements, 0, `${frame.year} has no surface settlements`);
    }
  }
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
