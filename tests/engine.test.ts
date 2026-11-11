import test from 'node:test';
import assert from 'node:assert/strict';
import earthlike from '../scenarios/earthlike.ts';
import medullaLess from '../scenarios/medulla-less.ts';
import closeWorld from '../scenarios/close-orbiting-world.ts';
import hypercognitive from '../scenarios/hypercognitive.ts';
import { World } from '../src/engine/world.ts';
import { validateScenario } from '../src/engine/scenario.ts';
import { ALL_TECH_MASK, availableTechnologies, hasTech, techEffects, TECHNOLOGIES } from '../src/society/technology.ts';
import { renderMarkdown } from '../src/engine/report.ts';

test('identical scenario and seed reproduce the same digest', () => {
  const a = new World(earthlike, { ticks: 10 }).run();
  const b = new World(earthlike, { ticks: 10 }).run();
  assert.equal(a.digest, b.digest);
  assert.equal(a.summary.finalPopulation, b.summary.finalPopulation);
  assert.deepEqual(a.series.population, b.series.population);
});

test('a different seed produces different terrain and history', () => {
  const a = new World(earthlike, { ticks: 6 }).run();
  const b = new World(earthlike, { ticks: 6, seed: 43 }).run();
  assert.notEqual(a.digest, b.digest);
});

test('a heritable medulla-less lineage goes extinct while the ecosystem continues', () => {
  const result = new World(medullaLess, { ticks: 30 }).run();
  const humans = result.species.find((species) => species.id === 'medulla-less');
  assert.ok(humans, 'focal species present in result');
  assert.equal(humans.extinct, true);
  assert.ok(result.events.some((event) => event.kind === 'extinction'));
  assert.ok(result.species.some((species) => species.id !== 'medulla-less' && !species.extinct));
});

test('a tidally locked M-dwarf world initialises and can run', () => {
  const world = new World(closeWorld, { ticks: 4 });
  assert.ok(world.star.spectralClass === 'M');
  assert.ok(world.focusBody.orbit.semiMajorAxisAu < 0.2);
  assert.ok(world.climate.meanTempC > 18);
  const result = world.run();
  assert.ok(result.summary.initialPopulation > 0);
  assert.equal(result.focusPlanet.kind, 'ocean');
});

test('the hypercognitive race keeps its expanded brain and higher cognition', () => {
  const result = new World(hypercognitive, { ticks: 30 }).run();
  const hyper = result.species.find((species) => species.id === 'hyper-human');
  assert.ok(hyper && hyper.finalPopulation > 0, 'hypercognitive population persists');
  assert.ok(hyper.meanGenome.brainMassKg > 2.1, `brain mass ${hyper.meanGenome.brainMassKg}`);
  assert.ok(hyper.meanCognition > 1.4, `cognition ${hyper.meanCognition}`);
});

test('a report renders and contains the key sections', () => {
  const result = new World(earthlike, { ticks: 4 }).run();
  const markdown = renderMarkdown(result);
  assert.match(markdown, /## Physical setting/);
  assert.match(markdown, /## Species/);
  assert.match(markdown, /Interpretation notes/);
  assert.ok(markdown.includes(result.digest));
});

test('technology prerequisites are enforced', () => {
  const available = availableTechnologies(0).map((tech) => tech.id);
  assert.ok(available.includes('fire'));
  assert.ok(available.includes('language'));
  assert.ok(!available.includes('agriculture'));
  const withFire = techEffects(1 << TECHNOLOGIES.findIndex((tech) => tech.id === 'fire'));
  assert.ok(withFire.foodYield > 0);
  assert.ok(hasTech(ALL_TECH_MASK, 'genetics'));
  assert.equal(availableTechnologies(ALL_TECH_MASK).length, 0);
});

test('invalid scenarios are rejected with useful messages', () => {
  assert.throws(
    () =>
      validateScenario({
        name: 'bad',
        description: '',
        world: {},
        species: [],
        run: { ticks: 0, yearsPerTick: 0 },
      }),
    /at least one species/,
  );
  assert.throws(
    () =>
      validateScenario({
        name: 'bad intervention',
        description: '',
        world: {},
        species: [{ id: 'x', name: 'X', kind: 'custom', description: '', color: '#fff' }],
        run: { ticks: 10, yearsPerTick: 1 },
        interventions: [{ atTick: 2, kind: 'ablateRegion', regionId: 'nonsense' }],
      }),
    /unknown brain region/,
  );
});
