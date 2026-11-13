/**
 * Physical constants and unit conversions.
 *
 * The simulation deliberately carries physical units (kg, km, AU, K, kcal, years)
 * instead of normalised 0..1 numbers, so that parameters can be checked against
 * reality and so that cross-scale reasoning stays honest.
 */

import { pow } from './math.ts';

export const AU_KM = 149_597_870.7;
export const SOLAR_MASS_KG = 1.98847e30;
export const SOLAR_LUMINOSITY_W = 3.828e26;
export const EARTH_MASS_KG = 5.9722e24;
export const EARTH_RADIUS_KM = 6371;
export const EARTH_GRAVITY = 9.80665;
export const GRAVITATIONAL_CONSTANT = 6.6743e-11;
export const SECONDS_PER_YEAR = 3.15576e7;
export const DAYS_PER_YEAR = 365.25;
export const SOLAR_GM_KM3_S2 = 1.32712440018e11;
export const STEFAN_BOLTZMANN = 5.670374419e-8;
export const KELVIN_OFFSET = 273.15;

/** Edible energy density of animal tissue, kcal per kg of wet mass (approx. ungulate meat). */
export const KCAL_PER_KG_MEAT = 2000;

/** Edible energy density of plant matter, kcal per kg wet mass (approx. mixed forage). */
export const KCAL_PER_KG_PLANT = 1500;

/** Plant carbon to energy: roughly 9 kcal of biomass energy per gram of carbon fixed. */
export const KCAL_PER_G_CARBON = 9;

/** Convert solar masses to kilograms. */
export const solarToKg = (solar: number): number => solar * SOLAR_MASS_KG;

/** Convert Earth masses to kilograms. */
export const earthToKg = (earth: number): number => earth * EARTH_MASS_KG;

export const kelvinToCelsius = (k: number): number => k - KELVIN_OFFSET;
export const celsiusToKelvin = (c: number): number => c + KELVIN_OFFSET;

/** Kepler's third law in solar units: P[years] = sqrt(a[AU]^3 / M[solar]). */
export const orbitalPeriodYears = (semiMajorAxisAu: number, starMassSolar: number): number =>
  Math.sqrt(pow(semiMajorAxisAu, 3) / Math.max(starMassSolar, 1e-6));
