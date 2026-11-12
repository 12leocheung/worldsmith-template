/**
 * Coarse future-history model for the chronicle.
 *
 * The individual-level ecology is deliberately not run for gigayears: that would be
 * both computationally impossible and meaningless without a model of technological
 * civilisation. Instead this module integrates a small state machine from the final
 * simulated year to the stellar horizon:
 *
 *   population, settlements, technology level, and stochastic shocks
 *
 * The rules are intentionally simple and explicit. The same seed always produces the
 * same future; different seeds and different final states produce different histories.
 * Residents shown in a future frame are representatives of that frame's population,
 * not surviving individuals from the historical run.
 */

import { clamp } from '../core/math.ts';
import { Rng } from '../core/rng.ts';
import { deepTimeStateAt, type DeepTimeOptions } from '../cosmos/deep-time.ts';
import type { BiomeId } from '../geo/biomes.ts';
import { personName, settlementName } from './names.ts';

export interface FutureRegion {
  width: number;
  height: number;
  originX: number;
  originY: number;
  centerX: number;
  centerY: number;
  biome: BiomeId[];
  population: number[];
}

export interface FutureResident {
  id: number;
  name: string;
  speciesId: string;
  speciesName: string;
  color: string;
  cell: number;
  action: string;
  actionLabel: string;
  ageYears: number;
  energy: number;
  health: number;
  techs: number;
  known: string[];
  offspring: number;
  sapient: boolean;
  x: number;
  y: number;
}

export interface FutureFrame {
  kind: 'future';
  tick: number;
  year: number;
  epoch: string;
  description: string;
  temperatureC: number;
  luminositySolar: number;
  habitable: boolean;
  era: string;
  techLevel: number;
  /** Concrete technologies visible in this era. */
  technologies: string[];
  population: number;
  settlements: number;
  centerCell: number;
  place: string;
  region: FutureRegion;
  residents: FutureResident[];
}

export interface FutureEvent {
  year: number;
  title: string;
  detail: string;
}

export interface FutureHistory {
  frames: FutureFrame[];
  events: FutureEvent[];
}

export interface FutureSpecies {
  id: string;
  name: string;
  color: string;
  population: number;
  sapient: boolean;
}

export interface FutureHistoryOptions {
  seed: number;
  startYear: number;
  initialPopulation: number;
  initialSettlements: number;
  initialTechnologyCount: number;
  species: readonly FutureSpecies[];
  region: FutureRegion;
  /** Width of the full world map, used to turn region cells into global cells. */
  mapWidth: number;
  centerCell: number;
  place: string;
  deepTime: DeepTimeOptions;
  /** Dates of astrophysical events, included in the projection's frame schedule. */
  deepTimeEvents: readonly { year: number }[];
}

const TECH_ERAS = [
  'Forager bands',
  'Farming villages',
  'Metal and writing',
  'Industrial cities',
  'Networked civilisation',
  'Fusion age',
  'Orbital habitats',
  'Stellar engineers',
  'Post-biological',
] as const;

const TECH_NOTES = [
  'Small bands follow game and seasonal plants.',
  'Cultivation and storage support permanent villages.',
  'Metallurgy, writing and organised states consolidate power.',
  'Steam, electricity and factories reshape the surface.',
  'Global networks and machine computation coordinate production.',
  'Fusion and closed-loop habitats loosen the planet’s limits.',
  'Orbital industry and off-world settlement begin.',
  'The civilisation manipulates its star and solar system directly.',
  'Biological minds are increasingly optional.',
] as const;

interface Shock {
  title: string;
  detail: string;
  factor: number;
}

const SHOCKS: readonly Shock[] = [
  { title: 'Plague', detail: 'A fast-spreading pathogen moves through the settlements.', factor: 0.62 },
  { title: 'War', detail: 'A general war destroys infrastructure and suppresses births.', factor: 0.78 },
  { title: 'Golden age', detail: 'Cheap energy and open exchange raise the carrying capacity.', factor: 1.18 },
  { title: 'Migration', detail: 'A wave of settlement opens new land and new trade routes.', factor: 1.1 },
  { title: 'Machine disruption', detail: 'Automation and artificial agents overturn the labour economy.', factor: 0.68 },
  { title: 'Climate shock', detail: 'A regional climate reversal strains food production.', factor: 0.9 },
];

interface ActionChoice {
  id: string;
  label: string;
}

const ERA_TECHNOLOGIES = [
  ['Fire', 'Stone tools', 'Language'],
  ['Agriculture', 'Pottery', 'Weaving'],
  ['Writing', 'Metallurgy', 'The wheel'],
  ['Steam engines', 'Railways', 'Telegraph', 'Factories'],
  ['Electricity', 'Cars', 'Computers', 'Internet', 'Antibiotics'],
  ['Artificial intelligence (AI)', 'Robotics', 'Fusion power', 'Gene editing', 'Reusable spaceflight'],
  ['Orbital habitats', 'Closed-loop ecology', 'Asteroid mining'],
  ['Stellar engineering', 'Star lifting', 'Interstellar probes'],
  ['Mind uploading', 'Synthetic minds', 'Dyson swarms'],
] as const;

/** The 2026 anchor is deliberately concrete, whatever the coarse era model says. */
const PRESENT_TECHNOLOGIES = [
  'Electricity',
  'Cars',
  'Computers',
  'Internet',
  'Smartphones',
  'Artificial intelligence (AI)',
  'Antibiotics',
] as const;

const SAPIENT_ACTIONS: readonly (readonly ActionChoice[])[] = [
  [{ id: 'forage', label: 'foraging' }, { id: 'teach', label: 'teaching' }, { id: 'socialize', label: 'gathering' }],
  [{ id: 'forage', label: 'farming' }, { id: 'teach', label: 'teaching' }, { id: 'socialize', label: 'trading' }],
  [{ id: 'forage', label: 'farming' }, { id: 'innovate', label: 'building' }, { id: 'teach', label: 'teaching' }],
  [{ id: 'innovate', label: 'working' }, { id: 'socialize', label: 'governing' }, { id: 'rest', label: 'resting' }],
  [{ id: 'innovate', label: 'researching' }, { id: 'socialize', label: 'coordinating' }, { id: 'rest', label: 'resting' }],
  [{ id: 'innovate', label: 'engineering' }, { id: 'explore', label: 'exploring' }, { id: 'teach', label: 'teaching' }],
  [{ id: 'innovate', label: 'building habitats' }, { id: 'explore', label: 'surveying orbits' }, { id: 'teach', label: 'training' }],
  [{ id: 'innovate', label: 'engineering stars' }, { id: 'explore', label: 'expanding' }, { id: 'teach', label: 'archiving' }],
  [{ id: 'innovate', label: 're-engineering minds' }, { id: 'explore', label: 'transcending' }, { id: 'rest', label: 'dormant' }],
];

const ANIMAL_ACTIONS: readonly ActionChoice[] = [
  { id: 'forage', label: 'grazing' },
  { id: 'hunt', label: 'hunting' },
  { id: 'rest', label: 'resting' },
  { id: 'socialize', label: 'herding' },
];

const techLevelFor = (technologyCount: number, sapient: boolean): number =>
  sapient ? clamp(Math.floor(technologyCount / 4), 0, TECH_ERAS.length - 1) : 0;

/** Fraction of the historical carrying capacity still available on the surface. */
const habitatFactor = (temperatureC: number, epoch: string): number => {
  if (epoch === 'Red giant' || epoch === 'Stellar remnant' || epoch === 'Sterile') return 0;
  if (temperatureC >= 150) return 0;
  if (temperatureC >= 100) return 0.03;
  if (temperatureC >= 47) return clamp(1 - (temperatureC - 47) / 60, 0.04, 1);
  if (temperatureC < -20) return 0.25;
  return 1;
};

/** Exact logistic step, so a thousand-year frame and a one-year frame use one rule. */
const logistic = (population: number, capacity: number, rate: number, years: number): number => {
  if (population <= 0 || capacity <= 0) return 0;
  const ratio = capacity / population;
  return capacity / (1 + (ratio - 1) * Math.exp(-rate * years));
};

/** Frame years cover the near future densely enough to include 2026, then go logarithmic. */
const frameYears = (startYear: number, targetYears: number, events: readonly { year: number }[]): number[] => {
  const years = new Set<number>();
  const near = [625, 700, 800, 900, 950, 1000, 1100, 1250, 1400, 1600, 1800, 2026, 2200, 2500, 2800, 3000];
  const relative = [25, 50, 100, 200, 300, 500, 750, 1000].map((offset) => startYear + offset);

  for (const year of [...relative, ...near]) {
    if (year > startYear && year < targetYears) years.add(Math.round(year));
  }
  for (const event of events) {
    if (event.year > startYear && event.year < targetYears) years.add(Math.round(event.year));
  }
  years.add(targetYears);

  const logStart = 3000;
  if (targetYears > logStart) {
    for (let index = 1; index <= 28; index++) {
      years.add(Math.round(logStart * (targetYears / logStart) ** (index / 28)));
    }
  }
  return [...years].sort((a, b) => a - b);
};

const buildResidents = (
  frameIndex: number,
  population: number,
  techLevel: number,
  technologies: readonly string[],
  options: FutureHistoryOptions,
  region: FutureRegion,
  rng: Rng,
): FutureResident[] => {
  if (population <= 0 || options.species.length === 0) return [];

  const cellWeights: { cell: number; weight: number }[] = [];
  for (let index = 0; index < region.population.length; index++) {
    const weight = region.population[index] ?? 0;
    if (weight <= 0) continue;
    const x = index % region.width;
    const y = Math.floor(index / region.width);
    cellWeights.push({ cell: (region.originY + y) * options.mapWidth + (region.originX + x), weight });
  }

  const speciesWeights = options.species.map((species) => Math.max(1, species.population));
  const count = Math.max(1, Math.min(30, Math.round(30 * Math.sqrt(population / Math.max(1, options.initialPopulation)))));
  const residents: FutureResident[] = [];

  for (let index = 0; index < count; index++) {
    const species = options.species[rng.weightedIndex(speciesWeights)] ?? options.species[0];
    if (!species) break;
    const id = 1_000_000 + frameIndex * 100 + index;
    const actionPool = species.sapient
      ? SAPIENT_ACTIONS[Math.min(techLevel, SAPIENT_ACTIONS.length - 1)] ?? SAPIENT_ACTIONS[0]!
      : ANIMAL_ACTIONS;
    const action = actionPool[rng.int(0, actionPool.length)] ?? ANIMAL_ACTIONS[0]!;
    const cellChoice =
      cellWeights.length > 0
        ? cellWeights[rng.weightedIndex(cellWeights.map((entry) => entry.weight))]
        : { cell: options.centerCell };
    const known = species.sapient ? technologies.slice(0, 4) : [];

    residents.push({
      id,
      name: personName(id, species.name, species.sapient),
      speciesId: species.id,
      speciesName: species.name,
      color: species.color,
      cell: cellChoice?.cell ?? options.centerCell,
      action: action.id,
      actionLabel: action.label,
      ageYears: species.sapient ? rng.float(16, 74) : rng.float(1, 14),
      energy: rng.float(45, 100),
      health: rng.float(55, 100),
      techs: species.sapient ? Math.min(99, options.initialTechnologyCount + techLevel * 3) : 0,
      known: [...known],
      offspring: rng.int(0, species.sapient ? 5 : 3),
      sapient: species.sapient,
      x: ((Math.imul(id, 2654435761) >>> 0) % 1000) / 1000,
      y: ((Math.imul(id, 40503) >>> 0) % 1000) / 1000,
    });
  }
  return residents;
};

/**
 * Integrate the post-simulation future. Population follows a logistic carrying
 * capacity set by technology and surface habitability, with seeded shocks. The model
 * is coarse by construction: one step per frame, not one tick per person.
 */
export const buildFutureHistory = (options: FutureHistoryOptions): FutureHistory => {
  const targetYears = options.deepTime.targetYears ?? 10_000_000_000;
  const startYear = Math.max(1, options.startYear);
  const rng = new Rng(`${options.seed}:future:${startYear}:${options.initialPopulation}`, 'future');
  const sapient = options.species.some((species) => species.sapient);
  const years = frameYears(startYear, targetYears, options.deepTimeEvents);
  const events: FutureEvent[] = [];
  const frames: FutureFrame[] = [];

  let population = Math.max(0, options.initialPopulation);
  let techLevel = techLevelFor(options.initialTechnologyCount, sapient);
  let previousYear = startYear;
  const initialPopulation = Math.max(1, options.initialPopulation);
  const dominant = options.species.slice().sort((a, b) => b.population - a.population)[0];

  years.forEach((year, frameIndex) => {
    const deltaYears = Math.max(1, year - previousYear);
    const state = deepTimeStateAt(options.deepTime, year);
    const wasPopulated = population > 0;
    const presentDay = year === 2026 && sapient;

    if (population > 0 && sapient && techLevel < TECH_ERAS.length - 1) {
      const progressChance = clamp(deltaYears / 500, 0, 0.6);
      if (rng.chance(progressChance)) {
        techLevel += 1;
        events.push({
          year,
          title: `${TECH_ERAS[techLevel]} begins`,
          detail: TECH_NOTES[techLevel] ?? '',
        });
      }
    }

    if (presentDay && techLevel < 4) techLevel = 4;
    const technologies = !sapient
      ? []
      : presentDay
        ? [...PRESENT_TECHNOLOGIES]
        : [...(ERA_TECHNOLOGIES[Math.min(techLevel, ERA_TECHNOLOGIES.length - 1)] ?? ERA_TECHNOLOGIES[0])];

    const carrier = Math.max(0, initialPopulation * (1.1 + 0.55 * techLevel) * habitatFactor(state.temperatureC, state.epoch));
    let nextPopulation = carrier > 0 && population > 0 ? logistic(population, carrier, 0.0009, deltaYears) : 0;

    if (nextPopulation > 0) {
      const shockChance = clamp(deltaYears / 500, 0, 0.55);
      if (rng.chance(shockChance)) {
        const shock = rng.pick(SHOCKS);
        const before = nextPopulation;
        nextPopulation = clamp(nextPopulation * shock.factor, 20, carrier * 1.15);
        events.push({
          year,
          title: `${shock.title} at ${options.place}`,
          detail: `${Math.round(before).toLocaleString('en-US')} → ${Math.round(nextPopulation).toLocaleString('en-US')} people. ${shock.detail}`,
        });
      }
      if (nextPopulation < 20) nextPopulation = Math.min(carrier, 20);
    }

    if (wasPopulated && nextPopulation <= 0) {
      events.push({
        year,
        title: 'The last surface settlements fail',
        detail: `The surface is no longer habitable. ${state.description}`,
      });
    }

    population = Math.max(0, Math.round(nextPopulation));
    const settlements = population > 0
      ? Math.max(1, Math.round(options.initialSettlements * (population / initialPopulation) ** 0.55))
      : 0;
    const scale = options.initialPopulation > 0 ? population / options.initialPopulation : 0;
    const region: FutureRegion = {
      ...options.region,
      population: options.region.population.map((count) => Math.max(0, Math.round(count * scale))),
    };
    const era = population > 0
      ? (sapient ? (presentDay ? TECH_ERAS[4] : TECH_ERAS[techLevel] ?? TECH_ERAS[0]) : 'Wild biosphere')
      : 'Silent world';
    const presentDetail = presentDay
      ? 'Cars, computers, the internet and artificial intelligence are part of daily life. '
      : '';
    const description = population > 0
      ? `${era}: ${population.toLocaleString('en-US')} people across ${settlements.toLocaleString('en-US')} settlements. ${presentDetail}${state.description}`
      : `${state.description} No settlements remain.`;

    frames.push({
      kind: 'future',
      tick: 0,
      year,
      epoch: state.epoch,
      description,
      temperatureC: state.temperatureC,
      luminositySolar: state.luminositySolar,
      habitable: state.habitable,
      era,
      techLevel,
      technologies,
      population,
      settlements,
      centerCell: options.centerCell,
      place: settlementName(options.centerCell, options.seed),
      region,
      residents: population > 0 ? buildResidents(frameIndex, population, techLevel, technologies, options, region, rng) : [],
    });
    previousYear = year;
  });

  const present = frames.find((frame) => frame.year === 2026);
  if (present && present.population > 0) {
    events.push({
      year: 2026,
      title: 'The present day',
      detail: `${dominant?.name ?? 'The dominant lineage'} descendants are still alive; cars, computers, the internet and artificial intelligence are part of daily life. The projection continues past the simulated centuries.`,
    });
  }

  const seen = new Set<string>();
  const uniqueEvents = events
    .filter((event) => {
      const key = `${event.year}:${event.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

  return { frames, events: uniqueEvents };
};
