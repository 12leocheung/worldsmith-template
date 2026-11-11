/**
 * A minimal but extensible technology tree.
 *
 * Technologies are cultural knowledge, stored as a bitmask per individual. A
 * species' effective technology is the union over its living members, so knowledge
 * can be lost if everyone who held it dies. Effects are additive multipliers.
 */
export interface TechEffects {
  /** Additional food extracted per unit of harvested land. */
  foodYield: number;
  /** Fractional reduction of age/disease mortality. */
  survival: number;
  /** Multiplier bonus on fertility. */
  fertility: number;
  /** Multiplier bonus on innovation probability. */
  innovation: number;
  /** Additional knowledge-transmission probability. */
  transmission: number;
  /** Effective degrees of cold tolerance. */
  coldResistanceC: number;
  /** Additional population that can be supported (reserved for future carrying-capacity changes). */
  carryingCapacity: number;
}

export const ZERO_TECH_EFFECTS: TechEffects = {
  foodYield: 0,
  survival: 0,
  fertility: 0,
  innovation: 0,
  transmission: 0,
  coldResistanceC: 0,
  carryingCapacity: 0,
};

export interface Technology {
  id: string;
  name: string;
  bit: number;
  requires: string[];
  description: string;
  effects: Partial<TechEffects>;
}

const TECH_SEQUENCE: Omit<Technology, 'bit'>[] = [
  {
    id: 'fire',
    name: 'Fire',
    requires: [],
    description: 'Controlled combustion: warmth, cooking, predator deterrence.',
    effects: { foodYield: 0.15, coldResistanceC: 5 },
  },
  {
    id: 'stoneTools',
    name: 'Stone tools',
    requires: [],
    description: 'Cutting and scraping, improving foraging and butchery.',
    effects: { foodYield: 0.15, survival: 0.04 },
  },
  {
    id: 'language',
    name: 'Language',
    requires: [],
    description: 'Symbolic communication greatly increases teaching fidelity.',
    effects: { transmission: 0.25 },
  },
  {
    id: 'cooking',
    name: 'Cooking',
    requires: ['fire'],
    description: 'Heat-treated food unlocks more calories and destroys pathogens.',
    effects: { foodYield: 0.2, survival: 0.05 },
  },
  {
    id: 'clothing',
    name: 'Clothing and shelter',
    requires: ['stoneTools'],
    description: 'Insulation and shelter extend the habitable range.',
    effects: { coldResistanceC: 14 },
  },
  {
    id: 'agriculture',
    name: 'Agriculture',
    requires: ['stoneTools', 'fire'],
    description: 'Deliberate cultivation raises land productivity and supports larger families.',
    effects: { foodYield: 0.7, fertility: 0.15 },
  },
  {
    id: 'animalHusbandry',
    name: 'Animal husbandry',
    requires: ['agriculture'],
    description: 'Domesticated animals provide meat, milk, traction and manure.',
    effects: { foodYield: 0.25 },
  },
  {
    id: 'pottery',
    name: 'Pottery',
    requires: ['fire'],
    description: 'Storage of grain and water smooths seasonal shortages.',
    effects: { foodYield: 0.1 },
  },
  {
    id: 'writing',
    name: 'Writing',
    requires: ['language', 'agriculture'],
    description: 'Knowledge can outlive its bearer.',
    effects: { transmission: 0.25 },
  },
  {
    id: 'metallurgy',
    name: 'Metallurgy',
    requires: ['fire', 'stoneTools'],
    description: 'Smelting produces better tools and weapons.',
    effects: { foodYield: 0.15, survival: 0.05 },
  },
  {
    id: 'mathematics',
    name: 'Mathematics',
    requires: ['writing'],
    description: 'Abstract reasoning formalises technical knowledge.',
    effects: { innovation: 0.3 },
  },
  {
    id: 'sanitation',
    name: 'Sanitation',
    requires: ['agriculture', 'pottery'],
    description: 'Sewers and clean water reduce density-dependent disease.',
    effects: { survival: 0.25, fertility: 0.1 },
  },
  {
    id: 'medicine',
    name: 'Medicine',
    requires: ['writing', 'sanitation'],
    description: 'Treatment of injury and infection.',
    effects: { survival: 0.3 },
  },
  {
    id: 'printing',
    name: 'Printing',
    requires: ['writing'],
    description: 'Mass reproduction of texts accelerates cultural transmission.',
    effects: { transmission: 0.35 },
  },
  {
    id: 'steamPower',
    name: 'Steam power',
    requires: ['metallurgy', 'mathematics'],
    description: 'External energy multiplies agricultural and industrial output.',
    effects: { foodYield: 0.3 },
  },
  {
    id: 'germTheory',
    name: 'Germ theory',
    requires: ['medicine', 'mathematics'],
    description: 'Understanding pathogens transforms survival.',
    effects: { survival: 0.35 },
  },
  {
    id: 'electricity',
    name: 'Electricity',
    requires: ['metallurgy', 'mathematics'],
    description: 'Power distribution and lighting.',
    effects: { innovation: 0.25, foodYield: 0.1 },
  },
  {
    id: 'scientificMethod',
    name: 'Scientific method',
    requires: ['mathematics', 'printing'],
    description: 'Institutionalised hypothesis testing accelerates discovery.',
    effects: { innovation: 0.6 },
  },
  {
    id: 'computing',
    name: 'Computing',
    requires: ['electricity', 'scientificMethod'],
    description: 'Automated calculation and information processing.',
    effects: { innovation: 0.5 },
  },
  {
    id: 'genetics',
    name: 'Genetics',
    requires: ['germTheory', 'scientificMethod'],
    description: 'Understanding heredity, with consequences for medicine and agriculture.',
    effects: { survival: 0.2, foodYield: 0.2 },
  },
];

export const TECHNOLOGIES: Technology[] = TECH_SEQUENCE.map((tech, index) => ({
  ...tech,
  bit: 1 << index,
}));

export const TECH_BY_ID: Map<string, Technology> = new Map(TECHNOLOGIES.map((t) => [t.id, t]));

export const ALL_TECH_MASK = TECHNOLOGIES.reduce((mask, tech) => mask | tech.bit, 0);

export const hasTech = (mask: number, id: string): boolean => {
  const tech = TECH_BY_ID.get(id);
  if (!tech) throw new Error(`Unknown technology "${id}". Known: ${TECHNOLOGIES.map((t) => t.id).join(', ')}`);
  return (mask & tech.bit) !== 0;
};

export const addTech = (mask: number, id: string): number => {
  const tech = TECH_BY_ID.get(id);
  if (!tech) throw new Error(`Unknown technology "${id}"`);
  return mask | tech.bit;
};

export const techIds = (mask: number): string[] =>
  TECHNOLOGIES.filter((tech) => (mask & tech.bit) !== 0).map((tech) => tech.id);

export const knownTechnologies = (mask: number): Technology[] =>
  TECHNOLOGIES.filter((tech) => (mask & tech.bit) !== 0);

/** Technologies whose prerequisites are met but which are not yet known. */
export const availableTechnologies = (mask: number): Technology[] =>
  TECHNOLOGIES.filter((tech) => (mask & tech.bit) === 0 && tech.requires.every((req) => hasTech(mask, req)));

/** Combine effects of every known technology. */
export const techEffects = (mask: number): TechEffects => {
  const effects: TechEffects = { ...ZERO_TECH_EFFECTS };
  for (const tech of knownTechnologies(mask)) {
    for (const [key, value] of Object.entries(tech.effects)) {
      effects[key as keyof TechEffects] += value as number;
    }
  }
  return effects;
};

export const techMaskOf = (ids: readonly string[]): number => ids.reduce((mask, id) => addTech(mask, id), 0);

export const countTechs = (mask: number): number => knownTechnologies(mask).length;
