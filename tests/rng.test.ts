import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.ts';
import { clamp, mean, pow, stdev } from '../src/core/math.ts';

test('identical seeds produce identical streams', () => {
  const a = new Rng(1234);
  const b = new Rng(1234);
  const first = Array.from({ length: 64 }, () => a.next());
  const second = Array.from({ length: 64 }, () => b.next());
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, Array.from({ length: 64 }, () => new Rng(99).next()));
});

test('forked streams do not depend on how much another stream consumed', () => {
  const a = new Rng(7);
  const b = new Rng(7);
  a.next();
  a.next();
  b.next();
  const fromA = a.fork('terrain').next();
  const fromB = b.fork('terrain').next();
  assert.equal(fromA, fromB);
  assert.notEqual(fromA, new Rng(7).fork('climate').next());
});

test('uniform draws stay in range and cover it', () => {
  const rng = new Rng('range');
  let min = 1;
  let max = 0;
  for (let i = 0; i < 5000; i++) {
    const value = rng.float(2, 5);
    assert.ok(value >= 2 && value < 5);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  assert.ok(min < 2.05);
  assert.ok(max > 4.95);
  for (let i = 0; i < 1000; i++) {
    const value = rng.int(3, 8);
    assert.ok(Number.isInteger(value) && value >= 3 && value < 8);
  }
});

test('normal draws have the requested moments', () => {
  const rng = new Rng('normal');
  const values = Array.from({ length: 20000 }, () => rng.normal(10, 3));
  assert.ok(Math.abs(mean(values) - 10) < 0.15);
  assert.ok(Math.abs(stdev(values) - 3) < 0.15);
});

test('weighted index respects weights and always returns a valid index', () => {
  const rng = new Rng('weights');
  const counts = [0, 0, 0];
  for (let i = 0; i < 9000; i++) {
    const index = rng.weightedIndex([1, 0, 2]);
    counts[index] += 1;
  }
  assert.equal(counts[1], 0);
  assert.ok(counts[2] > counts[0] * 1.5);
  assert.equal(rng.weightedIndex([0, 0]), -1);
});

test('shuffle is deterministic and preserves elements', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const a = new Rng(3).shuffle([...items]);
  const b = new Rng(3).shuffle([...items]);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [...items].sort());
});

test('math helpers behave at the edges', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-1, 0, 1), 0);
  assert.ok(Number.isNaN(mean([])) === false);
  assert.equal(mean([]), 0);
  assert.equal(pow(2, 0), 1);
  assert.equal(pow(2, 3), 8);
  assert.equal(pow(-2, 3), -8);
  assert.ok(Math.abs(pow(9, 0.5) - 3) < 1e-12);
  assert.equal(pow(0, 3), 0);
});
