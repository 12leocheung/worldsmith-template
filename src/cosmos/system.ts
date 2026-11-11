import { Rng } from '../core/rng.ts';
import { clamp } from '../core/math.ts';
import { makeOrbit, type OrbitalElements } from './orbit.ts';
import {
  equilibriumTemperatureK,
  makePlanet,
  orbitalYearDays,
  surfaceGravity,
  surfaceTemperatureC,
  type Moon,
  type Planet,
  type PlanetKind,
  type PlanetOptions,
} from './planet.ts';
import { frostLineAu, habitableZone, makeStar, sampleSpectralClass, type Star, type StarOptions } from './star.ts';

/** A planet plus the orbit it follows. Kept separate so planets stay reusable as data. */
export interface SystemBody {
  planet: Planet;
  orbit: OrbitalElements;
}

export interface StarSystem {
  name: string;
  star: Star;
  bodies: SystemBody[];
}

export interface PlanetSpec extends PlanetOptions {
  orbit?: Partial<OrbitalElements>;
  /** Optional: set the mean surface temperature instead of guessing greenhouse strength. */
  targetMeanTempC?: number;
}

export interface SystemSpec {
  name?: string;
  star?: StarOptions;
  /** Generate a plausible system instead of listing planets explicitly. */
  generate?: { planetCount?: number; seedLabel?: string };
  planets?: PlanetSpec[];
}

const randomMoon = (rng: Rng, planetRadiusKm: number, index: number): Moon => {
  const radiusKm = Math.max(80, planetRadiusKm * rng.float(0.02, 0.12));
  const distanceKm = planetRadiusKm * rng.float(3, 20) + radiusKm;
  return {
    name: `Moon-${index + 1}`,
    massEarth: (radiusKm / 6371) ** 3 * 0.4,
    radiusKm,
    distanceKm,
    // Kepler's third law around the planet, in Earth masses (approximation).
    orbitalPeriodDays: 0.4 * Math.sqrt(distanceKm ** 3 / Math.max(radiusKm, 1)),
  };
};

const randomPlanetSpec = (rng: Rng, distanceAu: number, star: Star, name: string): PlanetSpec => {
  const hz = habitableZone(star);
  const frost = frostLineAu(star);
  const roll = rng.next();
  let kind: PlanetKind;
  if (distanceAu < hz.innerAu * 0.8) {
    kind = roll < 0.55 ? 'rocky' : 'desert';
  } else if (distanceAu <= hz.outerAu) {
    kind = roll < 0.55 ? 'ocean' : roll < 0.8 ? 'superEarth' : 'desert';
  } else if (distanceAu < frost * 1.6) {
    kind = roll < 0.4 ? 'ice' : roll < 0.75 ? 'rocky' : 'gasGiant';
  } else {
    kind = roll < 0.7 ? 'gasGiant' : 'ice';
  }

  const spec: PlanetSpec = {
    name,
    kind,
    orbit: {
      semiMajorAxisAu: distanceAu,
      eccentricity: rng.float(0, 0.12),
      inclinationDeg: rng.float(-3, 3),
      longitudeOfAscendingNodeDeg: rng.float(0, 360),
      argumentOfPeriapsisDeg: rng.float(0, 360),
      meanAnomalyAtEpochDeg: rng.float(0, 360),
    },
  };

  if (kind !== 'gasGiant') {
    spec.rotationHours = rng.float(8, 60);
    spec.axialTiltDeg = rng.float(0, 35);
    const moonCount = rng.int(0, 3);
    spec.moons = Array.from({ length: moonCount }, (_, i) =>
      randomMoon(rng, makePlanet(spec).radiusKm, i),
    );
  }

  // Keep habitable-zone rocky worlds habitable rather than accidentally boiling.
  if ((kind === 'ocean' || kind === 'superEarth') && distanceAu <= hz.outerAu) {
    spec.targetMeanTempC = rng.float(0, 24);
  }

  return spec;
};

/**
 * Resolve a system specification into concrete data.
 *
 * Explicit planets win. Otherwise `generate` (or the default) samples a plausible
 * system: a random main-sequence star, planets spaced by a geometric ratio, small
 * eccentricities, and one habitable world when possible.
 */
export const resolveSystem = (spec: SystemSpec | undefined, rng: Rng): StarSystem => {
  const starRng = rng.fork('star');
  const starOptions: StarOptions = spec?.star ?? {
    spectralClass: sampleSpectralClass(starRng),
  };
  if (!starOptions.name && spec?.name) starOptions.name = `${spec.name} Prime`;
  const star = makeStar(starOptions);
  const systemName = spec?.name ?? `${star.name} system`;

  const planetsSpec = spec?.planets;
  if (planetsSpec && planetsSpec.length > 0) {
    return {
      name: systemName,
      star,
      bodies: planetsSpec.map((planetSpec, index) => {
        const bodyRng = rng.fork(`planet:${index}`);
        const orbit = makeOrbit(planetSpec.orbit);
        const planet = makePlanet({ ...planetSpec, name: planetSpec.name ?? `Planet ${index + 1}` });
        if (planetSpec.targetMeanTempC !== undefined) {
          tuneGreenhouseForTemperature(bodyRng, planet, star, orbit.semiMajorAxisAu, planetSpec.targetMeanTempC);
        }
        if (planetSpec.id === undefined) planet.id = `planet-${index + 1}`;
        return { planet, orbit };
      }),
    };
  }

  const count = clamp(spec?.generate?.planetCount ?? rng.int(3, 7), 1, 12);
  const generationRng = rng.fork(spec?.generate?.seedLabel ?? 'default-generation');
  const hz = habitableZone(star);
  let distance = hz.innerAu * generationRng.float(0.35, 0.6);
  const bodies: SystemBody[] = [];
  for (let i = 0; i < count; i++) {
    const planetSpec = randomPlanetSpec(generationRng, distance, star, `Planet ${i + 1}`);
    const orbit = makeOrbit(planetSpec.orbit);
    const planet = makePlanet({ ...planetSpec, id: `planet-${i + 1}` });
    if (planetSpec.targetMeanTempC !== undefined) {
      tuneGreenhouseForTemperature(generationRng, planet, star, distance, planetSpec.targetMeanTempC);
    }
    bodies.push({ planet, orbit });
    distance *= generationRng.float(1.35, 1.95);
  }

  return { name: systemName, star, bodies };
};

/**
 * Solve the greenhouse parameter that produces a desired mean surface temperature:
 * T_surf = T_eq * (1 + g)^0.25  =>  g = (T_target / T_eq)^4 - 1.
 */
export const tuneGreenhouseForTemperature = (
  rng: Rng,
  planet: Planet,
  star: Star,
  distanceAu: number,
  targetMeanTempC: number,
): void => {
  const equilibrium = equilibriumTemperatureK(planet, star, distanceAu);
  if (equilibrium <= 0) return;
  const targetK = targetMeanTempC + 273.15;
  const greenhouse = (targetK / equilibrium) ** 4 - 1;
  planet.greenhouse = clamp(greenhouse + rng.float(-0.02, 0.02), 0, 30);
};

/** Find a body by planet id or name. */
export const findBody = (system: StarSystem, idOrName: string): SystemBody | undefined =>
  system.bodies.find((b) => b.planet.id === idOrName || b.planet.name === idOrName);

/** Human-readable one-line summary used by the CLI and reports. */
export const describeBody = (system: StarSystem, body: SystemBody): string => {
  const { planet, orbit } = body;
  const distance = orbit.semiMajorAxisAu;
  const temp = surfaceTemperatureC(planet, system.star, distance);
  const yearDays = orbitalYearDays(distance, system.star.massSolar);
  return (
    `${planet.name} (${planet.kind}) at ${distance.toFixed(2)} AU, year ${yearDays.toFixed(0)} d, ` +
    `mean ${temp.toFixed(1)} °C, gravity ${(surfaceGravity(planet)).toFixed(2)} m/s²`
  );
};

