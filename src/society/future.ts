/**
 * Coarse future-history model for the chronicle.
 *
 * The individual-level ecology is deliberately not run for gigayears. Instead this
 * module integrates a small state machine from the final simulated year to the stellar
 * horizon:
 *
 *   population, settlements, known technologies, research, and stochastic shocks
 *
 * Technology is discovered, not assigned by date. Each frame contributes research
 * proportional to the living population and the current era. When a technology's
 * research threshold is crossed it is added to the known set and gets a discovery
 * event at the estimated year. Different worlds therefore reach cars, computers, AI
 * or orbital habitats at different dates — or never.
 *
 * The same seed always produces the same future. Residents shown in a future frame
 * are representatives of that frame's population, not surviving individuals from the
 * historical run.
 */

import { clamp } from '../core/math.ts';
import { Rng } from '../core/rng.ts';
import { deepTimeStateAt, type DeepTimeOptions } from '../cosmos/deep-time.ts';
import type { BiomeId } from '../geo/biomes.ts';
import { TECH_BY_ID, TECHNOLOGIES } from './technology.ts';
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
  /** Every technology this world has actually learned, in discovery order. */
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
  /** Technologies known at the end of the historical simulation. */
  initialTechnologies: readonly string[];
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

interface TechnologyStep {
  name: string;
  era: number;
  cost: number;
  requires: string[];
  detail: string;
}

/** Era reached by each technology in the original tree. */
const historicalEra = (id: string): number => {
  if (['fire', 'stoneTools', 'language', 'cooking', 'clothing'].includes(id)) return 0;
  if (['agriculture', 'animalHusbandry', 'pottery'].includes(id)) return 1;
  if (['writing', 'metallurgy', 'mathematics', 'sanitation', 'medicine', 'printing'].includes(id)) return 2;
  if (['steamPower', 'germTheory', 'electricity', 'scientificMethod'].includes(id)) return 3;
  if (['computing', 'genetics'].includes(id)) return 4;
  return 3;
};

/**
 * The historical tree plus technologies that only appear after the simulated
 * centuries. Costs are in research units; they are calibrated so a populous
 * industrial world can reach the information age in roughly a millennium, while a
 * small or unlucky world may never get there before its star changes.
 */
const HISTORICAL_TECHNOLOGIES: TechnologyStep[] = TECHNOLOGIES.map((tech, index) => ({
  name: tech.name,
  era: historicalEra(tech.id),
  cost: 300 + index * 50,
  requires: tech.requires.map((id) => TECH_BY_ID.get(id)?.name ?? id),
  detail: tech.description,
}));

const FUTURE_TECHNOLOGIES: TechnologyStep[] = [
  {
    name: 'Cars',
    era: 4,
    cost: 900,
    requires: ['Steam power', 'Metallurgy'],
    detail: 'Private motor vehicles and paved roads shrink distance for ordinary people.',
  },
  {
    name: 'Telephones',
    era: 4,
    cost: 950,
    requires: ['Electricity'],
    detail: 'Voice travels along wires in real time.',
  },
  {
    name: 'Flight',
    era: 4,
    cost: 1_000,
    requires: ['Cars'],
    detail: 'Powered aircraft make intercontinental travel routine.',
  },
  {
    name: 'Antibiotics',
    era: 4,
    cost: 1_050,
    requires: ['Germ theory', 'Medicine'],
    detail: 'Bacterial infections become treatable; childhood survival rises sharply.',
  },
  {
    name: 'Radio',
    era: 4,
    cost: 1_100,
    requires: ['Electricity', 'Telephones'],
    detail: 'Broadcast signals carry news, music and propaganda without wires.',
  },
  {
    name: 'Transistors',
    era: 4,
    cost: 1_150,
    requires: ['Radio'],
    detail: 'Miniature solid-state switches make cheap electronic computation possible.',
  },
  {
    name: 'Computers',
    era: 4,
    cost: 1_200,
    requires: ['Computing', 'Transistors'],
    detail: 'General-purpose digital machines become tools of daily work.',
  },
  {
    name: 'Internet',
    era: 4,
    cost: 1_400,
    requires: ['Computers', 'Transistors'],
    detail: 'A global packet network links computers, archives and people.',
  },
  {
    name: 'Artificial intelligence',
    era: 4,
    cost: 1_600,
    requires: ['Internet', 'Computers'],
    detail: 'Machine learning systems become useful collaborators rather than calculators.',
  },
  {
    name: 'Robotics',
    era: 4,
    cost: 1_800,
    requires: ['Artificial intelligence'],
    detail: 'Machines perform physical work with limited supervision.',
  },
  {
    name: 'Fusion power',
    era: 5,
    cost: 2_000,
    requires: ['Electricity', 'Computing'],
    detail: 'Controlled fusion supplies dense, low-carbon energy.',
  },
  {
    name: 'Gene editing',
    era: 5,
    cost: 2_200,
    requires: ['Genetics', 'Computing'],
    detail: 'Precise heritable changes become a routine medical technology.',
  },
  {
    name: 'Reusable spaceflight',
    era: 5,
    cost: 2_400,
    requires: ['Fusion power', 'Robotics'],
    detail: 'Orbital launch becomes cheap enough for industry and settlement.',
  },
  {
    name: 'Orbital habitats',
    era: 6,
    cost: 2_800,
    requires: ['Reusable spaceflight'],
    detail: 'Large closed habitats support permanent populations off the surface.',
  },
  {
    name: 'Asteroid mining',
    era: 6,
    cost: 3_000,
    requires: ['Reusable spaceflight'],
    detail: 'Volatiles and metals from small bodies feed orbital industry.',
  },
  {
    name: 'Closed-loop ecology',
    era: 6,
    cost: 3_200,
    requires: ['Orbital habitats'],
    detail: 'Artificial ecosystems recycle air, water and nutrients indefinitely.',
  },
  {
    name: 'Stellar engineering',
    era: 7,
    cost: 3_800,
    requires: ['Fusion power', 'Orbital habitats'],
    detail: 'The civilisation begins to alter the output of its star.',
  },
  {
    name: 'Star lifting',
    era: 7,
    cost: 4_200,
    requires: ['Stellar engineering'],
    detail: 'Material is extracted from the star itself.',
  },
  {
    name: 'Interstellar probes',
    era: 7,
    cost: 4_600,
    requires: ['Reusable spaceflight'],
    detail: 'The first artificial objects reach another star system.',
  },
  {
    name: 'Mind uploading',
    era: 8,
    cost: 5_200,
    requires: ['Artificial intelligence', 'Computing'],
    detail: 'Minds can be copied or run outside a biological body.',
  },
  {
    name: 'Synthetic minds',
    era: 8,
    cost: 5_600,
    requires: ['Mind uploading'],
    detail: 'New minds are designed rather than born.',
  },
  {
    name: 'Dyson swarms',
    era: 8,
    cost: 6_200,
    requires: ['Stellar engineering', 'Asteroid mining'],
    detail: 'A growing swarm of collectors captures a large share of the star’s light.',
  },
];

const ALL_TECHNOLOGIES: TechnologyStep[] = [...HISTORICAL_TECHNOLOGIES, ...FUTURE_TECHNOLOGIES];

const nextTechnology = (known: ReadonlySet<string>): TechnologyStep | undefined =>
  ALL_TECHNOLOGIES.find(
    (tech) => !known.has(tech.name) && tech.requires.every((requirement) => known.has(requirement)),
  );

const knownTechnologyNames = (known: ReadonlySet<string>): string[] =>
  ALL_TECHNOLOGIES.filter((tech) => known.has(tech.name)).map((tech) => tech.name);

const eraForKnown = (known: ReadonlySet<string>): number => {
  let era = 0;
  for (const tech of ALL_TECHNOLOGIES) {
    if (known.has(tech.name)) era = Math.max(era, tech.era);
  }
  return era;
};

/** Research output per person-year at the start of the projection. */
const RESEARCH_PER_PERSON_YEAR = 0.0014;

const researchRate = (era: number): number => RESEARCH_PER_PERSON_YEAR * (1 + era * 0.1);

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

/** Frame years cover the near future densely enough to see gradual change. */
const frameYears = (startYear: number, targetYears: number, events: readonly { year: number }[]): number[] => {
  const years = new Set<number>();
  const near = [
    625, 700, 800, 900, 950, 1000, 1100, 1250, 1400, 1600, 1800,
    1850, 1900, 1925, 1950, 1975, 2000, 2010, 2020, 2026, 2040, 2060, 2100, 2200, 2500, 2800, 3000,
  ];
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
    const known = species.sapient ? technologies.slice(-4) : [];

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
      techs: species.sapient ? technologies.length : 0,
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
 * capacity set by era and surface habitability. Research is the cumulative product
 * of living population and time; technologies unlock only when their own threshold
 * is met and their prerequisites are known.
 */
export const buildFutureHistory = (options: FutureHistoryOptions): FutureHistory => {
  const targetYears = options.deepTime.targetYears ?? 10_000_000_000;
  const startYear = Math.max(1, options.startYear);
  const rng = new Rng(`${options.seed}:future:${startYear}:${options.initialPopulation}`, 'future');
  const sapient = options.species.some((species) => species.sapient);
  const years = frameYears(startYear, targetYears, options.deepTimeEvents);
  const events: FutureEvent[] = [];
  const frames: FutureFrame[] = [];
  const known = new Set<string>(sapient ? options.initialTechnologies : []);

  let population = Math.max(0, options.initialPopulation);
  let research = 0;
  let previousYear = startYear;
  const initialPopulation = Math.max(1, options.initialPopulation);

  years.forEach((year, frameIndex) => {
    const deltaYears = Math.max(1, year - previousYear);
    const state = deepTimeStateAt(options.deepTime, year);
    const wasPopulated = population > 0;
    const populationBefore = population;
    const eraBefore = eraForKnown(known);

    const carrier = Math.max(
      0,
      initialPopulation * (1.1 + 0.55 * eraBefore) * habitatFactor(state.temperatureC, state.epoch),
    );
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

    const researchGain =
      sapient && population > 0 && populationBefore > 0
        ? ((populationBefore + population) / 2) * deltaYears * researchRate(eraBefore)
        : 0;
    const researchAtStart = research;
    let cumulativeCost = 0;
    for (;;) {
      const next = nextTechnology(known);
      if (!next) {
        research = 0;
        break;
      }
      if (researchAtStart + researchGain < cumulativeCost + next.cost) break;
      cumulativeCost += next.cost;
      const fraction = researchGain > 0 ? clamp((cumulativeCost - researchAtStart) / researchGain, 0, 1) : 1;
      const discoveryYear = Math.round(previousYear + deltaYears * fraction);
      known.add(next.name);
      events.push({
        year: discoveryYear,
        title: `${next.name} discovered`,
        detail: next.detail,
      });
    }
    if (cumulativeCost === 0 && researchAtStart + researchGain > 0) {
      research += researchGain;
    } else {
      research = Math.max(0, researchAtStart + researchGain - cumulativeCost);
    }

    const techLevel = eraForKnown(known);
    const technologies = sapient ? knownTechnologyNames(known) : [];
    const settlements = population > 0
      ? Math.max(1, Math.round(options.initialSettlements * (population / initialPopulation) ** 0.55))
      : 0;
    const scale = options.initialPopulation > 0 ? population / options.initialPopulation : 0;
    const region: FutureRegion = {
      ...options.region,
      population: options.region.population.map((count) => Math.max(0, Math.round(count * scale))),
    };
    const era = population > 0
      ? (sapient ? TECH_ERAS[techLevel] ?? TECH_ERAS[0] : 'Wild biosphere')
      : 'Silent world';
    const description = population > 0
      ? `${era}: ${population.toLocaleString('en-US')} people across ${settlements.toLocaleString('en-US')} settlements, with ${technologies.length} technologies known. ${state.description}`
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
