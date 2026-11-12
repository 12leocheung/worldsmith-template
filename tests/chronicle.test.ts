import test from 'node:test';
import assert from 'node:assert/strict';
import earthlike from '../scenarios/earthlike.ts';
import { World } from '../src/engine/world.ts';
import { renderChronicle } from '../src/engine/chronicle.ts';

test('chronicle snapshots are deterministic and describe the living world', () => {
  const a = new World(earthlike, { ticks: 12 }).run();
  const b = new World(earthlike, { ticks: 12 }).run();

  assert.ok(a.chronicle.snapshots.length >= 2, 'start and end snapshots exist');
  assert.deepEqual(a.chronicle.snapshots, b.chronicle.snapshots);

  const last = a.chronicle.snapshots[a.chronicle.snapshots.length - 1];
  assert.ok(last, 'final snapshot exists');
  assert.equal(last.region.biome.length, last.region.width * last.region.height);
  assert.equal(last.region.population.length, last.region.width * last.region.height);
  assert.ok(last.residents.length > 0, 'residents are sampled');
  for (const resident of last.residents) {
    assert.ok(resident.name.length > 0);
    assert.ok(resident.actionLabel.length > 0);
    assert.ok(resident.health >= 0 && resident.health <= 100);
    assert.ok(resident.energy >= 0 && resident.energy <= 100);
  }
  assert.ok(Array.isArray(a.chronicle.technologies));
  assert.ok(Array.isArray(a.chronicle.theories));
  assert.ok(Array.isArray(a.chronicle.wars));
  assert.ok(Array.isArray(a.chronicle.accidents));
  assert.equal(a.chronicle.deepTime.frames.at(-1)?.year, 10_000_000_000);
  assert.deepEqual(a.chronicle.deepTime, b.chronicle.deepTime);
});

test('the chronicle page embeds the scene, people and ledger data', () => {
  const result = new World(earthlike, { ticks: 4 }).run();
  const html = renderChronicle(result);
  assert.match(html, /id="chronicle-data"/);
  assert.match(html, /id="scene"/);
  assert.match(html, /id="ledger"/);
  assert.ok(html.includes(result.scenario.name));
  assert.ok(html.includes('chronicle'));
  assert.ok(html.includes('deep time'));
  assert.ok(html.includes('10,000,000,000'));
  assert.ok(html.includes('id="techline"'));
  assert.ok(html.includes('2026 technologies'));
});
