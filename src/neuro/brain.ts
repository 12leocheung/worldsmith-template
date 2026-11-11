import { clamp, sigmoid } from '../core/math.ts';
import { Rng } from '../core/rng.ts';
import type { Genome } from '../bio/genome.ts';
import { ACTION_IDS, type ActionId } from './actions.ts';
import { BRAIN_REGIONS, DEFAULT_REGION_IDS, type RegionDefinition, type RegionFunction } from './regions.ts';

/**
 * A modular, rate-coded brain model.
 *
 * Brain regions integrate percepts into an activation between 0 and 1. Activations
 * are combined through function-tagged weights to produce a utility for each action;
 * choice is a softmax draw. Learned preferences let successful behaviour persist.
 *
 * This is not a spiking neural network. It is an explicit, inspectable model of what
 * brain *modules* do, which is the useful level of abstraction for experiments like
 * "what if this species had no medulla?" or "what if the cortex were twice as large?".
 */

export interface Perception {
  /** 0 = sated, 1 = starving. */
  hunger: number;
  /** Stored energy as a fraction of capacity. */
  energyFraction: number;
  /** Predator pressure, 0..1. */
  threat: number;
  /** Local plant food relative to demand, 0..1. */
  foodAvailability: number;
  /** Local prey availability, 0..1. */
  preyAvailability: number;
  /** Fertile conspecifics nearby, 0..1. */
  mateAvailability: number;
  /** Personal readiness to reproduce now, 0..1 (age, recovery, condition). */
  reproductiveReadiness: number;
  /** Conspecific crowding, 0..1. */
  socialDensity: number;
  /** Unfamiliarity of the surroundings, 0..1. */
  novelty: number;
  /** Thermal discomfort, 0..1. */
  thermalStress: number;
  /** Injury and illness, 0..1. */
  injury: number;
  /** How strongly recent actions are remembered, 0..1. */
  memoryStrength: number;
}

export const EMPTY_PERCEPTION: Perception = {
  hunger: 0.4,
  energyFraction: 0.6,
  threat: 0,
  foodAvailability: 0.5,
  preyAvailability: 0,
  mateAvailability: 0,
  reproductiveReadiness: 0,
  socialDensity: 0,
  novelty: 0.5,
  thermalStress: 0,
  injury: 0,
  memoryStrength: 0.5,
};

export interface RegionConfig {
  present?: boolean;
  /** Relative size, 1 = species default. */
  scale?: number;
  /** Signal quality, 1 = species default. */
  efficiency?: number;
}

export interface BrainSpec {
  /** Per-region overrides. Regions not listed use the default architecture. */
  regions?: Record<string, RegionConfig>;
  /** Global neural efficiency multiplier. */
  efficiency?: number;
  /** Reward-driven behavioural plasticity, 0..1. */
  plasticity?: number;
  /** Decision randomness, 0..1. Higher is more exploratory. */
  exploration?: number;
  /** Free-text note shown in reports. */
  note?: string;
}

export interface RegionState {
  definition: RegionDefinition;
  present: boolean;
  scale: number;
  efficiency: number;
  /** Last computed activation, 0..1. */
  activity: number;
}

export type RegionStates = Record<string, RegionState>;

export interface Brain {
  spec: BrainSpec;
  regions: RegionStates;
  /** Learned action bias, one per action. */
  preference: Record<ActionId, number>;
}

type InputWeights = { bias: number; inputs: Partial<Record<keyof Perception, number>> };

const FUNCTION_INPUTS: Record<RegionFunction, InputWeights> = {
  vital: { bias: 1.1, inputs: { hunger: 0.5, injury: 0.9, thermalStress: 0.5 } },
  homeostasis: { bias: 0.2, inputs: { hunger: 1.4, energyFraction: -0.5, thermalStress: 0.8, injury: 0.4 } },
  threat: { bias: 0.1, inputs: { threat: 1.6, socialDensity: 0.3, injury: 0.3 } },
  memory: { bias: 0.25, inputs: { foodAvailability: 0.5, novelty: 0.8, memoryStrength: 0.9, preyAvailability: 0.4 } },
  planning: { bias: 0.3, inputs: { novelty: 0.6, mateAvailability: 0.4, foodAvailability: 0.5, socialDensity: 0.3, hunger: 0.3 } },
  motor: { bias: 0.7, inputs: { injury: 0.5, threat: 0.4 } },
  social: { bias: 0.2, inputs: { socialDensity: 0.9, mateAvailability: 0.6 } },
};

const ACTION_WEIGHTS: Record<ActionId, Partial<Record<RegionFunction, number>>> = {
  forage: { homeostasis: 1.5, memory: 0.6, motor: 0.3 },
  hunt: { threat: 1.3, motor: 0.5 },
  mate: { homeostasis: 0.8, social: 0.6, planning: 0.3 },
  rest: { vital: 0.8, homeostasis: 0.5, motor: 0.2 },
  explore: { planning: 1.0, memory: 0.8, motor: 0.3 },
  teach: { social: 0.9, planning: 0.5, memory: 0.2 },
  socialize: { social: 1.1, memory: 0.2 },
  innovate: { planning: 1.3, memory: 0.5, social: 0.2 },
  flee: { threat: 1.7, motor: 0.6 },
};

const ZERO_PREFERENCE = (): Record<ActionId, number> => {
  const result = {} as Record<ActionId, number>;
  for (const id of ACTION_IDS) result[id] = 0;
  return result;
};

/**
 * Create a brain from species architecture plus individual variation.
 * Region size is also driven by the brain-mass gene: a bigger brain buys more capacity.
 */
export const createBrain = (spec: BrainSpec | undefined, genome: Genome, rng: Rng): Brain => {
  const resolvedSpec = spec ?? {};
  const globalEfficiency = resolvedSpec.efficiency ?? 1;
  const massFactor = clamp((genome.brainMassKg / 1.35) ** 0.45, 0.35, 3);
  const regions: RegionStates = {};

  for (const [id, definition] of BRAIN_REGIONS.entries()) {
    const override = resolvedSpec.regions?.[id];
    // Only the species' declared architecture is present by default. Alternative
    // regions (ganglia, pallium) must be switched on explicitly by a scenario.
    const present = override?.present ?? (DEFAULT_REGION_IDS.includes(id) || override?.scale !== undefined);
    const variation = Math.exp(rng.normal(0, 0.035));
    const scale = clamp((override?.scale ?? 1) * variation, 0.05, 6);
    const efficiency = clamp((override?.efficiency ?? 1) * globalEfficiency * Math.exp(rng.normal(0, 0.02)), 0.05, 4);
    regions[id] = {
      definition,
      present,
      scale,
      efficiency,
      activity: present ? 0.3 : 0,
    };
  }

  // Brain mass buys cognitive capacity, but autonomic and emotional circuitry keep
  // their functional size: a small brain is not automatically brain-dead.
  for (const state of Object.values(regions)) {
    if (!state.present) continue;
    const cognitive = state.definition.functions.some((fn) => fn === 'planning' || fn === 'memory' || fn === 'motor');
    if (cognitive) state.scale *= massFactor;
  }

  return { spec: resolvedSpec, regions, preference: ZERO_PREFERENCE() };
};

/** Clone a brain's architecture, keeping learned preferences only if requested. */
export const cloneBrain = (brain: Brain, keepPreference = false): Brain => {
  const regions: RegionStates = {};
  for (const [id, state] of Object.entries(brain.regions)) {
    regions[id] = { ...state, definition: state.definition };
  }
  return {
    spec: brain.spec,
    regions,
    preference: keepPreference ? { ...brain.preference } : ZERO_PREFERENCE(),
  };
};

export const hasRegion = (brain: Brain, id: string): boolean => brain.regions[id]?.present === true;

/** Summed capacity of regions carrying a function. */
export const functionCapacity = (brain: Brain, fn: RegionFunction): number => {
  let total = 0;
  for (const state of Object.values(brain.regions)) {
    if (state.present && state.definition.functions.includes(fn)) {
      total += state.scale * state.efficiency;
    }
  }
  return total;
};

/**
 * Autonomic integrity, 0..1. Zero means no region capable of maintaining vital
 * functions: breathing and circulation stop, so survival is measured in hours.
 *
 * Normal architectures sit comfortably at 1: the raw capacity is normalised so that
 * small individual variation in region efficiency is not read as a lesion.
 */
export const vitalTone = (brain: Brain): number => clamp(functionCapacity(brain, 'vital') / 0.6, 0, 1);

/** Composite cognition used for innovation, teaching fidelity and reports. */
export const cognitionScore = (brain: Brain): number =>
  0.1 +
  0.55 * functionCapacity(brain, 'planning') +
  0.25 * functionCapacity(brain, 'memory') +
  0.2 * functionCapacity(brain, 'motor');

/** Fidelity of knowledge transfer between two individuals. */
export const teachingFidelity = (teacher: Brain, teacherGenome: Genome, sociality: number): number =>
  clamp(0.2 + 0.3 * Math.min(2, cognitionScore(teacher)) + 0.25 * sociality + 0.1 * teacherGenome.learningRate, 0.05, 0.95);

/** Probability per year that an individual discovers an available technology. */
export const innovationChancePerYear = (brain: Brain, genome: Genome): number =>
  clamp(0.02 * cognitionScore(brain) ** 1.8 * (0.25 + genome.curiosity), 0, 0.6);

/** Compute region activations for a percept. Stored on the brain for inspection. */
export const updateRegionActivity = (brain: Brain, perception: Perception): void => {
  for (const state of Object.values(brain.regions)) {
    if (!state.present) {
      state.activity = 0;
      continue;
    }
    const weights = FUNCTION_INPUTS[state.definition.functions[0] as RegionFunction];
    let input = weights.bias;
    for (const [key, weight] of Object.entries(weights.inputs)) {
      input += (perception[key as keyof Perception] ?? 0) * (weight as number);
    }
    state.activity = sigmoid(input);
  }
};

/** Action utilities from region activity, genes and learned preference. */
export const actionUtilities = (brain: Brain, perception: Perception, genome: Genome): Record<ActionId, number> => {
  const utilities = {} as Record<ActionId, number>;
  for (const action of ACTION_IDS) utilities[action] = 0;

  for (const state of Object.values(brain.regions)) {
    if (!state.present || state.activity <= 0) continue;
    const capacity = state.scale * state.efficiency;
    for (const fn of state.definition.functions) {
      const weights = ACTION_WEIGHTS_BY_FUNCTION[fn];
      if (!weights) continue;
      for (const [action, weight] of Object.entries(weights)) {
        utilities[action as ActionId] += state.activity * (weight as number) * capacity;
      }
    }
  }

  const cognition = cognitionScore(brain);
  // Hunger is not just another drive: when reserves run low it suppresses
  // exploratory and cultural behaviour, which is what keeps a curious species alive.
  const scarcity = Math.max(0, 0.55 - perception.energyFraction);
  const curiosityScale = 0.2 + 0.8 * perception.energyFraction;
  // Trophic affinity: a carnivore with an empty stomach forages poorly and must hunt.
  const plantAffinity = clamp(1 - genome.diet * 0.95, 0.02, 1);
  const meatAffinity = clamp(0.15 + genome.diet, 0, 1.2);
  utilities.forage +=
    (perception.hunger * 0.9 + (1 - perception.foodAvailability) * 0.2 + scarcity * 3) * plantAffinity;
  utilities.hunt +=
    (genome.aggression * 0.7 * (0.3 + perception.preyAvailability) +
      perception.hunger * 0.35 +
      scarcity * 2.5) *
    meatAffinity *
    (0.25 + 0.75 * perception.preyAvailability);
  utilities.mate +=
    perception.reproductiveReadiness *
      (0.5 + 0.5 * perception.mateAvailability) *
      (4.2 + genome.fertility * 0.1) +
    (perception.energyFraction > 0.5 ? 0.15 : -0.8);
  utilities.rest += perception.injury * 1.2 + perception.thermalStress * 0.8;
  utilities.explore +=
    genome.curiosity * 0.7 * curiosityScale +
    (genome.diet > 0.5 ? perception.hunger * 0.7 * (1 - perception.preyAvailability) : 0);
  utilities.innovate += genome.curiosity * 1.1 * cognition * curiosityScale;
  utilities.teach += genome.sociality * 0.7 * curiosityScale;
  utilities.socialize += genome.sociality * 0.8 * curiosityScale;
  utilities.flee += perception.threat * 1.4 * (1.2 - genome.aggression);

  for (const action of ACTION_IDS) {
    utilities[action] += brain.preference[action];
  }
  return utilities;
};

const ACTION_WEIGHTS_BY_FUNCTION: Partial<Record<RegionFunction, Partial<Record<ActionId, number>>>> = (() => {
  const byFunction: Partial<Record<RegionFunction, Partial<Record<ActionId, number>>>> = {};
  for (const action of ACTION_IDS) {
    for (const [fn, weight] of Object.entries(ACTION_WEIGHTS[action])) {
      const key = fn as RegionFunction;
      byFunction[key] = byFunction[key] ?? {};
      (byFunction[key] as Partial<Record<ActionId, number>>)[action] = weight as number;
    }
  }
  return byFunction;
})();

/** Softmax choice over utilities. Temperature rises with exploration and low cognition. */
export const chooseAction = (
  brain: Brain,
  utilities: Record<ActionId, number>,
  rng: Rng,
  genome: Genome,
): ActionId => {
  const temperature = clamp(0.18 + (brain.spec.exploration ?? 0.25) * 0.5 + (1 - genome.learningRate) * 0.2, 0.1, 1.2);
  const maxUtility = Math.max(...ACTION_IDS.map((a) => utilities[a]));
  const weights = ACTION_IDS.map((a) => Math.exp((utilities[a] - maxUtility) / temperature));
  const index = Math.max(0, rng.weightedIndex(weights));
  return ACTION_IDS[index] as ActionId;
};

/**
 * Reward-driven plasticity: reinforce or suppress the chosen action.
 * `reward` is roughly -1..1 relative to expectation.
 */
export const learnFromAction = (
  brain: Brain,
  genome: Genome,
  action: ActionId,
  reward: number,
): void => {
  const rate = clamp(0.015 + 0.06 * genome.learningRate, 0, 0.2) * (brain.spec.plasticity ?? 1);
  const decay = 0.998;
  for (const id of ACTION_IDS) {
    brain.preference[id] = clamp(brain.preference[id] * decay, -2, 2);
  }
  brain.preference[action] = clamp(brain.preference[action] + rate * reward, -2, 2);
};

/** Ablate, enlarge or restore a region on a living individual. */
export const configureRegion = (
  brain: Brain,
  regionId: string,
  update: RegionConfig,
): void => {
  const state = brain.regions[regionId];
  if (!state) {
    throw new Error(`Unknown brain region "${regionId}". Known regions: ${Object.keys(brain.regions).join(', ')}`);
  }
  if (update.present !== undefined) state.present = update.present;
  if (update.scale !== undefined) state.scale = clamp(update.scale, 0.01, 8);
  if (update.efficiency !== undefined) state.efficiency = clamp(update.efficiency, 0.01, 4);
  if (!state.present) state.activity = 0;
};

export const describeBrain = (brain: Brain): string => {
  const parts: string[] = [];
  for (const state of Object.values(brain.regions)) {
    if (!state.present) continue;
    parts.push(`${state.definition.name} ${(state.scale * state.efficiency).toFixed(2)}x`);
  }
  return `${parts.join(', ')} | cognition ${cognitionScore(brain).toFixed(2)}, vital tone ${vitalTone(brain).toFixed(2)}`;
};
