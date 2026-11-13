import { Rng } from '../core/rng.ts';
import { clamp, mean } from '../core/math.ts';
import { digest } from '../core/registry.ts';
import { surfaceTemperatureC } from '../cosmos/planet.ts';
import { buildDeepTimeProjection, type DeepTimeOptions } from '../cosmos/deep-time.ts';
import { buildFutureHistory } from '../society/future.ts';
import { stateAt } from '../cosmos/orbit.ts';
import { findBody, resolveSystem, type StarSystem, type SystemBody } from '../cosmos/system.ts';
import { generateTerrain, neighbouringCells, type Terrain } from '../geo/terrain.ts';
import { computeClimate, seasonPhaseFor, type Climate } from '../geo/climate.ts';
import { BIOMES, plantEdibleFraction, type BiomeId } from '../geo/biomes.ts';
import { resolveSpecies, type ResolvedSpecies } from '../bio/species.ts';
import {
  ageMortalityHazard,
  energyCapacityKcal,
  thermalStressC,
  thermoregulationCostFraction,
  tickEnergyDemandKcal,
} from '../bio/metabolism.ts';
import { meanGenome, type Genome } from '../bio/genome.ts';
import { cognitionScore, configureRegion, vitalTone } from '../neuro/brain.ts';
import { ACTIONS } from '../neuro/actions.ts';
import { createIndividual, type Individual } from '../society/individual.ts';
import { personName, settlementName } from '../society/names.ts';
import { act } from '../society/actions.ts';
import {
  addTech,
  countTechs,
  knownTechnologies,
  techEffects,
  techMaskOf,
  ZERO_TECH_EFFECTS,
  type TechEffects,
} from '../society/technology.ts';
import type { SimulationContext, SpeciesRuntime, WorldEvent } from '../society/context.ts';
import { resolveFounders, validateScenario, type FoundingSpec, type Intervention, type Scenario } from './scenario.ts';
import type { RunResult, Series, SpeciesSummary } from './report.ts';
import type { ChronicleEvent, ChronicleSnapshot, ResidentView } from './chronicle.ts';
import { surfaceGravity } from '../cosmos/planet.ts';
import type { Planet } from '../cosmos/planet.ts';
import type { Star } from '../cosmos/star.ts';

const EVENTS_LIMIT = 2000;

/**
 * The simulation world.
 *
 * It owns state and the tick loop. Behaviour lives in `society/actions.ts`, anatomy in
 * `neuro` and `bio`, and the physical environment in `cosmos` and `geo`. Systems run in
 * a fixed phase order so runs are reproducible.
 */
export class World implements SimulationContext {
  readonly scenario: Scenario;
  readonly seed: number;
  readonly ticks: number;
  readonly yearsPerTick: number;
  readonly maxPopulation: number;
  readonly harvestedAreaFraction: number;

  tick = 0;
  currentYear = 0;
  temperatureOffsetC = 0;

  readonly system: StarSystem;
  readonly focusBody: SystemBody;
  readonly star: Star;
  readonly planet: Planet;
  readonly terrain: Terrain;
  climate: Climate;
  readonly foodStock: Float64Array;
  readonly foodCapacity: Float64Array;
  readonly preyBiomassKg: Float64Array;
  readonly predatorBiomassKg: Float64Array;

  individuals: Individual[] = [];
  readonly speciesById = new Map<string, SpeciesRuntime>();
  readonly events: WorldEvent[] = [];
  readonly deathCauses = new Map<string, number>();
  readonly actionCounts = new Map<string, number>();
  readonly actionCountsBySpecies = new Map<string, Map<string, number>>();
  readonly deathCausesBySpecies = new Map<string, Map<string, number>>();
  private readonly chronicleSnapshots: ChronicleSnapshot[] = [];
  private readonly chronicleInterval: number;
  private readonly causeCountsThisTick = new Map<string, number>();
  private readonly lastHazardEventTick = new Map<string, number>();
  private readonly lastWarTick = new Map<string, number>();

  birthsThisTick = 0;
  deathsThisTick = 0;

  readonly series: Series;
  private readonly initialPopulationBySpecies = new Map<string, number>();
  private readonly initialPopulationTotal: number;
  private readonly rootRng: Rng;
  private tickRng: Rng;
  private nextIndividualId = 1;
  private populationCounts = new Map<string, number>();
  private climateShock: { deltaC: number; untilTick: number } | null = null;

  private occupants = new Map<number, Individual[]>();
  private speciesCellCounts = new Map<number, Map<string, number>>();

  constructor(scenario: Scenario, options: { seed?: number; ticks?: number } = {}) {
    validateScenario(scenario);
    this.scenario = scenario;
    this.seed = options.seed ?? scenario.seed ?? 20260101;
    this.ticks = options.ticks ?? scenario.run.ticks;
    this.yearsPerTick = scenario.run.yearsPerTick;
    this.maxPopulation = scenario.run.maxPopulation ?? 4000;
    this.harvestedAreaFraction = scenario.world.harvestedAreaFraction ?? 0.001;
    this.chronicleInterval = Math.max(1, Math.ceil(this.ticks / 50));
    this.rootRng = new Rng(this.seed, 'world');
    this.tickRng = this.rootRng.fork('tick:0');

    this.system = resolveSystem(scenario.world.system, this.rootRng.fork('system'));
    const explicitFocus = scenario.world.focusPlanet
      ? findBody(this.system, scenario.world.focusPlanet)
      : undefined;
    const fallbackFocus =
      this.system.bodies.find((body) => body.planet.kind === 'ocean' || body.planet.kind === 'superEarth') ??
      this.system.bodies[0];
    if (!explicitFocus && !fallbackFocus) {
      throw new Error('The scenario system has no planets to simulate.');
    }
    this.focusBody = (explicitFocus ?? fallbackFocus) as SystemBody;
    this.star = this.system.star;
    this.planet = this.focusBody.planet;

    const grid = scenario.world.grid ?? { width: 64, height: 32 };
    this.terrain = generateTerrain(this.rootRng.fork('terrain'), {
      width: grid.width,
      height: grid.height,
      oceanFraction: scenario.world.oceanFraction ?? this.planet.oceanFraction,
      continentScale: scenario.world.continentScale,
      roughness: scenario.world.roughness,
      radiusKm: this.planet.radiusKm,
    });

    const size = grid.width * grid.height;
    this.foodStock = new Float64Array(size);
    this.foodCapacity = new Float64Array(size);
    this.preyBiomassKg = new Float64Array(size);
    this.predatorBiomassKg = new Float64Array(size);
    this.climate = computeClimate(this.terrain, {
      meanSurfaceTempC: surfaceTemperatureC(this.planet, this.star, this.focusBody.orbit.semiMajorAxisAu),
      axialTiltDeg: this.planet.axialTiltDeg,
      seasonPhase: 0,
    });

    for (const speciesSpec of scenario.species) {
      const resolved = resolveSpecies(speciesSpec);
      this.speciesById.set(resolved.id, {
        resolved,
        knowledgeMask: 0,
        effects: { ...ZERO_TECH_EFFECTS },
        births: 0,
        deaths: 0,
        peakPopulation: 0,
        extinct: false,
        extinctionTick: null,
      });
    }

    this.updateEnvironment();
    const founders = resolveFounders(scenario);
    for (const founding of founders) this.seedFounders(founding);
    this.rebuildIndex();
    this.updateTech();
    this.recountSpecies();

    this.initialPopulationTotal = this.individuals.length;
    for (const [id, runtime] of this.speciesById) {
      const count = this.countSpecies(id);
      runtime.peakPopulation = Math.max(runtime.peakPopulation, count);
      this.initialPopulationBySpecies.set(id, count);
    }

    this.series = {
      ticks: [],
      population: [],
      speciesPopulation: Object.fromEntries([...this.speciesById.keys()].map((id) => [id, []])),
      births: [],
      deaths: [],
      meanCognition: [],
      meanBrainMassKg: [],
      meanBodyMassKg: [],
      techCount: [],
      foodFraction: [],
      meanTempC: [],
    };
    this.recordMetrics();
  }

  /** Seeded stream for this tick; keeps behaviour stochastic but reproducible. */
  get rng(): Rng {
    return this.tickRng;
  }

  nextId(): number {
    return this.nextIndividualId++;
  }

  populationOf(speciesId: string): number {
    return this.populationCounts.get(speciesId) ?? 0;
  }

  occupantsIn(cell: number): readonly Individual[] {
    return this.occupants.get(cell) ?? EMPTY_OCCUPANTS;
  }

  sameSpeciesCount(cell: number, speciesId: string): number {
    return this.speciesCellCounts.get(cell)?.get(speciesId) ?? 0;
  }

  move(individual: Individual, toCell: number): void {
    if (toCell === individual.cell) return;
    this.removeOccupant(individual);
    individual.cell = toCell;
    this.addOccupant(individual);
  }

  addOffspring(individual: Individual): void {
    this.registerIndividual(individual);
  }

  private registerIndividual(individual: Individual): void {
    this.individuals.push(individual);
    this.addOccupant(individual);
    this.populationCounts.set(individual.speciesId, (this.populationCounts.get(individual.speciesId) ?? 0) + 1);
  }

  recordBirth(speciesId: string): void {
    const runtime = this.speciesById.get(speciesId);
    if (runtime) runtime.births += 1;
    this.birthsThisTick += 1;
  }

  recordDeath(speciesId: string, cause: string): void {
    const runtime = this.speciesById.get(speciesId);
    if (runtime) runtime.deaths += 1;
    this.deathsThisTick += 1;
    this.causeCountsThisTick.set(cause, (this.causeCountsThisTick.get(cause) ?? 0) + 1);
    this.deathCauses.set(cause, (this.deathCauses.get(cause) ?? 0) + 1);
    let speciesCauses = this.deathCausesBySpecies.get(speciesId);
    if (!speciesCauses) {
      speciesCauses = new Map();
      this.deathCausesBySpecies.set(speciesId, speciesCauses);
    }
    speciesCauses.set(cause, (speciesCauses.get(cause) ?? 0) + 1);
    this.populationCounts.set(speciesId, Math.max(0, (this.populationCounts.get(speciesId) ?? 0) - 1));
  }

  recordAction(action: string): void {
    this.actionCounts.set(action, (this.actionCounts.get(action) ?? 0) + 1);
  }

  recordSpeciesAction(speciesId: string, action: string): void {
    let counts = this.actionCountsBySpecies.get(speciesId);
    if (!counts) {
      counts = new Map();
      this.actionCountsBySpecies.set(speciesId, counts);
    }
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }

  event(kind: string, message: string, data?: Record<string, unknown>): void {
    if (this.events.length >= EVENTS_LIMIT) return;
    this.events.push({ tick: this.tick, kind, message, data });
  }

  techEffectsFor(speciesId: string): TechEffects {
    return this.speciesById.get(speciesId)?.effects ?? ZERO_TECH_EFFECTS;
  }

  /** Run the whole scenario and return a serialisable result. */
  run(): RunResult {
    for (let i = 0; i < this.ticks; i++) this.step();
    return this.toResult();
  }

  step(): void {
    this.tick += 1;
    this.currentYear = this.tick * this.yearsPerTick;
    this.birthsThisTick = 0;
    this.deathsThisTick = 0;
    this.causeCountsThisTick.clear();
    this.tickRng = this.rootRng.fork(`tick:${this.tick}`);

    this.applyInterventions();
    this.updateEnvironment();
    this.actionPhase();
    this.conflictPhase();
    this.metabolismPhase();
    this.recordHazards();
    this.diffusionPhase();
    this.compactDead();
    this.rebuildIndex();
    this.updateTech();
    this.recountSpecies();
    this.recordMetrics();
  }

  // ---------------------------------------------------------------------------
  // Environment
  // ---------------------------------------------------------------------------

  private updateEnvironment(): void {
    const distance = stateAt(this.focusBody.orbit, this.star.massSolar, this.currentYear).distanceAu;
    if (this.climateShock && this.tick >= this.climateShock.untilTick) this.climateShock = null;
    this.temperatureOffsetC = this.climateShock?.deltaC ?? 0;
    const meanTemp =
      surfaceTemperatureC(this.planet, this.star, distance) + this.temperatureOffsetC;

    this.climate = computeClimate(this.terrain, {
      meanSurfaceTempC: meanTemp,
      axialTiltDeg: this.planet.axialTiltDeg,
      seasonPhase: seasonPhaseFor(this.currentYear),
    });

    const seasonal = 0.7 + 0.3 * Math.cos(seasonPhaseFor(this.currentYear));
    for (let cell = 0; cell < this.foodCapacity.length; cell++) {
      if (this.terrain.isOcean[cell] === 1) {
        this.foodCapacity[cell] = 0;
        this.foodStock[cell] = 0;
        continue;
      }
      const biome = this.climate.biome[cell] as BiomeId;
      this.foodCapacity[cell] =
        (this.climate.nppKcalPerKm2[cell] as number) *
        (this.climate.cellAreaKm2[cell] as number) *
        plantEdibleFraction(biome) *
        this.harvestedAreaFraction *
        this.yearsPerTick;
      this.foodStock[cell] = this.foodCapacity[cell] * seasonal;
    }
    this.rebuildIndex();
  }

  /** Rebuild spatial indexes from the living population. */
  private rebuildIndex(): void {
    this.occupants = new Map();
    this.speciesCellCounts = new Map();
    this.preyBiomassKg.fill(0);
    this.predatorBiomassKg.fill(0);
    for (const individual of this.individuals) {
      if (!individual.alive) continue;
      this.addOccupant(individual);
      const runtime = this.speciesById.get(individual.speciesId);
      if (!runtime) continue;
      if (runtime.resolved.role === 'carnivore') {
        this.predatorBiomassKg[individual.cell] += individual.genome.bodyMassKg;
      } else {
        this.preyBiomassKg[individual.cell] += individual.genome.bodyMassKg;
      }
    }
  }

  private addOccupant(individual: Individual): void {
    const bucket = this.occupants.get(individual.cell);
    if (bucket) bucket.push(individual);
    else this.occupants.set(individual.cell, [individual]);
    let counts = this.speciesCellCounts.get(individual.cell);
    if (!counts) {
      counts = new Map();
      this.speciesCellCounts.set(individual.cell, counts);
    }
    counts.set(individual.speciesId, (counts.get(individual.speciesId) ?? 0) + 1);
  }

  private removeOccupant(individual: Individual): void {
    const bucket = this.occupants.get(individual.cell);
    if (bucket) {
      const index = bucket.indexOf(individual);
      if (index >= 0) bucket.splice(index, 1);
    }
    const counts = this.speciesCellCounts.get(individual.cell);
    if (counts) {
      const next = (counts.get(individual.speciesId) ?? 0) - 1;
      if (next <= 0) counts.delete(individual.speciesId);
      else counts.set(individual.speciesId, next);
    }
  }

  // ---------------------------------------------------------------------------
  // Phases
  // ---------------------------------------------------------------------------

  private actionPhase(): void {
    const order = this.individuals.filter((individual) => individual.alive);
    this.tickRng.shuffle(order);
    for (const individual of order) {
      if (!individual.alive) continue;
      act(this, individual);
    }
  }

  private metabolismPhase(): void {
    for (const individual of this.individuals) {
      if (!individual.alive) continue;
      individual.ageYears += this.yearsPerTick;
      const effects = this.techEffectsFor(individual.speciesId);
      const temp = (this.climate.temperatureC[individual.cell] as number) + effects.coldResistanceC;
      const demand = tickEnergyDemandKcal(individual.genome, this.yearsPerTick);
      const thermal = thermoregulationCostFraction(individual.genome, temp);
      const activity = individual.lastAction === 'rest' ? 0.75 : individual.lastAction === 'hunt' ? 1.15 : 1;
      const cost = demand * (1 + thermal) * activity;
      // Routine subsistence: an organism that spent the tick doing something other
      // than an explicit forage/hunt still ate as it went about its business. This
      // matters because one tick can represent years; without it, every individual
      // would have to dedicate every tick to feeding.
      const passive =
        individual.lastAction === 'forage' || individual.lastAction === 'hunt'
          ? 0
          : demand * (individual.genome.diet > 0.5 ? 0.9 : 0.75);
      individual.energyKcal = clamp(
        individual.energyKcal + passive - cost,
        0,
        energyCapacityKcal(individual.genome, this.yearsPerTick),
      );

      let starved = false;
      if (individual.energyKcal <= 0) {
        individual.energyKcal = 0;
        starved = true;
        individual.health = clamp(individual.health - 0.2, 0, 1);
      } else if (individual.energyKcal < demand * 0.2) {
        individual.health = clamp(individual.health - 0.06, 0, 1);
      } else {
        individual.health = clamp(individual.health + 0.02, 0, 1);
      }
      individual.memoryStrength = clamp(individual.memoryStrength * 0.96, 0, 1);

      const survival = clamp(effects.survival, 0, 0.85);
      const vital = vitalTone(individual.brain);
      const density = this.sameSpeciesCount(individual.cell, individual.speciesId);
      const hazards: [string, number][] = [
        ['old age', ageMortalityHazard(individual.genome, individual.ageYears) * (1 - survival)],
        ['autonomic failure', vital < 1 ? (1 - vital) * 1.9 : 0],
        [
          'disease',
          0.000012 * density * density * (1 - individual.genome.diseaseResistance * 0.8) * (1 - survival),
        ],
        ['exposure', Math.max(0, thermalStressC(individual.genome, temp) - 12) * 0.006],
        ['starvation', starved ? 3 : 0],
        ['injury', individual.health <= 0 ? 12 : 0],
      ];
      const hazardPerYear = hazards.reduce((total, [, value]) => total + value, 0);
      const chance = 1 - (1 - clamp(hazardPerYear, 0, 0.999)) ** this.yearsPerTick;
      if (this.tickRng.chance(chance)) {
        const roll = this.tickRng.next() * hazardPerYear;
        let cause = 'unknown';
        let accumulated = 0;
        for (const [label, value] of hazards) {
          accumulated += value;
          if (roll <= accumulated) {
            cause = label;
            break;
          }
        }
        this.kill(individual, cause);
      }
    }
  }

  /** Cultural diffusion: knowledge spreads among co-located conspecifics. */
  private diffusionPhase(): void {
    for (const bucket of this.occupants.values()) {
      if (bucket.length < 2) continue;
      const bySpecies = new Map<string, Individual[]>();
      for (const individual of bucket) {
        if (!individual.alive) continue;
        const list = bySpecies.get(individual.speciesId);
        if (list) list.push(individual);
        else bySpecies.set(individual.speciesId, [individual]);
      }
      for (const [speciesId, group] of bySpecies) {
        if (group.length < 2) continue;
        let union = 0;
        for (const individual of group) union |= individual.knowledge;
        if (union === 0) continue;
        const runtime = this.speciesById.get(speciesId);
        if (!runtime) continue;
        const p = clamp(0.1 + runtime.effects.transmission * 0.4 + runtime.resolved.genome.sociality * 0.12, 0, 0.9);
        for (const individual of group) {
          const missing = union & ~individual.knowledge;
          if (missing === 0) continue;
          if (this.tickRng.chance(p)) {
            individual.knowledge |= missing & this.randomKnownBit(missing);
          }
        }
      }
    }
  }

  private randomKnownBit(mask: number): number {
    const bits: number[] = [];
    let rest = mask >>> 0;
    while (rest > 0) {
      const lowest = rest & -rest;
      bits.push(lowest);
      rest ^= lowest;
    }
    if (bits.length === 0) return 0;
    return bits[Math.floor(this.tickRng.next() * bits.length)] as number;
  }

  private compactDead(): void {
    if (this.individuals.some((individual) => !individual.alive)) {
      this.individuals = this.individuals.filter((individual) => individual.alive);
    }
  }

  private updateTech(): void {
    const masks = new Map<string, number>();
    for (const individual of this.individuals) {
      if (!individual.alive) continue;
      masks.set(individual.speciesId, (masks.get(individual.speciesId) ?? 0) | individual.knowledge);
    }
    for (const [id, runtime] of this.speciesById) {
      const next = masks.get(id) ?? 0;
      const gained = next & ~runtime.knowledgeMask;
      if (gained !== 0) {
        for (const tech of knownTechnologies(gained)) {
          const theory = tech.category === 'theory';
          this.event(
            theory ? 'theory' : 'technology',
            `${runtime.resolved.name} ${theory ? 'formulated' : 'mastered'} ${tech.name}`,
            { speciesId: id, technology: tech.id, description: tech.description },
          );
        }
      }
      runtime.knowledgeMask = next;
      runtime.effects = techEffects(next);
    }
  }

  /**
   * Territorial conflict between neighbouring settlements of the same lineage.
   *
   * A raid needs a dense settlement, a neighbouring group, an encephalised species
   * and some aggression. It is intentionally bounded: a few deaths and a chronicle
   * entry, not a separate war simulation.
   */
  private conflictPhase(): void {
    for (const [id, runtime] of this.speciesById) {
      const species = runtime.resolved;
      const encephalisation = species.genome.brainMassKg / Math.max(1, species.genome.bodyMassKg);
      if (species.role === 'carnivore' || encephalisation < 0.012 || species.genome.aggression < 0.3) continue;
      if (this.tick - (this.lastWarTick.get(id) ?? -999) < 8) continue;

      const pairs: [number, number][] = [];
      for (const [cell, counts] of this.speciesCellCounts) {
        if ((counts.get(id) ?? 0) < 8) continue;
        for (const neighbour of neighbouringCells(cell, this.terrain.width, this.terrain.height)) {
          if (this.terrain.isOcean[neighbour] === 1) continue;
          if ((this.speciesCellCounts.get(neighbour)?.get(id) ?? 0) >= 4) pairs.push([cell, neighbour]);
        }
      }
      if (pairs.length === 0) continue;
      const chance = Math.min(0.12, 0.004 * (1 + species.genome.aggression) * this.yearsPerTick);
      if (!this.tickRng.chance(chance)) continue;

      const [attackerCell, defenderCell] = pairs[this.tickRng.int(0, pairs.length)] as [number, number];
      const attacker = settlementName(attackerCell, this.seed);
      const defender = settlementName(defenderCell, this.seed);
      const attackerDeaths = this.killFromCell(attackerCell, id, 1 + this.tickRng.int(0, 2));
      const defenderDeaths = this.killFromCell(defenderCell, id, 1 + this.tickRng.int(0, 2));
      if (attackerDeaths + defenderDeaths === 0) continue;
      this.lastWarTick.set(id, this.tick);
      this.event('war', `${attacker} raided ${defender}`, {
        speciesId: id,
        attacker,
        defender,
        deaths: attackerDeaths + defenderDeaths,
        attackerCell,
        defenderCell,
      });
    }
  }

  private killFromCell(cell: number, speciesId: string, count: number): number {
    const victims = this.occupantsIn(cell).filter(
      (individual) => individual.alive && individual.speciesId === speciesId,
    );
    let killed = 0;
    while (killed < count && victims.length > 0) {
      const index = this.tickRng.int(0, victims.length);
      const victim = victims.splice(index, 1)[0] as Individual;
      this.kill(victim, 'war');
      killed += 1;
    }
    return killed;
  }

  /** Emit outbreaks rather than one event per death. */
  private recordHazards(): void {
    let population = 0;
    for (const count of this.populationCounts.values()) population += count;
    const disease = this.causeCountsThisTick.get('disease') ?? 0;
    const accidents = (this.causeCountsThisTick.get('injury') ?? 0) + (this.causeCountsThisTick.get('exposure') ?? 0);
    if (disease >= Math.max(8, Math.round(population * 0.015)) && this.canEmitHazard('plague', 25)) {
      this.event('plague', `Disease outbreak: ${disease} dead`, { deaths: disease });
    }
    if (accidents >= 3 && this.canEmitHazard('accident', 15)) {
      this.event('accident', `Accidents and exposure killed ${accidents}`, { deaths: accidents });
    }
  }

  private canEmitHazard(kind: string, gap: number): boolean {
    const last = this.lastHazardEventTick.get(kind) ?? -999;
    if (this.tick - last < gap) return false;
    this.lastHazardEventTick.set(kind, this.tick);
    return true;
  }

  /** Capture a bounded, stable sample of the living world for the chronicle page. */
  private recordChronicle(): void {
    const living = this.individuals.filter((individual) => individual.alive);
    const counts = new Map<number, number>();
    const sapientCounts = new Map<number, number>();
    for (const individual of living) {
      counts.set(individual.cell, (counts.get(individual.cell) ?? 0) + 1);
      if (individual.genome.brainMassKg / Math.max(1, individual.genome.bodyMassKg) >= 0.012) {
        sapientCounts.set(individual.cell, (sapientCounts.get(individual.cell) ?? 0) + 1);
      }
    }
    let centerCell = -1;
    let best = -1;
    for (const [cell, count] of sapientCounts.size > 0 ? sapientCounts : counts) {
      if (count > best || (count === best && (centerCell < 0 || cell < centerCell))) {
        best = count;
        centerCell = cell;
      }
    }
    if (centerCell < 0) centerCell = Math.floor((this.terrain.width * this.terrain.height) / 2);

    const regionWidth = Math.min(11, this.terrain.width);
    const regionHeight = Math.min(9, this.terrain.height);
    const centerX = centerCell % this.terrain.width;
    const centerY = Math.floor(centerCell / this.terrain.width);
    const originX = clamp(centerX - Math.floor(regionWidth / 2), 0, this.terrain.width - regionWidth);
    const originY = clamp(centerY - Math.floor(regionHeight / 2), 0, this.terrain.height - regionHeight);

    const biome: ChronicleSnapshot['region']['biome'] = [];
    const population: number[] = [];
    for (let y = 0; y < regionHeight; y++) {
      for (let x = 0; x < regionWidth; x++) {
        const cell = (originY + y) * this.terrain.width + (originX + x);
        biome.push(this.climate.biome[cell] as ChronicleSnapshot['region']['biome'][number]);
        population.push(counts.get(cell) ?? 0);
      }
    }

    const inRegion = living
      .filter((individual) => {
        const x = individual.cell % this.terrain.width;
        const y = Math.floor(individual.cell / this.terrain.width);
        return x >= originX && x < originX + regionWidth && y >= originY && y < originY + regionHeight;
      })
      .sort((a, b) => a.id - b.id);
    const stride = Math.max(1, Math.ceil(inRegion.length / 36));
    const picked = inRegion.filter((_, index) => index % stride === 0).slice(0, 36);
    for (const speciesId of this.speciesById.keys()) {
      if (picked.some((individual) => individual.speciesId === speciesId)) continue;
      const candidate = inRegion.find((individual) => individual.speciesId === speciesId);
      if (candidate) picked.push(candidate);
    }

    const residents: ResidentView[] = picked.map((individual) => {
      const species = this.speciesById.get(individual.speciesId)?.resolved;
      const sapient = individual.genome.brainMassKg / Math.max(1, individual.genome.bodyMassKg) >= 0.012;
      const jitterX = ((Math.imul(individual.id, 2654435761) >>> 0) % 1000) / 1000;
      const jitterY = ((Math.imul(individual.id, 40503) >>> 0) % 1000) / 1000;
      const action = individual.lastAction;
      return {
        id: individual.id,
        name: personName(individual.id, species?.name ?? individual.speciesId, sapient),
        speciesId: individual.speciesId,
        speciesName: species?.name ?? individual.speciesId,
        color: species?.color ?? '#f2c14e',
        cell: individual.cell,
        action: action ?? 'idle',
        actionLabel: action ? ACTIONS[action].label : 'Idle',
        ageYears: individual.ageYears,
        energy:
          (individual.energyKcal / Math.max(1, energyCapacityKcal(individual.genome, this.yearsPerTick))) * 100,
        health: individual.health * 100,
        techs: knownTechnologies(individual.knowledge).length,
        known: knownTechnologies(individual.knowledge).slice(0, 3).map((tech) => tech.name),
        offspring: individual.offspringCount,
        sapient,
        x: jitterX,
        y: jitterY,
      };
    });

    this.chronicleSnapshots.push({
      tick: this.tick,
      year: this.currentYear,
      population: living.length,
      settlements: [...counts.values()].filter((count) => count >= 4).length,
      centerCell,
      place: settlementName(centerCell, this.seed),
      region: { width: regionWidth, height: regionHeight, originX, originY, centerX, centerY, biome, population },
      residents,
    });
  }

  private ledger(kinds: readonly string[], firstPerTechnology = false): ChronicleEvent[] {
    const seen = new Set<string>();
    const entries: ChronicleEvent[] = [];
    for (const event of this.events) {
      if (!kinds.includes(event.kind)) continue;
      const data = event.data ?? {};
      const speciesId = typeof data.speciesId === 'string' ? data.speciesId : undefined;
      const techId = typeof data.technology === 'string' ? data.technology : undefined;
      if (firstPerTechnology && techId) {
        const key = `${speciesId ?? 'any'}:${techId}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      let detail = typeof data.description === 'string' ? data.description : '';
      if (typeof data.deaths === 'number') detail = `${data.deaths} dead`;
      if (typeof data.killed === 'number') detail = `${data.killed} dead`;
      entries.push({
        tick: event.tick,
        year: event.tick * this.yearsPerTick,
        title: event.message,
        detail,
        speciesId,
        techId,
      });
    }
    return entries;
  }

  private kill(individual: Individual, cause: string): void {
    if (!individual.alive) return;
    individual.alive = false;
    individual.health = 0;
    this.recordDeath(individual.speciesId, cause);
  }

  private countSpecies(speciesId: string): number {
    let count = 0;
    for (const individual of this.individuals) {
      if (individual.alive && individual.speciesId === speciesId) count += 1;
    }
    return count;
  }

  private recountSpecies(): void {
    for (const [id, runtime] of this.speciesById) {
      const count = this.countSpecies(id);
      runtime.peakPopulation = Math.max(runtime.peakPopulation, count);
      if (count === 0 && !runtime.extinct && runtime.peakPopulation > 0) {
        runtime.extinct = true;
        runtime.extinctionTick = this.tick;
        this.event('extinction', `Species ${runtime.resolved.name} went extinct`, {
          speciesId: id,
          tick: this.tick,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Founding and interventions
  // ---------------------------------------------------------------------------

  private seedFounders(founding: FoundingSpec): void {
    const runtime = this.speciesById.get(founding.speciesId);
    if (!runtime) throw new Error(`Cannot seed unknown species "${founding.speciesId}"`);
    const species = runtime.resolved;
    const count = founding.count ?? species.defaultCount ?? 40;
    if (count <= 0) return;
    let candidates = this.candidateCells(species, founding);
    // Carnivores cannot establish where there is nothing to eat: found them among
    // already-seeded prey if any exist.
    if (species.role === 'carnivore') {
      const preyCells = candidates.filter((cell) => this.hasLivingPrey(cell));
      if (preyCells.length > 0) candidates = preyCells;
    }
    if (candidates.length === 0) {
      throw new Error(
        `No suitable cells for species "${species.id}". Relax preferBiomes/temperature bounds or change the world.`,
      );
    }
    const settlements = this.pickSettlements(candidates, species, clamp(Math.ceil(count / 8), 1, 24));
    const knowledge = founding.startingTech ? techMaskOf(founding.startingTech) : 0;

    for (let i = 0; i < count; i++) {
      const cell = settlements[i % settlements.length] as number;
      const individual = createIndividual({
        id: this.nextId(),
        species,
        rng: this.tickRng,
        cell,
        tick: this.tick,
        ageYears: this.tickRng.float(0.18, 0.42) * species.genome.lifespanYears,
        knowledge,
        yearsPerTick: this.yearsPerTick,
      });
      this.registerIndividual(individual);
    }
  }

  private hasLivingPrey(cell: number): boolean {
    const bucket = this.occupants.get(cell);
    if (!bucket) return false;
    for (const individual of bucket) {
      if (!individual.alive) continue;
      const runtime = this.speciesById.get(individual.speciesId);
      if (runtime && runtime.resolved.role !== 'carnivore') return true;
    }
    return false;
  }

  private candidateCells(species: ResolvedSpecies, founding: FoundingSpec): number[] {
    const cells: number[] = [];
    const prefer = founding.preferBiomes ? new Set<BiomeId>(founding.preferBiomes) : null;
    for (let cell = 0; cell < this.terrain.isOcean.length; cell++) {
      if (this.terrain.isOcean[cell] === 1) continue;
      const biome = this.climate.biome[cell] as BiomeId;
      if (prefer && !prefer.has(biome)) continue;
      const temp = this.climate.temperatureC[cell] as number;
      if (founding.minTempC !== undefined && temp < founding.minTempC) continue;
      if (founding.maxTempC !== undefined && temp > founding.maxTempC) continue;
      cells.push(cell);
    }
    return cells;
  }

  private pickSettlements(candidates: number[], species: ResolvedSpecies, count: number): number[] {
    const weights = candidates.map((cell) => {
      const biome = this.climate.biome[cell] as BiomeId;
      const temp = this.climate.temperatureC[cell] as number;
      const habitability = BIOMES[biome].habitability + 0.01;
      const rugged = 1 - (this.terrain.ruggedness[cell] as number) * 0.3;
      const thermal = Math.exp(-thermalStressC(species.genome, temp) / 18);
      return Math.max(1e-4, habitability * rugged * thermal);
    });
    const chosen: number[] = [];
    const used = new Set<number>();
    for (let i = 0; i < count; i++) {
      let cell = -1;
      for (let attempt = 0; attempt < 32; attempt++) {
        const index = this.tickRng.weightedIndex(weights);
        if (index < 0) break;
        const candidate = candidates[index] as number;
        if (!used.has(candidate)) {
          cell = candidate;
          break;
        }
      }
      if (cell < 0) {
        const fallback = candidates[this.tickRng.int(0, candidates.length)] as number;
        if (used.has(fallback) && used.size < candidates.length) {
          const unused = candidates.filter((c) => !used.has(c));
          cell = unused[this.tickRng.int(0, unused.length)] as number;
        } else {
          cell = fallback;
        }
      }
      used.add(cell);
      chosen.push(cell);
    }
    return chosen;
  }

  private applyInterventions(): void {
    const interventions = this.scenario.interventions ?? [];
    for (const intervention of interventions) {
      if (intervention.atTick !== this.tick) continue;
      this.applyIntervention(intervention);
    }
  }

  private applyIntervention(intervention: Intervention): void {
    switch (intervention.kind) {
      case 'ablateRegion': {
        let affected = 0;
        for (const individual of this.individuals) {
          if (!this.matchesSpecies(individual, intervention.speciesId)) continue;
          if (!this.tickRng.chance(intervention.fraction ?? 1)) continue;
          configureRegion(individual.brain, intervention.regionId, { present: false });
          affected += 1;
        }
        this.event('intervention', `Ablated ${intervention.regionId} in ${affected} individuals`, { affected });
        break;
      }
      case 'boostRegion': {
        let affected = 0;
        for (const individual of this.individuals) {
          if (!this.matchesSpecies(individual, intervention.speciesId)) continue;
          if (!this.tickRng.chance(intervention.fraction ?? 1)) continue;
          const state = individual.brain.regions[intervention.regionId];
          configureRegion(individual.brain, intervention.regionId, {
            present: true,
            scale: (state?.scale ?? 1) * intervention.scale,
          });
          affected += 1;
        }
        this.event('intervention', `Enlarged ${intervention.regionId} ×${intervention.scale} in ${affected} individuals`, {
          affected,
        });
        break;
      }
      case 'plague': {
        let killed = 0;
        for (const individual of this.individuals) {
          if (!individual.alive || !this.matchesSpecies(individual, intervention.speciesId)) continue;
          const resistance = individual.genome.diseaseResistance * 0.7;
          if (this.tickRng.chance(intervention.mortality * (1 - resistance))) {
            this.kill(individual, 'plague');
            killed += 1;
          }
        }
        this.event('plague', `Plague killed ${killed} individuals`, { killed });
        break;
      }
      case 'teach': {
        let taught = 0;
        for (const individual of this.individuals) {
          if (!individual.alive || !this.matchesSpecies(individual, intervention.speciesId)) continue;
          if (!this.tickRng.chance(intervention.fraction ?? 1)) continue;
          individual.knowledge = addTech(individual.knowledge, intervention.technology);
          taught += 1;
        }
        this.updateTech();
        this.event('intervention', `Taught ${intervention.technology} to ${taught} individuals`, { taught });
        break;
      }
      case 'climateShock': {
        this.climateShock = {
          deltaC: intervention.deltaC,
          untilTick: this.tick + Math.max(1, intervention.durationTicks),
        };
        this.event('intervention', `Climate shock of ${intervention.deltaC > 0 ? '+' : ''}${intervention.deltaC} °C`, {});
        break;
      }
      case 'introduceSpecies': {
        const runtime = this.speciesById.get(intervention.speciesId);
        if (!runtime) throw new Error(`Cannot introduce unknown species "${intervention.speciesId}"`);
        const candidates = this.candidateCells(runtime.resolved, { speciesId: intervention.speciesId });
        const settlements = this.pickSettlements(candidates, runtime.resolved, Math.max(1, Math.ceil(intervention.count / 20)));
        for (let i = 0; i < intervention.count; i++) {
          const cell = settlements[i % settlements.length] as number;
          const individual = createIndividual({
            id: this.nextId(),
            species: runtime.resolved,
            rng: this.tickRng,
            cell,
            tick: this.tick,
            ageYears: this.tickRng.float(0.18, 0.42) * runtime.resolved.genome.lifespanYears,
            yearsPerTick: this.yearsPerTick,
          });
          this.registerIndividual(individual);
        }
        this.event('intervention', `Introduced ${intervention.count} ${runtime.resolved.name}`, {});
        break;
      }
    }
  }

  private matchesSpecies(individual: Individual, speciesId: string | undefined): boolean {
    if (!individual.alive) return false;
    return speciesId === undefined || individual.speciesId === speciesId;
  }

  // ---------------------------------------------------------------------------
  // Metrics and results
  // ---------------------------------------------------------------------------

  private recordMetrics(): void {
    const living = this.individuals.filter((individual) => individual.alive);
    const cognitions = living.map((individual) => cognitionScore(individual.brain));
    const brains = living.map((individual) => individual.genome.brainMassKg);
    const bodies = living.map((individual) => individual.genome.bodyMassKg);
    let stocked = 0;
    let capacityTotal = 0;
    for (let cell = 0; cell < this.foodCapacity.length; cell++) {
      if ((this.foodCapacity[cell] as number) <= 0) continue;
      stocked += (this.foodStock[cell] as number) / (this.foodCapacity[cell] as number);
      capacityTotal += 1;
    }
    const allTech = living.reduce((mask, individual) => mask | individual.knowledge, 0);

    this.series.ticks.push(this.tick);
    this.series.population.push(living.length);
    this.series.births.push(this.birthsThisTick);
    this.series.deaths.push(this.deathsThisTick);
    this.series.meanCognition.push(mean(cognitions));
    this.series.meanBrainMassKg.push(mean(brains));
    this.series.meanBodyMassKg.push(mean(bodies));
    this.series.techCount.push(countTechs(allTech));
    this.series.foodFraction.push(capacityTotal > 0 ? stocked / capacityTotal : 0);
    this.series.meanTempC.push(this.climate.meanTempC);
    for (const [id, runtime] of this.speciesById) {
      this.series.speciesPopulation[id]?.push(this.countSpecies(id));
      void runtime;
    }
    if (this.tick % this.chronicleInterval === 0 || this.tick === this.ticks) this.recordChronicle();
  }

  /** Serialise the current state into a reporter-friendly result. */
  toResult(): RunResult {
    const living = this.individuals.filter((individual) => individual.alive);
    const species: SpeciesSummary[] = [...this.speciesById.entries()].map(([id, runtime]) => {
      const members = living.filter((individual) => individual.speciesId === id);
      const initial = this.initialPopulationBySpecies.get(id) ?? 0;
      return {
        id,
        name: runtime.resolved.name,
        color: runtime.resolved.color,
        description: runtime.resolved.description,
        initialPopulation: initial,
        finalPopulation: members.length,
        peakPopulation: runtime.peakPopulation,
        births: runtime.births,
        deaths: runtime.deaths,
        extinct: runtime.extinct,
        extinctionTick: runtime.extinctionTick,
        meanCognition: mean(members.map((individual) => cognitionScore(individual.brain))),
        meanGenome: meanGenome(members.map((individual) => individual.genome)),
        technologies: [...bioTechLabels(runtime.knowledgeMask)],
        brainSummary: runtime.resolved.brain.note ?? describeArchitecture(runtime.resolved.brain.regions),
        deathCauses: Object.fromEntries(
          [...(this.deathCausesBySpecies.get(id)?.entries() ?? [])].sort((a, b) => b[1] - a[1]),
        ),
        actions: Object.fromEntries(
          [...(this.actionCountsBySpecies.get(id)?.entries() ?? [])].sort((a, b) => b[1] - a[1]),
        ),
      };
    });

    const mapPopulation = new Array<number>(this.terrain.isOcean.length).fill(0);
    for (const individual of living) mapPopulation[individual.cell] += 1;

    const allGenomes = living.map((individual) => individual.genome);
    const deathCauseSummary = Object.fromEntries([...this.deathCauses.entries()].sort((a, b) => b[1] - a[1]));
    const summary = {
      initialPopulation: this.initialPopulationTotal,
      finalPopulation: living.length,
      peakPopulation: Math.max(...[...this.speciesById.values()].map((runtime) => runtime.peakPopulation), living.length),
      births: [...this.speciesById.values()].reduce((total, runtime) => total + runtime.births, 0),
      deaths: [...this.speciesById.values()].reduce((total, runtime) => total + runtime.deaths, 0),
      extinctions: species.filter((entry) => entry.extinct).map((entry) => entry.name),
      technologies: [...new Set(species.flatMap((entry) => entry.technologies))],
      meanCognition: mean(living.map((individual) => cognitionScore(individual.brain))),
      meanBrainMassKg: mean(allGenomes.map((genome) => genome.brainMassKg)),
      meanBodyMassKg: mean(allGenomes.map((genome) => genome.bodyMassKg)),
      meanLifespanYears: mean(allGenomes.map((genome) => genome.lifespanYears)),
      logEntries: this.events.length,
      deathCauses: deathCauseSummary,
      actions: Object.fromEntries([...this.actionCounts.entries()].sort((a, b) => b[1] - a[1])),
    };

    const planetDistance = this.focusBody.orbit.semiMajorAxisAu;
    const yearsTotal = this.tick * this.yearsPerTick;
    const deepTimeOptions: DeepTimeOptions = {
      luminositySolar: this.star.luminositySolar,
      massSolar: this.star.massSolar,
      lifetimeGyr: this.star.lifetimeGyr,
      baseTempC: this.climate.meanTempC,
      orbitAu: planetDistance,
      simulationEndYear: yearsTotal,
      targetYears: 10_000_000_000,
    };
    const deepTime = buildDeepTimeProjection(deepTimeOptions);
    const lastSnapshot = this.chronicleSnapshots[this.chronicleSnapshots.length - 1];
    const fallbackWidth = Math.min(11, this.terrain.width);
    const fallbackHeight = Math.min(9, this.terrain.height);
    const futureCenter = lastSnapshot?.centerCell ?? Math.floor((this.terrain.width * this.terrain.height) / 2);
    const future = buildFutureHistory({
      seed: this.seed,
      startYear: yearsTotal,
      initialPopulation: living.length,
      initialSettlements: lastSnapshot?.settlements ?? 0,
      initialTechnologies: summary.technologies,
      species: species
        .filter((entry) => entry.finalPopulation > 0)
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          color: entry.color,
          population: entry.finalPopulation,
          sapient: entry.meanGenome.brainMassKg / Math.max(1, entry.meanGenome.bodyMassKg) >= 0.012,
        })),
      region: lastSnapshot?.region ?? {
        width: fallbackWidth,
        height: fallbackHeight,
        originX: clamp((futureCenter % this.terrain.width) - Math.floor(fallbackWidth / 2), 0, this.terrain.width - fallbackWidth),
        originY: clamp(Math.floor(futureCenter / this.terrain.width) - Math.floor(fallbackHeight / 2), 0, this.terrain.height - fallbackHeight),
        centerX: futureCenter % this.terrain.width,
        centerY: Math.floor(futureCenter / this.terrain.width),
        biome: new Array<string>(fallbackWidth * fallbackHeight).fill('grassland') as BiomeId[],
        population: new Array<number>(fallbackWidth * fallbackHeight).fill(0),
      },
      mapWidth: this.terrain.width,
      centerCell: futureCenter,
      place: lastSnapshot?.place ?? settlementName(futureCenter, this.seed),
      deepTime: deepTimeOptions,
      deepTimeEvents: deepTime.events,
    });

    return {
      scenario: {
        name: this.scenario.name,
        description: this.scenario.description,
        seed: this.seed,
        ticks: this.tick,
        yearsPerTick: this.yearsPerTick,
        yearsTotal,
      },
      star: {
        name: this.star.name,
        spectralClass: this.star.spectralClass,
        massSolar: this.star.massSolar,
        luminositySolar: this.star.luminositySolar,
        surfaceTempK: this.star.surfaceTempK,
        lifetimeGyr: this.star.lifetimeGyr,
      },
      focusPlanet: {
        name: this.planet.name,
        kind: this.planet.kind,
        distanceAu: planetDistance,
        radiusKm: this.planet.radiusKm,
        massEarth: this.planet.massEarth,
        gravity: surfaceGravity(this.planet),
        yearDays: Math.sqrt(planetDistance ** 3 / this.star.massSolar) * 365.25,
        dayHours: this.planet.rotationHours,
        axialTiltDeg: this.planet.axialTiltDeg,
        oceanFraction: this.planet.oceanFraction,
        meanTempC: this.climate.meanTempC,
        gridWidth: this.terrain.width,
        gridHeight: this.terrain.height,
      },
      planets: this.system.bodies.map((body) => ({
        name: body.planet.name,
        kind: body.planet.kind,
        distanceAu: body.orbit.semiMajorAxisAu,
        meanTempC: surfaceTemperatureC(body.planet, this.star, body.orbit.semiMajorAxisAu),
        massEarth: body.planet.massEarth,
      })),
      summary,
      series: this.series,
      species,
      events: this.events,
      chronicle: {
        intervalTicks: this.chronicleInterval,
        snapshots: this.chronicleSnapshots,
        technologies: this.ledger(['technology'], true),
        theories: this.ledger(['theory'], true),
        wars: this.ledger(['war']),
        accidents: this.ledger(['plague', 'accident']),
        deepTime,
        future,
      },
      map: {
        width: this.terrain.width,
        height: this.terrain.height,
        biome: [...this.climate.biome],
        temperatureC: [...this.climate.temperatureC].map((value) => Math.round(value * 10) / 10),
        population: mapPopulation,
      },
      digest: this.computeDigest(),
    };
  }

  private computeDigest(): string {
    const finalState = this.individuals
      .filter((individual) => individual.alive)
      .map((individual) => ({
        id: individual.id,
        speciesId: individual.speciesId,
        knowledge: individual.knowledge,
        genome: roundedGenome(individual.genome),
      }))
      .sort((a, b) => a.id - b.id);
    return digest({
      ticks: this.tick,
      population: this.series.population,
      finalState,
      events: this.events.map((event) => `${event.tick}:${event.kind}`),
    });
  }
}

const EMPTY_OCCUPANTS: Individual[] = [];

const roundedGenome = (genome: Genome): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(genome)) result[key] = value.toFixed(6);
  return result;
};

const describeArchitecture = (regions: Record<string, { present?: boolean; scale?: number }> | undefined): string => {
  if (!regions) return 'Default vertebrate architecture.';
  const parts: string[] = [];
  for (const [id, config] of Object.entries(regions)) {
    parts.push(`${id}${config.present === false ? ' absent' : ` ×${config.scale ?? 1}`}`);
  }
  return parts.join(', ');
};

const bioTechLabels = (mask: number): string[] => knownTechnologies(mask).map((tech) => tech.name);
