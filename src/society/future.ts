/**
 * Coarse future-history model for the chronicle.
 *
 * The individual-level ecology is deliberately not run for gigayears. Instead this
 * module integrates a small state machine from the final simulated year to the stellar
 * horizon:
 *
 *   population, settlements, known technologies, research, institutions, resources
 *   and ecological pressure
 *
 * Technology is discovered, not assigned by date. Each frame contributes research
 * from the living working-age population, scaled by literacy, institutions, technology
 * adoption and whether the world chose an open or centralised information order. When a
 * technology's research threshold is crossed it is added to the known set and gets a
 * discovery event at the estimated year. Different worlds therefore reach cars,
 * computers, AI or orbital habitats at different dates — or never.
 *
 * The same seed always produces the same future. Residents shown in a future frame
 * are representatives of that frame's population, not surviving individuals from the
 * historical run.
 */

import { clamp, pow } from '../core/math.ts';
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
  /** True for a resident of an orbital habitat rather than the surface. */
  offWorld: boolean;
  x: number;
  y: number;
}

export interface AgeStructure {
  /** Fraction of the population aged 0–14. */
  children: number;
  /** Fraction aged 15–64. */
  working: number;
  /** Fraction aged 65 and over. */
  elders: number;
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
  surfacePopulation: number;
  orbitalPopulation: number;
  urbanPopulation: number;
  ruralPopulation: number;
  settlements: number;
  orbitalSettlements: number;
  /** Share of adults who can read and use written knowledge. */
  literacy: number;
  /** State capacity: taxation, law, public health and education. */
  institutions: number;
  /** Share of settlements using the latest known technology. */
  technologyAccess: number;
  urbanization: number;
  tradeConnectivity: number;
  /** Commercial energy use, MWh per person per year. */
  energyPerCapita: number;
  /** Remaining accessible material and fuel stocks, 0–1. */
  resourceStock: number;
  pollution: number;
  biosphereHealth: number;
  /** Food available relative to demand, 1 = adequate. */
  foodPerCapita: number;
  fertility: number;
  lifeExpectancy: number;
  ageStructure: AgeStructure;
  /** Mutually exclusive path choices already made. */
  branches: string[];
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
  /** Mutually exclusive technologies in the same group. */
  group?: string;
}

/** Coarse society state carried between future frames. */
export interface FutureState {
  population: number;
  surfacePopulation: number;
  orbitalPopulation: number;
  fertility: number;
  lifeExpectancy: number;
  literacy: number;
  institutions: number;
  urbanization: number;
  technologyAccess: number;
  energyPerCapita: number;
  resources: number;
  pollution: number;
  biosphere: number;
  trade: number;
  inequality: number;
  /** Cultural/political bias toward openness or central control, 0–1. */
  pathBias: number;
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
 * centuries. Costs are in research units. They are calibrated so a populous
 * world reaches computers around its industrial century, the internet decades
 * later, and AI later still; a small or unlucky world may never get there before
 * its star changes.
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
    name: 'Renewable energy',
    era: 4,
    cost: 2_100,
    requires: ['Electricity', 'Scientific method'],
    group: 'energy',
    detail: 'Wind, solar and storage replace combustion as the backbone of the grid.',
  },
  {
    name: 'Fossil fuel renaissance',
    era: 4,
    cost: 2_100,
    requires: ['Steam power', 'Cars'],
    group: 'energy',
    detail: 'Cheap coal, oil and gas are burned faster, buying growth at an ecological price.',
  },
  {
    name: 'Open information order',
    era: 4,
    cost: 2_300,
    requires: ['Internet', 'Scientific method'],
    group: 'governance',
    detail: 'Open archives, a free press and public education widen who can produce knowledge.',
  },
  {
    name: 'Centralized automation',
    era: 4,
    cost: 2_300,
    requires: ['Internet', 'Artificial intelligence'],
    group: 'governance',
    detail: 'Networked agencies coordinate production and surveillance from the centre.',
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
    name: 'Biosphere restoration',
    era: 6,
    cost: 2_600,
    requires: ['Closed-loop ecology', 'Gene editing'],
    detail: 'Ecological engineering repairs soil, water and biodiversity at scale.',
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

/**
 * Pick one of a mutually exclusive pair from present conditions. The seeded civic
 * tradition keeps different worlds from collapsing onto one path; ecology and
 * political capacity decide which side of each split is viable now.
 */
export const branchChoice = (
  group: 'energy' | 'governance',
  state: Pick<FutureState, 'pathBias' | 'institutions' | 'pollution' | 'literacy'>,
): 'Renewable energy' | 'Fossil fuel renaissance' | 'Open information order' | 'Centralized automation' => {
  if (group === 'energy') {
    const score = state.pathBias * 0.7 + state.institutions * 0.2 + state.pollution * 0.3;
    return score >= 0.6 ? 'Renewable energy' : 'Fossil fuel renaissance';
  }
  const score = state.pathBias * 0.7 + state.literacy * 0.2 + state.institutions * 0.1;
  return score >= 0.6 ? 'Open information order' : 'Centralized automation';
};

const nextTechnology = (known: ReadonlySet<string>, state: FutureState): TechnologyStep | undefined => {
  const usedGroups = new Set(
    ALL_TECHNOLOGIES.filter((tech) => tech.group && known.has(tech.name)).map((tech) => tech.group as string),
  );
  const availableGroups = new Set<string>();
  const groupIds = [...new Set(ALL_TECHNOLOGIES.map((tech) => tech.group).filter((group): group is string => Boolean(group)))];
  for (const group of groupIds) {
    const groupTechs = ALL_TECHNOLOGIES.filter((tech) => tech.group === group);
    if (usedGroups.has(group)) continue;
    if (groupTechs.every((tech) => tech.requires.every((requirement) => known.has(requirement)))) {
      availableGroups.add(group);
    }
  }
  const candidates = ALL_TECHNOLOGIES.filter(
    (tech) =>
      !known.has(tech.name) &&
      (!tech.group || (!usedGroups.has(tech.group) && availableGroups.has(tech.group))) &&
      tech.requires.every((requirement) => known.has(requirement)),
  );
  if (candidates.length === 0) return undefined;

  const firstGrouped = candidates.find((tech) => tech.group);
  if (firstGrouped?.group) {
    const options = candidates.filter((tech) => tech.group === firstGrouped.group);
    if (options.length > 1 && (firstGrouped.group === 'energy' || firstGrouped.group === 'governance')) {
      const choice = branchChoice(firstGrouped.group, state);
      return options.find((tech) => tech.name === choice) ?? options[0];
    }
    return options[0];
  }

  return candidates[0];
};

const branchNames = (known: ReadonlySet<string>): string[] =>
  ALL_TECHNOLOGIES.filter((tech) => tech.group && known.has(tech.name)).map((tech) => tech.name);

const knownTechnologyNames = (known: ReadonlySet<string>): string[] =>
  ALL_TECHNOLOGIES.filter((tech) => known.has(tech.name)).map((tech) => tech.name);

const eraForKnown = (known: ReadonlySet<string>): number => {
  let era = 0;
  for (const tech of ALL_TECHNOLOGIES) {
    if (known.has(tech.name)) era = Math.max(era, tech.era);
  }
  return era;
};

/**
 * Research output per person-year at the start of the projection. Kept low enough
 * that the information age is a sequence of discoveries over centuries rather than
 * a single leap; faster, larger lineages still separate from slower ones.
 */
const RESEARCH_PER_PERSON_YEAR = 0.0044;

/** Move a value toward a target with a time constant in years. */
const approach = (value: number, target: number, years: number, tau: number): number =>
  value + (target - value) * (1 - Math.exp(-years / Math.max(1, tau)));

const ageStructureFor = (fertility: number, lifeExpectancy: number): AgeStructure => {
  const children = clamp(0.1 + 0.06 * (fertility - 1.2), 0.1, 0.45);
  const elders = clamp(0.02 + 0.0045 * (lifeExpectancy - 25), 0.02, 0.3);
  return { children, working: Math.max(0.2, 1 - children - elders), elders };
};

/** Commercial energy use rises with the mode of production, not the calendar. */
const energyTarget = (era: number, known: ReadonlySet<string>): number => {
  let target = 0.35 * pow(2.1, era);
  if (known.has('Fossil fuel renaissance')) target *= 1.25;
  if (known.has('Renewable energy')) target *= 0.9;
  return clamp(target, 0.2, 250);
};

const pollutionControl = (state: FutureState, known: ReadonlySet<string>): number =>
  clamp(
    state.institutions * 0.2 +
      (known.has('Renewable energy') ? 0.35 : 0) +
      (known.has('Closed-loop ecology') ? 0.2 : 0) +
      (known.has('Gene editing') ? 0.1 : 0) +
      (known.has('Biosphere restoration') ? 0.1 : 0),
    0,
    0.9,
  );

const surfaceCapacity = (
  state: FutureState,
  era: number,
  habitat: number,
  known: ReadonlySet<string>,
  initialPopulation: number,
): number => {
  if (habitat <= 0) return 0;
  const base = initialPopulation * (1.8 + 0.55 * era);
  return (
    base *
    habitat *
    (0.7 + 0.3 * state.biosphere) *
    (0.6 + 0.4 * state.resources) *
    (0.9 + 0.15 * state.trade) *
    (0.85 + 0.15 * state.institutions) *
    (1 - 0.3 * state.pollution) *
    (0.8 + 0.2 * state.technologyAccess) *
    (known.has('Gene editing') ? 1.03 : 1)
  );
};

const orbitalCapacity = (
  era: number,
  epoch: string,
  known: ReadonlySet<string>,
  initialPopulation: number,
): number => {
  if (!known.has('Orbital habitats')) return 0;
  if (epoch === 'Stellar remnant' || epoch === 'Sterile') return 0;
  const closedLoop = known.has('Closed-loop ecology') ? 1 : 0.45;
  const base = initialPopulation * (0.08 + 0.04 * Math.max(0, era - 5)) * closedLoop;
  return epoch === 'Red giant' ? base * 0.35 : base;
};

export interface CrisisContext {
  state: FutureState;
  known: ReadonlySet<string>;
  foodSecurity: number;
  density: number;
  unrest: number;
  resourceStress: number;
  climateStress: number;
  temperatureC: number;
}

export interface CrisisDefinition {
  id: string;
  title: string;
  detail: string;
  factor: number;
  can: (context: CrisisContext) => boolean;
  weight: (context: CrisisContext) => number;
  requires?: readonly string[];
}

const CRISES: readonly CrisisDefinition[] = [
  {
    id: 'famine',
    title: 'Famine',
    detail: 'Harvests fell below demand as soil, water and fuel ran short.',
    factor: 0.72,
    can: (c) => c.state.surfacePopulation > 0 && c.foodSecurity < 0.92,
    weight: (c) => (1 - c.foodSecurity) * 4 + c.state.pollution * 0.5,
  },
  {
    id: 'epidemic',
    title: 'Epidemic',
    detail: 'Crowded settlements and limited sanitation let a pathogen spread.',
    factor: 0.68,
    can: (c) => c.state.surfacePopulation > 0 && c.density > 1.35 && c.state.urbanization > 0.12,
    weight: (c) =>
      (0.3 + c.state.urbanization * 0.8 + c.state.pollution * 0.3) *
      (c.known.has('Antibiotics') ? 0.55 : 1) *
      (c.known.has('Sanitation') ? 0.8 : 1),
  },
  {
    id: 'war',
    title: 'War',
    detail: 'Resource and distributional conflict escalated into open war.',
    factor: 0.8,
    can: (c) =>
      c.state.surfacePopulation > 0 &&
      c.density > 1.5 &&
      (c.state.inequality > 0.45 || c.resourceStress > 0.35) &&
      c.state.institutions < 0.72,
    weight: (c) => 0.4 + c.unrest * 1.2,
  },
  {
    id: 'revolution',
    title: 'Revolution',
    detail: 'Literate city dwellers turned against a closed elite.',
    factor: 0.88,
    can: (c) =>
      c.state.surfacePopulation > 0 &&
      c.state.literacy > 0.4 &&
      c.state.inequality > 0.5 &&
      c.state.institutions < 0.62,
    weight: (c) => 0.5 + c.unrest,
  },
  {
    id: 'resource bust',
    title: 'Resource bust',
    detail: 'Easily accessible fuels and minerals ran out faster than substitutes arrived.',
    factor: 0.85,
    can: (c) => c.state.surfacePopulation > 0 && c.resourceStress > 0.65,
    weight: (c) => c.resourceStress * 1.5,
  },
  {
    id: 'machine disruption',
    title: 'Machine disruption',
    detail: 'Automation and artificial agents overturn the labour economy.',
    factor: 0.72,
    requires: ['Artificial intelligence'],
    can: (c) =>
      c.state.surfacePopulation > 0 &&
      c.state.urbanization > 0.3 &&
      c.state.inequality > 0.4,
    weight: (c) => 0.5 + c.state.urbanization,
  },
  {
    id: 'climate shock',
    title: 'Climate shock',
    detail: 'A regional climate reversal strains food and water supplies.',
    factor: 0.9,
    can: (c) => c.state.surfacePopulation > 0 && (c.temperatureC > 30 || c.state.biosphere < 0.45),
    weight: (c) => c.climateStress * 1.5,
  },
  {
    id: 'migration',
    title: 'Migration',
    detail: 'People move toward surviving land, cities and trade routes.',
    factor: 1.04,
    can: (c) => c.state.surfacePopulation > 0 && (c.climateStress > 0.2 || c.foodSecurity < 0.75),
    weight: (c) => 0.2 + c.climateStress,
  },
  {
    id: 'golden age',
    title: 'Golden age',
    detail: 'Open exchange and capable institutions raise output and confidence.',
    factor: 1.12,
    can: (c) =>
      c.state.surfacePopulation > 100 &&
      c.state.institutions > 0.55 &&
      c.state.trade > 0.4 &&
      c.state.resources > 0.6 &&
      c.foodSecurity > 0.9,
    weight: () => 0.35,
  },
];

export const eligibleCrises = (context: CrisisContext): CrisisDefinition[] =>
  CRISES.filter(
    (crisis) =>
      (crisis.requires ?? []).every((technology) => context.known.has(technology)) && crisis.can(context),
  );

const chooseCrisis = (context: CrisisContext, years: number, rng: Rng): CrisisDefinition | undefined => {
  const candidates = eligibleCrises(context);
  if (candidates.length === 0) return undefined;
  const weights = candidates.map((crisis) => Math.max(0.01, crisis.weight(context)));
  const pressure = Math.max(...weights);
  const chance = clamp((years / 500) * (0.15 + pressure), 0, 0.55);
  if (!rng.chance(chance)) return undefined;
  return candidates[rng.weightedIndex(weights)];
};

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
      years.add(Math.round(logStart * pow(targetYears / logStart, index / 28)));
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
  surfacePopulation: number,
  orbitalPopulation: number,
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

  const residentSpecies = options.species.some((species) => species.sapient)
    ? options.species.filter((species) => species.sapient)
    : options.species;
  const speciesWeights = residentSpecies.map((species) => Math.max(1, species.population));
  const count = Math.max(1, Math.min(30, Math.round(30 * Math.sqrt(population / Math.max(1, options.initialPopulation)))));
  const orbitalShare = orbitalPopulation / Math.max(1, surfacePopulation + orbitalPopulation);
  const residents: FutureResident[] = [];

  for (let index = 0; index < count; index++) {
    const species = residentSpecies[rng.weightedIndex(speciesWeights)] ?? residentSpecies[0];
    if (!species) break;
    const id = 1_000_000 + frameIndex * 100 + index;
    const actionPool = species.sapient
      ? SAPIENT_ACTIONS[Math.min(techLevel, SAPIENT_ACTIONS.length - 1)] ?? SAPIENT_ACTIONS[0]!
      : ANIMAL_ACTIONS;
    const action = actionPool[rng.int(0, actionPool.length)] ?? ANIMAL_ACTIONS[0]!;
    const cellChoice =
      surfacePopulation > 0 && cellWeights.length > 0
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
      offWorld: species.sapient && (surfacePopulation <= 0 || rng.chance(orbitalShare)),
      x: ((Math.imul(id, 2654435761) >>> 0) % 1000) / 1000,
      y: ((Math.imul(id, 40503) >>> 0) % 1000) / 1000,
    });
  }
  return residents;
};

/**
 * Integrate the post-simulation future. Population follows a fertility- and
 * capacity-limited growth rule rather than a fixed logistic curve. The state also
 * carries literacy, state capacity, technology adoption, energy, resources,
 * pollution, biosphere health, trade and urbanisation, so crises and discoveries
 * have causes rather than appearing on a calendar.
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
  const initialPopulation = Math.max(1, options.initialPopulation);
  const initialEra = sapient ? eraForKnown(known) : 0;

  const initialLiteracy = sapient
    ? clamp(
        0.03 +
          (known.has('Writing') ? 0.1 : 0) +
          (known.has('Printing') ? 0.2 : 0) +
          (known.has('Scientific method') ? 0.1 : 0) +
          initialEra * 0.015,
        0.02,
        0.75,
      )
    : 0;
  const initialInstitutions = sapient
    ? clamp(
        0.08 +
          (known.has('Writing') ? 0.08 : 0) +
          (known.has('Printing') ? 0.08 : 0) +
          initialEra * 0.02,
        0.05,
        0.75,
      )
    : 0;

  const state: FutureState = {
    population: initialPopulation,
    surfacePopulation: initialPopulation,
    orbitalPopulation: 0,
    fertility: sapient ? 4.6 : 4,
    lifeExpectancy: sapient ? 32 : 15,
    literacy: initialLiteracy,
    institutions: initialInstitutions,
    urbanization: clamp(0.03 + initialEra * 0.012, 0.02, 0.2),
    technologyAccess: sapient ? 0.75 : 0,
    energyPerCapita: energyTarget(initialEra, known),
    resources: 0.85,
    pollution: 0.02,
    biosphere: 0.92,
    trade: clamp(0.04 + initialEra * 0.02, 0.04, 0.4),
    inequality: 0.4,
    pathBias: new Rng(
      `${options.seed}:${options.place}:${options.species.map((species) => species.id).join(',')}:future-path`,
      'future-path',
    ).next(),
  };

  let research = 0;
  let previousYear = startYear;
  let surfaceWasPopulated = state.surfacePopulation > 0;

  years.forEach((year, frameIndex) => {
    const deltaYears = Math.max(1, year - previousYear);
    const stateAtYear = deepTimeStateAt(options.deepTime, year);
    const habitat = habitatFactor(stateAtYear.temperatureC, stateAtYear.epoch);
    const eraBefore = eraForKnown(known);
    const totalBefore = state.population;
    const transportCount = ['Cars', 'Telephones', 'Flight', 'Internet'].filter((technology) => known.has(technology)).length;

    // Human and institutional capital change slowly. Their targets are driven by
    // technology, settlement patterns and each other rather than a year number.
    const literacyTarget = clamp(
      0.02 +
        (known.has('Writing') ? 0.1 : 0) +
        (known.has('Printing') ? 0.25 : 0) +
        (known.has('Scientific method') ? 0.15 : 0) +
        (known.has('Computers') ? 0.08 : 0) +
        (known.has('Internet') ? 0.12 : 0) +
        state.institutions * 0.2 +
        eraBefore * 0.04,
      0.02,
      0.98,
    );
    state.literacy = approach(state.literacy, literacyTarget, deltaYears, 90);

    const urbanizationTarget = clamp(
      0.03 + eraBefore * 0.035 + state.literacy * 0.18 + state.institutions * 0.1 + transportCount * 0.02,
      0.03,
      0.88,
    );
    state.urbanization = approach(state.urbanization, urbanizationTarget, deltaYears, 120);

    const institutionsTarget = clamp(
      0.08 +
        state.literacy * 0.28 +
        state.urbanization * 0.15 +
        state.trade * 0.1 +
        eraBefore * 0.04 +
        (known.has('Writing') ? 0.05 : 0) +
        (known.has('Printing') ? 0.08 : 0) +
        (known.has('Scientific method') ? 0.08 : 0) +
        (known.has('Internet') ? 0.05 : 0) +
        (known.has('Open information order') ? 0.04 : 0) +
        (known.has('Centralized automation') ? 0.08 : 0) -
        state.inequality * 0.12,
      0.03,
      0.95,
    );
    state.institutions = approach(state.institutions, institutionsTarget, deltaYears, 100);

    const tradeTarget = clamp(
      0.04 + eraBefore * 0.04 + state.urbanization * 0.2 + state.institutions * 0.12 + transportCount * 0.07,
      0.03,
      0.96,
    );
    state.trade = approach(state.trade, tradeTarget, deltaYears, 90);

    state.energyPerCapita = approach(
      state.energyPerCapita,
      energyTarget(eraBefore, known),
      deltaYears,
      80,
    );

    const controls = pollutionControl(state, known);
    const pollutionTarget = clamp(
      (0.25 * (state.energyPerCapita / 10) * (state.population / initialPopulation)) / (1 + controls * 3),
      0,
      0.92,
    );
    state.pollution = approach(state.pollution, pollutionTarget, deltaYears, 55);

    const biosphereTarget = habitat > 0
      ? clamp(
          1 -
            (state.surfacePopulation / initialPopulation) * 0.12 -
            state.pollution * 0.45 -
            (1 - state.resources) * 0.2 +
            (known.has('Biosphere restoration') ? 0.12 : 0) +
            (known.has('Closed-loop ecology') ? 0.04 : 0),
          0.05,
          1,
        )
      : 0;
    state.biosphere = approach(state.biosphere, biosphereTarget, deltaYears, 140);

    const extraction =
      0.00005 *
      (state.population / initialPopulation) *
      (state.energyPerCapita / 10) *
      (known.has('Asteroid mining') ? 0.35 : 1);
    const regeneration =
      0.00003 +
      (1 - state.resources) * 0.00012 * (known.has('Asteroid mining') ? 1.5 : 1);
    state.resources = clamp(state.resources + (regeneration - extraction) * deltaYears, 0, 1);

    const frontierFertility =
      clamp(1 - state.population / Math.max(1, initialPopulation * 0.8), 0, 1) * 0.9;
    const fertilityTarget = sapient
      ? clamp(
          4.8 - state.literacy * 2.2 - state.urbanization * 1.1 - eraBefore * 0.04 + frontierFertility,
          1.15,
          6,
        )
      : 4;
    state.fertility = approach(state.fertility, fertilityTarget, deltaYears, 110);

    const lifeTarget = sapient
      ? clamp(
          27 +
            state.institutions * 28 +
            state.literacy * 22 +
            eraBefore * 1.1 +
            (known.has('Antibiotics') ? 5 : 0) +
            (known.has('Medicine') ? 3 : 0),
          25,
          88,
        )
      : 15;
    state.lifeExpectancy = approach(state.lifeExpectancy, lifeTarget, deltaYears, 120);

    const inequalityTarget = clamp(
      0.5 -
        state.institutions * 0.22 -
        state.literacy * 0.12 +
        (known.has('Fossil fuel renaissance') ? 0.06 : 0) +
        (known.has('Centralized automation') ? 0.08 : 0) -
        (known.has('Open information order') ? 0.05 : 0),
      0.12,
      0.75,
    );
    state.inequality = approach(state.inequality, inequalityTarget, deltaYears, 90);

    // New technologies need adoption, not just invention. Trade and education
    // determine how quickly the frontier reaches ordinary settlements.
    state.technologyAccess = approach(
      state.technologyAccess,
      1,
      deltaYears,
      110 - state.trade * 40,
    );

    if (!sapient) {
      state.literacy = 0;
      state.institutions = 0;
      state.urbanization = 0;
      state.trade = 0;
      state.technologyAccess = 0;
      state.energyPerCapita = 0.2;
      state.inequality = 0;
    }

    const capacitySurface = surfaceCapacity(state, eraBefore, habitat, known, initialPopulation);
    const capacityOrbital = orbitalCapacity(eraBefore, stateAtYear.epoch, known, initialPopulation);
    const totalCapacity = capacitySurface + capacityOrbital;
    const foodSecurity =
      totalCapacity > 0 ? clamp(totalCapacity / Math.max(1, state.population), 0, 1.1) : 0;

    const intrinsic = sapient
      ? clamp(0.0012 * (state.fertility / 2.1 - 1), -0.002, 0.003)
      : 0.0009;
    let nextTotal =
      totalCapacity > 0 && state.population > 0
        ? intrinsic >= 0
          ? logistic(state.population, totalCapacity, intrinsic, deltaYears)
          : Math.min(state.population * Math.exp(intrinsic * deltaYears), totalCapacity * 1.05)
        : 0;
    // Orbital habitats are a refuge from a surface collapse. If the population
    // falls below them, the people already living there remain. Natural growth can
    // refill the habitats, but it cannot conjure residents who never left.
    const orbitalRefuge = Math.min(capacityOrbital, Math.max(0, state.orbitalPopulation));
    nextTotal = Math.max(nextTotal, orbitalRefuge);

    const density = state.population / initialPopulation;
    const unrest = clamp(
      state.inequality * 0.5 + (1 - state.institutions) * 0.25 + (1 - foodSecurity) * 0.35,
      0,
      1,
    );
    const resourceStress = 1 - state.resources;
    const climateStress = clamp(
      Math.max(0, (stateAtYear.temperatureC - 28) / 35) + (1 - state.biosphere) * 0.9,
      0,
      1,
    );

    const crisis =
      nextTotal > 0
        ? chooseCrisis(
            {
              state,
              known,
              foodSecurity,
              density,
              unrest,
              resourceStress,
              climateStress,
              temperatureC: stateAtYear.temperatureC,
            },
            deltaYears,
            rng,
          )
        : undefined;

    if (crisis && nextTotal >= 1) {
      const before = nextTotal;
      nextTotal = clamp(nextTotal * crisis.factor, 0, Math.max(20, totalCapacity * 1.15));
      events.push({
        year,
        title: `${crisis.title} at ${options.place}`,
        detail: `${Math.round(before).toLocaleString('en-US')} → ${Math.round(nextTotal).toLocaleString('en-US')} people. ${crisis.detail}`,
      });
    }

    if (totalCapacity <= 0) nextTotal = 0;
    nextTotal = Math.max(0, Math.round(nextTotal));

    const orbitalShareTarget = clamp(
      0.04 + Math.max(0, eraBefore - 5) * 0.025 + state.trade * 0.08,
      0.02,
      0.55,
    );
    const orbitalPopulation =
      capacityOrbital > 0
        ? Math.min(capacityOrbital, nextTotal * (capacitySurface <= 0 ? 1 : orbitalShareTarget))
        : 0;
    state.population = nextTotal;
    state.orbitalPopulation = Math.min(nextTotal, Math.round(orbitalPopulation));
    state.surfacePopulation = nextTotal - state.orbitalPopulation;

    if (surfaceWasPopulated && state.surfacePopulation <= 0 && state.orbitalPopulation > 0) {
      events.push({
        year,
        title: 'The surface is abandoned',
        detail: `Orbital habitats keep ${state.orbitalPopulation.toLocaleString('en-US')} people alive after the surface becomes uninhabitable.`,
      });
    }
    if (totalBefore > 0 && state.population <= 0) {
      events.push({
        year,
        title: 'The last settlements fail',
        detail:
          habitat > 0
            ? 'The last people die out. The surface is still habitable, but the society could not recover.'
            : `The world can no longer support a population. ${stateAtYear.description}`,
      });
    }
    surfaceWasPopulated = state.surfacePopulation > 0;

    const workingPopulation = state.population * ageStructureFor(state.fertility, state.lifeExpectancy).working;
    const branchResearch =
      known.has('Open information order') ? 1.1 : known.has('Centralized automation') ? 1.04 : 1;
    const researchGain =
      sapient && state.population > 0 && state.surfacePopulation > 0
        ? workingPopulation *
          deltaYears *
          RESEARCH_PER_PERSON_YEAR *
          (1 + eraBefore * 0.1) *
          (0.3 + state.literacy * 0.7) *
          (0.7 + state.institutions * 0.5) *
          (0.55 + state.technologyAccess * 0.45) *
          branchResearch
        : 0;
    const researchAtStart = research;
    let cumulativeCost = 0;
    for (;;) {
      const next = nextTechnology(known, state);
      if (!next) {
        research = 0;
        break;
      }
      if (researchAtStart + researchGain < cumulativeCost + next.cost) break;
      cumulativeCost += next.cost;
      const fraction = researchGain > 0 ? clamp((cumulativeCost - researchAtStart) / researchGain, 0, 1) : 1;
      const discoveryYear = Math.round(previousYear + deltaYears * fraction);
      known.add(next.name);
      state.technologyAccess = clamp(state.technologyAccess - 0.08, 0.3, 1);
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
    const branches = branchNames(known);
    const era = state.population > 0 ? (sapient ? TECH_ERAS[techLevel] ?? TECH_ERAS[0] : 'Wild biosphere') : 'Silent world';
    const settlements =
      state.surfacePopulation > 0
        ? Math.max(
            1,
            Math.round(
              options.initialSettlements *
                pow(state.surfacePopulation / initialPopulation, 0.45) *
                (1 - state.urbanization * 0.4),
            ),
          )
        : 0;
    const orbitalSettlements =
      state.orbitalPopulation > 0
        ? Math.max(1, Math.round(state.orbitalPopulation / Math.max(100, initialPopulation * 0.02)))
        : 0;
    const urbanPopulation = Math.round(state.surfacePopulation * state.urbanization);
    const ruralPopulation = Math.max(0, state.surfacePopulation - urbanPopulation);
    const foodPerCapita =
      state.surfacePopulation > 0
        ? clamp(
            (capacitySurface / Math.max(1, state.surfacePopulation)) *
              (0.7 + state.biosphere * 0.3) *
              (0.7 + state.resources * 0.3),
            0,
            1.2,
          )
        : state.orbitalPopulation > 0
          ? 0.8
          : 0;
    const ageStructure = ageStructureFor(state.fertility, state.lifeExpectancy);
    const scale = state.surfacePopulation / initialPopulation;
    const region: FutureRegion = {
      ...options.region,
      population: options.region.population.map((count) => Math.max(0, Math.round(count * scale))),
    };
    const societyParts = [
      `${Math.round(state.literacy * 100)}% literate`,
      `institutions ${Math.round(state.institutions * 100)}%`,
    ];
    if (state.surfacePopulation > 0) societyParts.push(`urban ${Math.round(state.urbanization * 100)}%`);
    societyParts.push(
      `trade ${Math.round(state.trade * 100)}%`,
      `${state.energyPerCapita.toFixed(1)} MWh/person-year`,
    );
    const society = sapient ? `${societyParts.join(', ')}.` : 'A wild biosphere with no technological society.';
    const biosphere = `Biosphere ${Math.round(state.biosphere * 100)}%, pollution ${Math.round(state.pollution * 100)}%, resource stock ${Math.round(state.resources * 100)}%.`;
    const settlementParts = [`${settlements.toLocaleString('en-US')} surface`];
    if (orbitalSettlements > 0) settlementParts.push(`${orbitalSettlements.toLocaleString('en-US')} orbital`);
    const settlementSummary = `${settlementParts.join(' and ')} settlement${settlements + orbitalSettlements === 1 ? '' : 's'}`;
    const description =
      state.population > 0
        ? `${era}: ${state.population.toLocaleString('en-US')} people ` +
          `(${state.surfacePopulation.toLocaleString('en-US')} surface, ${state.orbitalPopulation.toLocaleString('en-US')} orbital) ` +
          `across ${settlementSummary}, with ${technologies.length} technologies known. ` +
          `${society} ${biosphere} ${stateAtYear.description}${branches.length ? ` Paths: ${branches.join(' and ')}.` : ''}`
        : `${stateAtYear.description} No settlements remain.`;

    frames.push({
      kind: 'future',
      tick: 0,
      year,
      epoch: stateAtYear.epoch,
      description,
      temperatureC: stateAtYear.temperatureC,
      luminositySolar: stateAtYear.luminositySolar,
      habitable: stateAtYear.habitable,
      era,
      techLevel,
      technologies,
      population: state.population,
      surfacePopulation: state.surfacePopulation,
      orbitalPopulation: state.orbitalPopulation,
      urbanPopulation,
      ruralPopulation,
      settlements,
      orbitalSettlements,
      literacy: state.literacy,
      institutions: state.institutions,
      technologyAccess: state.technologyAccess,
      urbanization: state.urbanization,
      tradeConnectivity: state.trade,
      energyPerCapita: state.energyPerCapita,
      resourceStock: state.resources,
      pollution: state.pollution,
      biosphereHealth: state.biosphere,
      foodPerCapita,
      fertility: state.fertility,
      lifeExpectancy: state.lifeExpectancy,
      ageStructure,
      branches,
      centerCell: options.centerCell,
      place: settlementName(options.centerCell, options.seed),
      region,
      residents:
        state.population > 0
          ? buildResidents(
              frameIndex,
              state.population,
              techLevel,
              technologies,
              options,
              region,
              state.surfacePopulation,
              state.orbitalPopulation,
              rng,
            )
          : [],
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
