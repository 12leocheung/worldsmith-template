import { clamp, pow } from '../core/math.ts';
import {
  digestionEfficiency,
  dailyEnergyDemandKcal,
  energyCapacityKcal,
  meatKcalPerKg,
  isFertileAge,
  thermalStressC,
  tickEnergyDemandKcal,
} from '../bio/metabolism.ts';
import { ACTIONS, type ActionId } from '../neuro/actions.ts';
import {
  actionUtilities,
  chooseAction,
  innovationChancePerYear,
  learnFromAction,
  teachingFidelity,
  updateRegionActivity,
  type Perception,
} from '../neuro/brain.ts';
import { cellLatLon, neighbouringCells } from '../geo/terrain.ts';
import { BIOMES, plantEdibleFraction } from '../geo/biomes.ts';
import { createOffspring, type Individual } from './individual.ts';
import type { SimulationContext } from './context.ts';
import { availableTechnologies, hasTech, knownTechnologies } from './technology.ts';

/** Sample up to `limit` living occupants from a cell, starting at a random offset. */
const sampleOccupants = (
  world: SimulationContext,
  cell: number,
  limit = 12,
  excludeId = -1,
): Individual[] => {
  const occupants = world.occupantsIn(cell);
  if (occupants.length === 0) return [];
  const result: Individual[] = [];
  const start = world.rng.int(0, occupants.length);
  for (let k = 0; k < occupants.length && result.length < limit; k++) {
    const candidate = occupants[(start + k) % occupants.length] as Individual;
    if (candidate.alive && candidate.id !== excludeId) result.push(candidate);
  }
  return result;
};

/** Build everything the brain needs to know about the individual's situation. */
export const buildPerception = (world: SimulationContext, individual: Individual): Perception => {
  const { genome } = individual;
  const cell = individual.cell;
  const stock = world.foodStock[cell] ?? 0;
  const capacity = Math.max(1, world.foodCapacity[cell] ?? 1);
  const sameSpecies = world.sameSpeciesCount(cell, individual.speciesId);
  const predators = world.predatorBiomassKg[cell] ?? 0;
  let prey = world.preyBiomassKg[cell] ?? 0;
  if (prey <= 0 && genome.diet > 0.5) {
    // Predators assess the neighbourhood, not just the cell under their feet.
    for (const neighbour of neighbouringCells(cell, world.terrain.width, world.terrain.height)) {
      if (world.terrain.isOcean[neighbour] === 1) continue;
      prey = Math.max(prey, world.preyBiomassKg[neighbour] ?? 0);
    }
  }
  const temp = world.climate.temperatureC[cell] ?? 0;
  const effects = world.techEffectsFor(individual.speciesId);

  const energyFraction = clamp(
    individual.energyKcal / energyCapacityKcal(genome, world.yearsPerTick),
    0,
    1,
  );
  const birthSpacing = Math.max(0.5, genome.lifespanYears * 0.03);
  const readyToReproduce =
    isFertileAge(genome, individual.ageYears) &&
    individual.health > 0.4 &&
    world.currentYear - individual.lastBirthYear >= birthSpacing;
  return {
    hunger: 1 - energyFraction,
    energyFraction,
    threat: clamp(predators / Math.max(1, genome.bodyMassKg * 12), 0, 1),
    foodAvailability: clamp(stock / Math.max(1, capacity * 0.35), 0, 1),
    preyAvailability: clamp(prey / Math.max(1, genome.bodyMassKg * 25), 0, 1),
    mateAvailability: sameSpecies > 1 ? clamp(sameSpecies / 10, 0, 1) : 0,
    reproductiveReadiness: readyToReproduce ? clamp(energyFraction * 1.5, 0, 1) : 0,
    socialDensity: clamp((sameSpecies - 1) / 14, 0, 1),
    novelty: 0.5,
    thermalStress: clamp(thermalStressC(genome, temp + effects.coldResistanceC) / 20, 0, 1),
    injury: clamp(1 - individual.health, 0, 1),
    memoryStrength: clamp(individual.memoryStrength, 0, 1),
  };
};

export interface ActionResult {
  reward: number;
  note?: string;
}

/** Per-tick energy demand of one individual. */
const tickDemandKcal = (world: SimulationContext, individual: Individual): number =>
  tickEnergyDemandKcal(individual.genome, world.yearsPerTick);

const addEnergy = (world: SimulationContext, individual: Individual, kcal: number): void => {
  const cap = energyCapacityKcal(individual.genome, world.yearsPerTick);
  individual.energyKcal = clamp(individual.energyKcal + kcal, 0, cap);
  individual.lifetimeIntakeKcal += Math.max(0, kcal);
};

/** Move to the neighbouring land cell with the best expected forage, weighted by distance. */
const chooseMoveCell = (world: SimulationContext, individual: Individual): number => {
  const neighbours = neighbouringCells(individual.cell, world.terrain.width, world.terrain.height);
  const carnivore = individual.genome.diet > 0.5;
  const weights = neighbours.map((cell) => {
    if (world.terrain.isOcean[cell] === 1) return 0.02;
    const biome = world.climate.biome[cell] ?? 'desert';
    const food = world.foodStock[cell] ?? 0;
    const capacity = Math.max(1, world.foodCapacity[cell] ?? 1);
    const crowding = world.sameSpeciesCount(cell, individual.speciesId);
    if (carnivore) {
      const prey = world.preyBiomassKg[cell] ?? 0;
      return (0.1 + prey / Math.max(1, individual.genome.bodyMassKg * 20)) / (1 + crowding * 0.08);
    }
    return (
      (0.15 + BIOMES[biome].habitability) *
      (0.2 + clamp(food / capacity, 0, 1)) *
      (1 / (1 + crowding * 0.08))
    );
  });
  const index = world.rng.weightedIndex(weights);
  return index >= 0 ? (neighbours[index] as number) : individual.cell;
};

const doForage = (world: SimulationContext, individual: Individual): ActionResult => {
  const { genome } = individual;
  const demand = tickDemandKcal(world, individual);
  const plantShare = clamp(1 - genome.diet * 0.8, 0, 1);
  if (plantShare <= 0.02) return { reward: -0.2, note: 'obligate carnivore cannot digest plants' };

  const cell = individual.cell;
  const stock = world.foodStock[cell] ?? 0;
  // Scramble competition: each forager can remove a slice of what is standing.
  const maxTake = stock * 0.25;
  // Over a multi-year tick an organism keeps eating, so the target is larger than
  // its store; anything beyond the store is simply not retained.
  const want = demand * 3 * plantShare;
  const intake = Math.max(0, Math.min(want, maxTake));
  if (intake <= 0) {
    individual.memoryStrength = clamp(individual.memoryStrength - 0.05, 0, 1);
    return { reward: -0.4, note: 'no forage left in the cell' };
  }
  const effects = world.techEffectsFor(individual.speciesId);
  const usable = intake * digestionEfficiency(genome, false) * (1 + effects.foodYield);
  world.foodStock[cell] = Math.max(0, stock - intake * 1.15);
  addEnergy(world, individual, usable);
  individual.memoryStrength = clamp(individual.memoryStrength + 0.05, 0, 1);
  return { reward: clamp(usable / demand - 0.25, -1, 1) };
};

const doHunt = (world: SimulationContext, individual: Individual): ActionResult => {
  const { genome } = individual;
  const demand = tickDemandKcal(world, individual);
  const findPrey = (cell: number): Individual[] => {
    // Prey refuge: hunters do not exploit a cell they have already stripped, which
    // prevents local eradication and keeps predators ranging.
    if ((world.preyBiomassKg[cell] ?? 0) < genome.bodyMassKg * 3) return [];
    return sampleOccupants(world, cell, 16, individual.id).filter((other) => {
      if (!other.alive) return false;
      const runtime = world.speciesById.get(other.speciesId);
      if (!runtime || runtime.resolved.role === 'carnivore') return false;
      // Pack hunters can bring down prey far heavier than one individual.
      return other.genome.bodyMassKg <= genome.bodyMassKg * 20;
    });
  };

  let candidates = findPrey(individual.cell);
  if (candidates.length === 0) {
    // Range into the neighbouring cell with the most prey, as a real hunter would.
    const neighbours = neighbouringCells(individual.cell, world.terrain.width, world.terrain.height)
      .filter((cell) => world.terrain.isOcean[cell] === 0)
      .sort((a, b) => (world.preyBiomassKg[b] ?? 0) - (world.preyBiomassKg[a] ?? 0));
    const target = neighbours.find((cell) => (world.preyBiomassKg[cell] ?? 0) > 0);
    if (target !== undefined) {
      world.move(individual, target);
      candidates = findPrey(target);
    }
  }
  if (candidates.length === 0) {
    return { reward: -0.3, note: 'no prey in the area' };
  }
  const effects = world.techEffectsFor(individual.speciesId);
  // A multi-year tick represents many hunts, not one: keep trying until the
  // predator has enough meat for the period, or runs out of prey.
  const huntEnergyCost = demand * 0.18;
  addEnergy(world, individual, -huntEnergyCost);
  let gained = 0;
  let kills = 0;
  let injuries = 0;
  let attempts = 0;
  while (gained < demand * 1.6 && attempts < 6 && candidates.length > 0) {
    attempts += 1;
    const preyIndex = world.rng.int(0, candidates.length);
    const prey = candidates[preyIndex] as Individual;
    if (!prey.alive) {
      candidates.splice(preyIndex, 1);
      continue;
    }
    const massRatio = genome.bodyMassKg / Math.max(1, prey.genome.bodyMassKg);
    const successChance = clamp(
      0.25 + 0.35 * clamp(massRatio / 3, 0, 1) + 0.25 * genome.aggression - prey.health * 0.25,
      0.05,
      0.95,
    );
    if (!world.rng.chance(successChance)) {
      if (world.rng.chance(0.1)) {
        individual.health = clamp(individual.health - 0.05, 0, 1);
        injuries += 1;
      }
      continue;
    }
    prey.alive = false;
    prey.health = 0;
    world.recordDeath(prey.speciesId, 'predation');
    const meatAvailable = prey.genome.bodyMassKg * meatKcalPerKg(genome) * 0.9;
    gained += meatAvailable * (1 + effects.foodYield * 0.5);
    kills += 1;
  }
  if (kills === 0) {
    return { reward: -0.2, note: 'no successful hunt' };
  }
  addEnergy(world, individual, gained);
  individual.memoryStrength = clamp(individual.memoryStrength + 0.06, 0, 1);
  return {
    reward: clamp(gained / demand - 0.15 - injuries * 0.05, -1, 1),
    note: kills > 1 ? `${kills} kills` : 'kill',
  };
};

const doMate = (world: SimulationContext, individual: Individual): ActionResult => {
  if (world.populationOf(individual.speciesId) >= world.maxPopulation) {
    return { reward: -0.1, note: 'species population ceiling reached' };
  }
  const runtime = world.speciesById.get(individual.speciesId);
  if (!runtime) return { reward: -0.2 };
  const effects = runtime.effects;
  const candidates = sampleOccupants(world, individual.cell, 16, individual.id).filter((other) => {
    if (!other.alive || other.speciesId !== individual.speciesId) return false;
    if (other.health < 0.4 || other.energyKcal < tickDemandKcal(world, other) * 0.2) return false;
    // At least one partner must be in condition to carry a pregnancy.
    return canReproduceNow(other, world.currentYear) || canReproduceNow(individual, world.currentYear);
  });
  if (candidates.length === 0) {
    return { reward: -0.25, note: 'no receptive mate nearby' };
  }
  const mate = candidates[Math.floor(world.rng.next() * candidates.length)] as Individual;
  const budget = tickDemandKcal(world, individual);
  const cost = budget * 0.12;
  if (individual.energyKcal < cost * 1.5 || mate.energyKcal < cost * 1.5) {
    return { reward: -0.3, note: 'not enough energy to reproduce' };
  }
  individual.energyKcal -= cost;
  mate.energyKcal -= cost;
  individual.lastBirthYear = world.currentYear;
  mate.lastBirthYear = world.currentYear;

  if (!world.rng.chance(0.55 * (1 + effects.fertility))) {
    return { reward: 0.05, note: 'mating without conception' };
  }

  // Births per reproductive event scale with the tick and the species' reproductive
  // lifespan. A five-year tick for a 70-year human is roughly two births; for an
  // 18-year grazer it is a full litter.
  const clutch = clamp(
    Math.round(
      (individual.genome.fertility * world.yearsPerTick) /
        Math.max(1, individual.genome.lifespanYears * 0.12),
    ),
    1,
    8,
  );
  for (let k = 0; k < clutch && world.populationOf(individual.speciesId) < world.maxPopulation; k++) {
    const child = createOffspring({
      id: world.nextId(),
      species: runtime.resolved,
      motherGenome: individual.genome,
      fatherGenome: mate.genome,
      rng: world.rng,
      cell: individual.cell,
      tick: world.tick,
      inheritedKnowledge: 0,
      yearsPerTick: world.yearsPerTick,
    });
    child.parentIds = [individual.id, mate.id];
    individual.offspringCount += 1;
    mate.offspringCount += 1;
    world.addOffspring(child);
    world.recordBirth(individual.speciesId);
  }
  return { reward: 0.35, note: 'offspring produced' };
};

const canReproduceNow = (individual: Individual, year: number): boolean => {
  if (individual.health < 0.35) return false;
  const fertileStart = 0.14 * individual.genome.lifespanYears;
  const fertileEnd = 0.68 * individual.genome.lifespanYears;
  if (individual.ageYears < fertileStart || individual.ageYears > fertileEnd) return false;
  const spacing = Math.max(0.5, individual.genome.lifespanYears * 0.03);
  return year - individual.lastBirthYear >= spacing;
};

const doRest = (world: SimulationContext, individual: Individual): ActionResult => {
  individual.health = clamp(individual.health + 0.035, 0, 1);
  individual.memoryStrength = clamp(individual.memoryStrength + 0.02, 0, 1);
  return { reward: individual.health < 0.7 ? 0.15 : 0.02 };
};

const doExplore = (world: SimulationContext, individual: Individual): ActionResult => {
  const target = chooseMoveCell(world, individual);
  if (target !== individual.cell) {
    world.move(individual, target);
    return { reward: 0.12 };
  }
  return { reward: 0 };
};

const doTeach = (world: SimulationContext, individual: Individual): ActionResult => {
  const candidates = sampleOccupants(world, individual.cell, 12, individual.id).filter(
    (other) => other.alive && other.speciesId === individual.speciesId,
  );
  if (candidates.length === 0) return { reward: -0.15, note: 'nobody to teach' };
  const student = candidates[Math.floor(world.rng.next() * candidates.length)] as Individual;
  const missing = individual.knowledge & ~student.knowledge;
  if (missing === 0) return { reward: -0.1, note: 'nothing the student does not know' };

  const effects = world.techEffectsFor(individual.speciesId);
  const fidelity = clamp(
    teachingFidelity(individual.brain, individual.genome, individual.genome.sociality) + effects.transmission,
    0.05,
    0.98,
  );
  const bitsToTeach = Math.min(3, countBits(missing));
  let transferred = 0;
  for (const tech of knownTechnologies(missing).slice(0, bitsToTeach)) {
    if (world.rng.chance(fidelity)) {
      student.knowledge |= tech.bit;
      transferred += 1;
    }
  }
  return { reward: transferred > 0 ? 0.1 + 0.05 * transferred : -0.1 };
};

const doSocialize = (world: SimulationContext, individual: Individual): ActionResult => {
  individual.health = clamp(individual.health + 0.012, 0, 1);
  individual.memoryStrength = clamp(individual.memoryStrength + 0.01, 0, 1);
  return { reward: 0.06 };
};

const doInnovate = (world: SimulationContext, individual: Individual): ActionResult => {
  const available = availableTechnologies(individual.knowledge);
  if (available.length === 0) return { reward: -0.2, note: 'nothing left to discover' };
  const effects = world.techEffectsFor(individual.speciesId);
  const perYear = innovationChancePerYear(individual.brain, individual.genome) * (1 + effects.innovation);
  const chance = 1 - pow(1 - perYear, world.yearsPerTick);
  if (!world.rng.chance(chance)) {
    return { reward: -0.05 };
  }
  const tech = available[Math.floor(world.rng.next() * available.length)] as (typeof available)[number];
  individual.knowledge |= tech.bit;
  // Species-level first discoveries are emitted by `updateTech` when the cultural
  // union gains a technology. Per-individual attempts would flood the event log and
  // crowd out wars, outbreaks and theories.
  return { reward: 0.4, note: tech.name };
};

const doFlee = (world: SimulationContext, individual: Individual): ActionResult => {
  const target = chooseMoveCell(world, individual);
  if (target !== individual.cell) world.move(individual, target);
  return { reward: 0.05 };
};

const ACTION_HANDLERS: Record<ActionId, (world: SimulationContext, individual: Individual) => ActionResult> = {
  forage: doForage,
  hunt: doHunt,
  mate: doMate,
  rest: doRest,
  explore: doExplore,
  teach: doTeach,
  socialize: doSocialize,
  innovate: doInnovate,
  flee: doFlee,
};

const countBits = (value: number): number => {
  let n = value >>> 0;
  let count = 0;
  while (n > 0) {
    count += n & 1;
    n >>>= 1;
  }
  return count;
};

/** Run one individual's decision and action for this tick. */
export const act = (world: SimulationContext, individual: Individual): void => {
  if (!individual.alive) return;
  const perception = buildPerception(world, individual);
  updateRegionActivity(individual.brain, perception);
  const utilities = actionUtilities(individual.brain, perception, individual.genome);
  const action = chooseAction(individual.brain, utilities, world.rng, individual.genome);
  individual.lastAction = action;
  world.recordAction(action);
  world.recordSpeciesAction(individual.speciesId, action);
  const result = ACTION_HANDLERS[action](world, individual);
  learnFromAction(individual.brain, individual.genome, action, result.reward);
};

export const ACTION_LABELS = ACTIONS;
export const canReproduce = canReproduceNow;
export const countKnownTechs = (individual: Individual): number => knownTechnologies(individual.knowledge).length;
export const knowsTech = (individual: Individual, id: string): boolean => hasTech(individual.knowledge, id);

/** Exposed for tests and experiments: the expected productivity of a cell. */
export const cellPlantPotentialKcal = (
  biome: Parameters<typeof plantEdibleFraction>[0],
  nppKcalPerKm2: number,
  cellAreaKm2: number,
  harvestedAreaFraction: number,
): number => nppKcalPerKm2 * cellAreaKm2 * plantEdibleFraction(biome) * harvestedAreaFraction;

/** Latitude of an individual's cell, for reports. */
export const latitudeOf = (world: SimulationContext, individual: Individual): number =>
  cellLatLon(individual.cell % world.terrain.width, Math.floor(individual.cell / world.terrain.width), world.terrain.width, world.terrain.height).latDeg;
