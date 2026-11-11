import { clamp } from '../core/math.ts';
import { KCAL_PER_KG_MEAT, KCAL_PER_KG_PLANT } from '../core/units.ts';
import type { Genome } from './genome.ts';

/**
 * Metabolic scaling and energy accounting.
 *
 * Basal metabolism follows Kleiber's law: BMR [kcal/day] = 70 * mass[kg]^0.75 for
 * mammals. Everything else (food requirement, offspring cost, starvation) derives
 * from that single allometric anchor, so megafauna and small animals behave plausibly
 * without per-species tuning.
 */

export const KLEIBER_COEFFICIENT = 70;
export const KLEIBER_EXPONENT = 0.75;

/** kcal per day at rest; efficiency reduces the cost of maintenance. */
export const basalMetabolicKcalPerDay = (genome: Pick<Genome, 'bodyMassKg' | 'metabolicEfficiency'>): number => {
  const efficiencyMultiplier = 1.25 - 0.5 * clamp(genome.metabolicEfficiency, 0, 1);
  return KLEIBER_COEFFICIENT * genome.bodyMassKg ** KLEIBER_EXPONENT * efficiencyMultiplier;
};

/** Annual energy requirement at rest, kcal. */
export const annualEnergyNeedKcal = (genome: Genome): number => basalMetabolicKcalPerDay(genome) * 365;

/** Energy required to raise one offspring to independence as a fraction of annual need. */
export const offspringEnergyCostKcal = (genome: Genome): number =>
  annualEnergyNeedKcal(genome) * (0.18 + 0.06 * genome.fertility);

/** Brain tissue is metabolically expensive: roughly 20x body tissue per kg. */
export const brainMetabolicCostKcalPerDay = (genome: Pick<Genome, 'brainMassKg'>): number =>
  genome.brainMassKg * 240;

/** Total daily energy demand including brain overhead. */
export const dailyEnergyDemandKcal = (genome: Genome): number =>
  basalMetabolicKcalPerDay(genome) + brainMetabolicCostKcalPerDay(genome);

/** Digestive efficiency for plant vs animal matter, given diet and metabolic efficiency. */
export const digestionEfficiency = (genome: Pick<Genome, 'diet' | 'metabolicEfficiency'>, fromMeat: boolean): number => {
  const base = fromMeat ? 0.92 : 0.45;
  const adaptation = fromMeat ? 0.2 * genome.diet : 0.2 * (1 - genome.diet);
  return clamp(base + adaptation + 0.15 * (genome.metabolicEfficiency - 0.5), 0.15, 0.98);
};

/** kcal obtainable per kg of prey wet mass for this animal. */
export const meatKcalPerKg = (genome: Pick<Genome, 'diet' | 'metabolicEfficiency'>): number =>
  KCAL_PER_KG_MEAT * digestionEfficiency(genome, true);

/** kcal obtainable per kg of plant wet mass. */
export const plantKcalPerKg = (genome: Pick<Genome, 'diet' | 'metabolicEfficiency'>): number =>
  KCAL_PER_KG_PLANT * digestionEfficiency(genome, false);

/**
 * Thermal stress in °C beyond the animal's comfortable band. Zero means no stress.
 * Cold tolerance shifts comfort down, heat tolerance shifts it up.
 */
export const thermalStressC = (genome: Genome, temperatureC: number): number => {
  const comfortLow = 3 - genome.coldToleranceC;
  const comfortHigh = 30 + genome.heatToleranceC;
  if (temperatureC < comfortLow) return comfortLow - temperatureC;
  if (temperatureC > comfortHigh) return temperatureC - comfortHigh;
  return 0;
};

/** Extra resting energy required by thermal stress (fraction of BMR). */
export const thermoregulationCostFraction = (genome: Genome, temperatureC: number): number =>
  clamp(thermalStressC(genome, temperatureC) * 0.02, 0, 0.9);

/** Age-dependent mortality hazard per year (Gompertz-Makeham). */
export const ageMortalityHazard = (genome: Genome, ageYears: number): number => {
  const lifespan = Math.max(1, genome.lifespanYears);
  const senescence = 0.00035 * Math.exp((6.2 * ageYears) / lifespan);
  const infant = ageYears < 1 ? 0.08 : 0;
  const baseline = 0.0006;
  return baseline + senescence + infant;
};

/** Fraction of lifespan during which reproduction is possible. */
export const fertileWindow = (genome: Genome): { start: number; end: number } => ({
  start: 0.14 * genome.lifespanYears,
  end: 0.68 * genome.lifespanYears,
});

export const isFertileAge = (genome: Genome, ageYears: number): boolean => {
  const window = fertileWindow(genome);
  return ageYears >= window.start && ageYears <= window.end;
};

/**
 * Energy required for one tick. Ticks may span years, in which case this is the
 * organism's whole energy budget for the step rather than a daily ration.
 */
export const tickEnergyDemandKcal = (genome: Genome, yearsPerTick: number): number =>
  dailyEnergyDemandKcal(genome) * 365 * yearsPerTick;

/**
 * Energy store, in kcal. Three ticks' worth of demand: enough to survive a couple of
 * failed foraging attempts, not enough to coast indefinitely.
 */
export const energyCapacityKcal = (genome: Genome, yearsPerTick = 1): number =>
  tickEnergyDemandKcal(genome, Math.max(0.05, yearsPerTick)) * 3;
