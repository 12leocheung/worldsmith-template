/**
 * Deep-time projection for a chronicle.
 *
 * The ecological simulation runs for centuries, not gigayears. This module extends
 * the *timeline* with a deliberately simple astrophysical model: a main-sequence star
 * brightens as it consumes hydrogen, the planet's equilibrium temperature follows
 * Stefan-Boltzmann scaling, and the star leaves the main sequence at the end of its
 * modelled lifetime. It is a projection, not a second ecology: no new people are
 * simulated in these frames.
 *
 * Keeping this separate from `World` makes the assumption explicit and testable.
 */

export interface DeepTimeFrame {
  year: number;
  epoch: string;
  description: string;
  temperatureC: number;
  luminositySolar: number;
  habitable: boolean;
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

/** First log-spaced year at or above a threshold, for dating a crossing. */
const crossingYear = (
  frames: readonly DeepTimeFrame[],
  predicate: (frame: DeepTimeFrame) => boolean,
): number | null => {
  for (const frame of frames) if (predicate(frame)) return frame.year;
  return null;
};

/**
 * Project temperature and stellar state from the end of the simulation to the target
 * horizon. The brightening rate is mass-dependent: a solar-mass star gains roughly
 * 8% luminosity per gigayear, while low-mass stars brighten more slowly.
 */
export const buildDeepTimeProjection = (options: DeepTimeOptions): DeepTimeProjection => {
  const targetYears = options.targetYears ?? 10_000_000_000;
  const startYear = Math.max(1, options.simulationEndYear);
  const frameCount = Math.max(8, options.frameCount ?? 36);
  const lifetimeYears = Math.max(1, options.lifetimeGyr) * 1_000_000_000;
  const baseKelvin = options.baseTempC + KELVIN_OFFSET;
  const orbitAu = Math.max(0.01, options.orbitAu);

  const luminosityAt = (year: number): number => {
    if (year >= lifetimeYears) return Math.max(800, options.luminositySolar * 900);
    const gigayears = year / 1_000_000_000;
    return Math.max(0.1, options.luminositySolar * (1 + 0.08 * options.massSolar * gigayears));
  };

  const temperatureAt = (year: number): number => {
    const ratio = luminosityAt(year) / Math.max(1e-9, options.luminositySolar);
    return baseKelvin * ratio ** 0.25 - KELVIN_OFFSET;
  };

  const epochAt = (year: number, temperatureC: number): string => {
    if (year >= lifetimeYears + 1_000_000_000) return 'Stellar remnant';
    if (year >= lifetimeYears) return 'Red giant';
    if (temperatureC >= 150) return 'Sterile';
    if (temperatureC >= 100) return 'Boiling oceans';
    if (temperatureC >= 47) return 'Runaway greenhouse';
    if (year >= 1_000_000_000) return 'Late main sequence';
    if (year >= 1_000_000) return 'Geological';
    if (year >= 10_000) return 'Near future';
    return 'Historical';
  };

  const descriptionAt = (year: number, temperatureC: number, luminositySolar: number, habitat: boolean): string => {
    if (year >= lifetimeYears + 1_000_000_000) {
      return 'The star has exhausted its core fuel and faded to a compact remnant. The planet is a cold, airless rock.';
    }
    if (year >= lifetimeYears) {
      return 'Core hydrogen is exhausted. The star expands into a red giant and the planet is scorched or engulfed.';
    }
    if (temperatureC >= 150) {
      return `Surface temperature is ${temperatureC.toFixed(0)} °C. Oceans are gone and complex life cannot persist.`;
    }
    if (temperatureC >= 100) {
      return `Surface temperature is ${temperatureC.toFixed(0)} °C. The oceans are boiling away into steam.`;
    }
    if (temperatureC >= 47) {
      return `Surface temperature is ${temperatureC.toFixed(0)} °C. A moist greenhouse is underway; the habitable window is closing.`;
    }
    const trend = habitat ? 'The biosphere remains viable' : 'The surface is outside the habitable window';
    return `${trend}. Stellar luminosity is ${luminositySolar.toFixed(3)} L☉ and the mean surface is ${temperatureC.toFixed(1)} °C.`;
  };

  const frames: DeepTimeFrame[] = [];
  for (let index = 1; index <= frameCount; index++) {
    const fraction = index / frameCount;
    const year = Math.round(startYear * (targetYears / startYear) ** fraction);
    const luminositySolar = luminosityAt(year);
    const temperatureC = temperatureAt(year);
    const habitable = year < lifetimeYears && temperatureC > -20 && temperatureC < 47;
    const epoch = epochAt(year, temperatureC);
    frames.push({
      year,
      epoch,
      description: descriptionAt(year, temperatureC, luminositySolar, habitable),
      temperatureC,
      luminositySolar,
      habitable,
    });
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
    const giantRadiusAu = 1.1 * options.massSolar ** 1.1;
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
