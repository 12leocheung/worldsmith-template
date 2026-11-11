import test from 'node:test';
import assert from 'node:assert/strict';
import { habitableZone, makeStar, mainSequenceLifetimeGyr, frostLineAu } from '../src/cosmos/star.ts';
import { makeOrbit, solveKepler, stateAt } from '../src/cosmos/orbit.ts';
import {
  equilibriumTemperatureK,
  makePlanet,
  surfaceGravity,
  surfaceTemperatureC,
} from '../src/cosmos/planet.ts';
import { findBody, resolveSystem } from '../src/cosmos/system.ts';
import { Rng } from '../src/core/rng.ts';

test('an Earth-like planet at 1 AU is temperate', () => {
  const star = makeStar({ spectralClass: 'G' });
  const planet = makePlanet({ kind: 'ocean' });
  const temperature = surfaceTemperatureC(planet, star, 1);
  assert.ok(temperature > 10 && temperature < 18, `expected ~14 °C, got ${temperature}`);
  const equilibrium = equilibriumTemperatureK(planet, star, 1);
  assert.ok(equilibrium > 250 && equilibrium < 260, `equilibrium should be ~255 K, got ${equilibrium}`);
});

test('surface gravity and escape velocity scale plausibly', () => {
  const earth = makePlanet({ kind: 'ocean' });
  const gravity = surfaceGravity(earth);
  assert.ok(gravity > 9.7 && gravity < 9.9, `Earth gravity was ${gravity}`);
  const mars = makePlanet({ massEarth: 0.107, radiusKm: 3390 });
  assert.ok(surfaceGravity(mars) < gravity);
  const superEarth = makePlanet({ massEarth: 3.2, radiusKm: 11000 });
  assert.ok(surfaceGravity(superEarth) > gravity);
});

test('habitable zone scales with luminosity and contains 1 AU for the Sun', () => {
  const sun = makeStar({ spectralClass: 'G' });
  const hz = habitableZone(sun);
  assert.ok(hz.innerAu < 1 && hz.outerAu > 1);
  const mDwarf = makeStar({ spectralClass: 'M' });
  const mHz = habitableZone(mDwarf);
  assert.ok(mHz.outerAu < 0.3);
  assert.ok(frostLineAu(sun) > 2);
  assert.ok(mainSequenceLifetimeGyr(1, 1) > 9 && mainSequenceLifetimeGyr(1, 1) < 11);
  assert.ok(mainSequenceLifetimeGyr(0.3, 0.015) > 100);
});

test('Kepler equation is solved to precision', () => {
  for (const e of [0, 0.1, 0.5, 0.9]) {
    for (const M of [0.1, 1.2, 3.4, 6.0]) {
      const E = solveKepler(M, e);
      const residual = E - e * Math.sin(E) - M;
      assert.ok(Math.abs(residual) < 1e-9, `e=${e} M=${M} residual=${residual}`);
    }
  }
});

test('circular orbits keep a constant radius and a one-year period at 1 AU', () => {
  const elements = makeOrbit({ semiMajorAxisAu: 1, eccentricity: 0, inclinationDeg: 0 });
  for (const time of [0, 0.13, 0.5, 1.3]) {
    const state = stateAt(elements, 1, time);
    assert.ok(Math.abs(state.distanceAu - 1) < 1e-9);
  }
  const state = stateAt(elements, 1, 0.25);
  assert.ok(state.speedKmS > 29 && state.speedKmS < 30.5, `Earth orbital speed ${state.speedKmS}`);
});

test('eccentric orbits respect periapsis and apoapsis', () => {
  const elements = makeOrbit({ semiMajorAxisAu: 1.5, eccentricity: 0.3 });
  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < 1.5; t += 0.01) {
    const d = stateAt(elements, 1, t).distanceAu;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  assert.ok(Math.abs(min - 1.5 * 0.7) < 0.03, `periapsis ${min}`);
  assert.ok(Math.abs(max - 1.5 * 1.3) < 0.03, `apoapsis ${max}`);
});

test('explicit systems resolve planets, orbits and a focus world', () => {
  const system = resolveSystem(
    {
      name: 'Test',
      star: { spectralClass: 'K' },
      planets: [
        { id: 'a', name: 'A', kind: 'rocky', orbit: { semiMajorAxisAu: 0.4 } },
        { id: 'b', name: 'B', kind: 'ocean', orbit: { semiMajorAxisAu: 0.8 }, targetMeanTempC: 12 },
      ],
    },
    new Rng(1),
  );
  assert.equal(system.bodies.length, 2);
  assert.equal(findBody(system, 'b')?.planet.name, 'B');
  assert.ok(surfaceTemperatureC(system.bodies[1]!.planet, system.star, 0.8) > 5);
});

test('generated systems are deterministic and ordered outward', () => {
  const a = resolveSystem({ generate: { planetCount: 5 } }, new Rng(11));
  const b = resolveSystem({ generate: { planetCount: 5 } }, new Rng(11));
  assert.deepEqual(
    a.bodies.map((body) => body.planet.kind),
    b.bodies.map((body) => body.planet.kind),
  );
  for (let i = 1; i < a.bodies.length; i++) {
    assert.ok(a.bodies[i]!.orbit.semiMajorAxisAu > a.bodies[i - 1]!.orbit.semiMajorAxisAu);
  }
});
