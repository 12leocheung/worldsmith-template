/**
 * Deep-time projection for a chronicle.
 *
 * The ecological simulation runs for centuries, not gigayears. This module supplies
 * the astrophysical environment for the rest of the timeline: a main-sequence star
 * brightens as it consumes hydrogen, the planet's equilibrium temperature follows
 * Stefan-Boltzmann scaling, and the star leaves the main sequence at the end of its
 * modelled lifetime.
 *
 * The population that lives through these years is simulated separately in
 * `src/society/future.ts`; this module is only the physical stage.
 */

import { pow } from '../core/math.ts';

export interface DeepTimeState {
  luminositySolar: number;
  temperatureC: number;
  habitable: boolean;
  epoch: string;
  description: string;
}

export interface DeepTimeFrame extends DeepTimeState {
  year: number;
}

export interface DeepTimeEvent {
  year: number;
  title: string;
  detail: string;
}

export interface DeepTimeProjection {
  targetYears: number;
  frames: DeepTimeFrame[];
  events: DeepTimeEvent[];
}

export interface DeepTimeOptions {
  /** Current bolometric luminosity in solar units. */
  luminositySolar: number;
  /** Stellar mass in solar masses. */
  massSolar: number;
  /** Main-sequence lifetime from the star model, in gigayears. */
  lifetimeGyr: number;
  /** Simulated mean surface temperature at the end of the historical run. */
  baseTempC: number;
  /** Semi-major axis of the focus planet, in AU. */
  orbitAu: number;
  /** Last simulated year, where the projection begins. */
  simulationEndYear: number;
  /** Target horizon. Default 10 billion years. */
  targetYears?: number;
  /** Number of log-spaced frames. */
  frameCount?: number;
}

const KELVIN_OFFSET = 273.15;

/**
 * Physical state at one future year. Kept public so the future-history model can
 * evaluate the same star and climate at arbitrary dates, including near-future years
 * that are not part of the coarse log-spaced frame set.
 */
export const deepTimeStateAt = (options: DeepTimeOptions, year: number): DeepTimeState => {
  const lifetimeYears = Math.max(1, options.lifetimeGyr) * 1_000_000_000;
  const baseKelvin = options.baseTempC + KELVIN_OFFSET;
  const luminositySolar =
    year >= lifetimeYears
      ? Math.max(800, options.luminositySolar * 900)
      : Math.max(1e-6, options.luminositySolar * (1 + 0.08 * options.massSolar * (year / 1_000_000_000)));
  const ratio = luminositySolar / Math.max(1e-9, options.luminositySolar);
  const temperatureC = baseKelvin * pow(ratio, 0.25) - KELVIN_OFFSET;
  const habitable = year < lifetimeYears && temperatureC > -20 && temperatureC < 47;

  let epoch: string;
  if (year >= lifetimeYears + 1_000_000_000) epoch = 'Stellar remnant';
  else if (year >= lifetimeYears) epoch = 'Red giant';
  else if (temperatureC >= 150) epoch = 'Sterile';
  else if (temperatureC >= 100) epoch = 'Boiling oceans';
  else if (temperatureC >= 47) epoch = 'Runaway greenhouse';
  else if (year >= 1_000_000_000) epoch = 'Late main sequence';
  else if (year >= 1_000_000) epoch = 'Geological';
  else if (year >= 10_000) epoch = 'Near future';
  else epoch = 'Historical';

  let description: string;
  if (year >= lifetimeYears + 1_000_000_000) {
    description = 'The star has exhausted its core fuel and faded to a compact remnant. The planet is a cold, airless rock.';
  } else if (year >= lifetimeYears) {
    description = 'Core hydrogen is exhausted. The star expands into a red giant and the planet is scorched or engulfed.';
  } else if (temperatureC >= 150) {
    description = `Surface temperature is ${temperatureC.toFixed(0)} °C. Oceans are gone and complex life cannot persist.`;
  } else if (temperatureC >= 100) {
    description = `Surface temperature is ${temperatureC.toFixed(0)} °C. The oceans are boiling away into steam.`;
  } else if (temperatureC >= 47) {
    description = `Surface temperature is ${temperatureC.toFixed(0)} °C. A moist greenhouse is underway; the habitable window is closing.`;
  } else {
    const trend = habitable ? 'The biosphere remains viable' : 'The surface is outside the habitable window';
    description = `${trend}. Stellar luminosity is ${luminositySolar.toFixed(3)} L☉ and the mean surface is ${temperatureC.toFixed(1)} °C.`;
  }

  return { luminositySolar, temperatureC, habitable, epoch, description };
};

/** First log-spaced year at or above a threshold, for dating a crossing. */
const crossingYear = (
  frames: readonly DeepTimeFrame[],
  predicate: (frame: DeepTimeFrame) => boolean,
): number | null => {
  for (const frame of frames) if (predicate(frame)) return frame.year;
  return null;
};

/**
 * Build the astrophysical frame set. The brightening rate is mass-dependent: a
 * solar-mass star gains roughly 8% luminosity per gigayear, while low-mass stars
 * brighten more slowly.
 */
export const buildDeepTimeProjection = (options: DeepTimeOptions): DeepTimeProjection => {
  const targetYears = options.targetYears ?? 10_000_000_000;
  const startYear = Math.max(1, options.simulationEndYear);
  const frameCount = Math.max(8, options.frameCount ?? 36);
  const lifetimeYears = Math.max(1, options.lifetimeGyr) * 1_000_000_000;
  const orbitAu = Math.max(0.01, options.orbitAu);

  const frames: DeepTimeFrame[] = [];
  for (let index = 1; index <= frameCount; index++) {
    const fraction = index / frameCount;
    const year = Math.round(startYear * pow(targetYears / startYear, fraction));
    frames.push({ year, ...deepTimeStateAt(options, year) });
  }

  const events: DeepTimeEvent[] = [];
  const greenhouse = crossingYear(frames, (frame) => frame.temperatureC >= 47);
  if (greenhouse !== null) {
    events.push({
      year: greenhouse,
      title: 'Runaway greenhouse',
      detail: 'The surface passes 47 °C and water vapour begins to dominate the atmosphere.',
    });
  }
  const boiling = crossingYear(frames, (frame) => frame.temperatureC >= 100);
  if (boiling !== null) {
    events.push({
      year: boiling,
      title: 'Oceans evaporate',
      detail: 'The surface passes 100 °C; the oceans are lost to space over the following epochs.',
    });
  }
  const sterile = crossingYear(frames, (frame) => frame.temperatureC >= 150);
  if (sterile !== null) {
    events.push({
      year: sterile,
      title: 'Biosphere collapses',
      detail: 'The surface passes 150 °C. Complex life is no longer possible.',
    });
  }
  if (lifetimeYears <= targetYears) {
    events.push({
      year: lifetimeYears,
      title: 'Star leaves the main sequence',
      detail: `Core hydrogen is exhausted after ${options.lifetimeGyr.toFixed(1)} Gyr on the main sequence.`,
    });
    const giantRadiusAu = 1.1 * pow(options.massSolar, 1.1);
    events.push({
      year: lifetimeYears,
      title: orbitAu <= giantRadiusAu ? 'Planet engulfed' : 'Planet scorched',
      detail:
        orbitAu <= giantRadiusAu
          ? 'The red giant envelope reaches the planet’s orbit and the planet is destroyed.'
          : 'The planet survives outside the red giant envelope but its surface is sterilised.',
    });
    if (lifetimeYears + 1_000_000_000 <= targetYears) {
      events.push({
        year: lifetimeYears + 1_000_000_000,
        title: 'Stellar remnant',
        detail: 'The red giant sheds its envelope and leaves a hot, compact remnant that cools for the rest of the timeline.',
      });
    }
  }

  events.sort((a, b) => a.year - b.year);
  return { targetYears, frames, events };
};
