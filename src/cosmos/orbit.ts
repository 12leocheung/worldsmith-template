import { clamp, deg2rad } from '../core/math.ts';
import { AU_KM, SOLAR_GM_KM3_S2, orbitalPeriodYears } from '../core/units.ts';

/** Classical Keplerian orbital elements, angles in degrees, distances in AU. */
export interface OrbitalElements {
  semiMajorAxisAu: number;
  eccentricity: number;
  inclinationDeg: number;
  longitudeOfAscendingNodeDeg: number;
  argumentOfPeriapsisDeg: number;
  /** Mean anomaly at t = 0, in degrees. */
  meanAnomalyAtEpochDeg: number;
}

export interface OrbitalState {
  /** Heliocentric ecliptic coordinates in AU. */
  x: number;
  y: number;
  z: number;
  distanceAu: number;
  trueAnomalyRad: number;
  eccentricAnomalyRad: number;
  /** Orbital speed in km/s from the vis-viva equation. */
  speedKmS: number;
}

export const DEFAULT_ORBIT: OrbitalElements = {
  semiMajorAxisAu: 1,
  eccentricity: 0.02,
  inclinationDeg: 0,
  longitudeOfAscendingNodeDeg: 0,
  argumentOfPeriapsisDeg: 0,
  meanAnomalyAtEpochDeg: 0,
};

export const makeOrbit = (partial: Partial<OrbitalElements> = {}): OrbitalElements => ({
  ...DEFAULT_ORBIT,
  ...partial,
});

/**
 * Solve Kepler's equation M = E - e sin E with Newton-Raphson.
 * Converges to machine precision for e < 0.95 within a handful of iterations.
 */
export const solveKepler = (meanAnomalyRad: number, eccentricity: number): number => {
  const e = clamp(eccentricity, 0, 0.99);
  let E = e < 0.8 ? meanAnomalyRad : Math.PI;
  for (let i = 0; i < 60; i++) {
    const f = E - e * Math.sin(E) - meanAnomalyRad;
    const fPrime = 1 - e * Math.cos(E);
    const delta = f / fPrime;
    E -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  return E;
};

/** Orbital period in years for the given star mass (solar masses). */
export const periodYears = (elements: Pick<OrbitalElements, 'semiMajorAxisAu'>, starMassSolar: number): number =>
  orbitalPeriodYears(elements.semiMajorAxisAu, starMassSolar);

/** Position and velocity on the orbit at a given time in years. */
export const stateAt = (
  elements: OrbitalElements,
  starMassSolar: number,
  timeYears: number,
): OrbitalState => {
  const a = Math.max(elements.semiMajorAxisAu, 1e-4);
  const e = clamp(elements.eccentricity, 0, 0.95);
  const period = periodYears(elements, starMassSolar);
  const meanAnomaly =
    deg2rad(elements.meanAnomalyAtEpochDeg) + (2 * Math.PI * timeYears) / Math.max(period, 1e-9);
  const eccentricAnomaly = solveKepler(meanAnomaly % (2 * Math.PI), e);
  const trueAnomaly =
    2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(eccentricAnomaly / 2), Math.sqrt(1 - e) * Math.cos(eccentricAnomaly / 2));
  const radius = a * (1 - e * Math.cos(eccentricAnomaly));

  // Position in the orbital plane, then rotate into the ecliptic frame.
  const omega = deg2rad(elements.argumentOfPeriapsisDeg);
  const Omega = deg2rad(elements.longitudeOfAscendingNodeDeg);
  const inc = deg2rad(elements.inclinationDeg);
  const xPlane = radius * Math.cos(trueAnomaly);
  const yPlane = radius * Math.sin(trueAnomaly);

  const x = xPlane * (Math.cos(omega) * Math.cos(Omega) - Math.sin(omega) * Math.sin(Omega) * Math.cos(inc)) -
    yPlane * (Math.sin(omega) * Math.cos(Omega) + Math.cos(omega) * Math.sin(Omega) * Math.cos(inc));
  const y = xPlane * (Math.cos(omega) * Math.sin(Omega) + Math.sin(omega) * Math.cos(Omega) * Math.cos(inc)) +
    yPlane * (Math.cos(omega) * Math.cos(Omega) - Math.sin(omega) * Math.sin(Omega) * Math.cos(inc));
  const z = xPlane * Math.sin(omega) * Math.sin(inc) + yPlane * Math.cos(omega) * Math.sin(inc);

  const speedKmS = Math.sqrt(
    SOLAR_GM_KM3_S2 * Math.max(0, 2 / (radius * AU_KM) - 1 / (a * AU_KM)),
  );

  return {
    x,
    y,
    z,
    distanceAu: radius,
    trueAnomalyRad: trueAnomaly,
    eccentricAnomalyRad: eccentricAnomaly,
    speedKmS,
  };
};

/** Current star-planet distance in AU (shortcut used by the climate layer). */
export const distanceAuAt = (
  elements: OrbitalElements,
  starMassSolar: number,
  timeYears: number,
): number => stateAt(elements, starMassSolar, timeYears).distanceAu;
