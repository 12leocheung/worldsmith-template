import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.ts';
import {
  GENE_KEYS,
  GENE_SPECS,
  defaultGenome,
  genomeDistance,
  mutateGenome,
  recombineGenomes,
  sampleGenome,
} from '../src/bio/genome.ts';
import {
  ageMortalityHazard,
  basalMetabolicKcalPerDay,
  dailyEnergyDemandKcal,
  isFertileAge,
  thermalStressC,
} from '../src/bio/metabolism.ts';
import { createBrain, cognitionScore, configureRegion, vitalTone, actionUtilities, EMPTY_PERCEPTION } from '../src/neuro/brain.ts';
import { resolveSpecies, SPECIES_PRESETS } from '../src/bio/species.ts';

test('mutated genomes remain inside every gene range', () => {
  const rng = new Rng('mutation');
  let genome = defaultGenome();
  for (let generation = 0; generation < 40; generation++) {
    genome = mutateGenome(genome, rng, { scale: 1.5 });
    for (const key of GENE_KEYS) {
      const spec = GENE_SPECS[key];
      assert.ok(genome[key] >= spec.min && genome[key] <= spec.max, `${key} out of range: ${genome[key]}`);
    }
  }
});

test('mutation actually changes the genome over time', () => {
  const rng = new Rng(4);
  const base = defaultGenome();
  const mutated = mutateGenome(base, rng);
  assert.ok(genomeDistance(base, mutated) > 0);
});

test('offspring inherit near the parental mean', () => {
  const rng = new Rng(77);
  const mother = defaultGenome({ bodyMassKg: 60, brainMassKg: 1.3 });
  const father = defaultGenome({ bodyMassKg: 70, brainMassKg: 1.4 });
  const child = recombineGenomes(mother, father, rng);
  assert.ok(Math.abs(child.bodyMassKg - 65) < 8, `child mass ${child.bodyMassKg}`);
  assert.ok(Math.abs(child.brainMassKg - 1.35) < 0.15);
});

test('founder sampling varies but stays plausible', () => {
  const rng = new Rng('founders');
  const base = defaultGenome({ bodyMassKg: 62 });
  const masses = Array.from({ length: 100 }, () => sampleGenome(base, 0.04, rng).bodyMassKg);
  assert.ok(Math.min(...masses) < 58);
  assert.ok(Math.max(...masses) > 66);
});

test('Kleiber scaling gives large animals a lower mass-specific metabolism', () => {
  const mouse = defaultGenome({ bodyMassKg: 0.02, brainMassKg: 0.0004 });
  const elephant = defaultGenome({ bodyMassKg: 4000, brainMassKg: 4.5 });
  const mouseBmr = basalMetabolicKcalPerDay(mouse);
  const elephantBmr = basalMetabolicKcalPerDay(elephant);
  assert.ok(elephantBmr > mouseBmr * 1000);
  assert.ok(elephantBmr / 4000 < mouseBmr / 0.02);
  assert.ok(dailyEnergyDemandKcal(elephant) > elephantBmr);
});

test('thermal stress and mortality respond to genes and age', () => {
  const human = defaultGenome();
  assert.equal(thermalStressC(human, 20), 0);
  assert.ok(thermalStressC(human, 40) > 5);
  assert.ok(thermalStressC(defaultGenome({ heatToleranceC: 15 }), 40) < thermalStressC(human, 40));
  assert.ok(ageMortalityHazard(human, 70) > ageMortalityHazard(human, 30) * 5);
  assert.ok(isFertileAge(human, 25));
  assert.ok(!isFertileAge(human, 5));
});

test('the medulla is required for vital tone; ganglia can substitute', () => {
  const genome = defaultGenome();
  const normal = createBrain(undefined, genome, new Rng(1));
  assert.ok(vitalTone(normal) > 0.9);

  const lesioned = createBrain(undefined, genome, new Rng(1));
  configureRegion(lesioned, 'medulla', { present: false });
  assert.equal(vitalTone(lesioned), 0);

  const substituted = createBrain(
    { regions: { medulla: { present: false }, ganglion: { present: true, scale: 1 } } },
    genome,
    new Rng(1),
  );
  assert.ok(vitalTone(substituted) > 0.9);
  assert.equal(substituted.regions.medulla?.present, false);
});

test('a larger cortex raises cognition and the brain scales with brain mass', () => {
  const base = createBrain(undefined, defaultGenome(), new Rng(2));
  const bigger = createBrain(
    { regions: { cortex: { scale: 1.6 } }, efficiency: 1.2 },
    defaultGenome({ brainMassKg: 2.4 }),
    new Rng(2),
  );
  assert.ok(cognitionScore(bigger) > cognitionScore(base) * 1.3, `${cognitionScore(base)} vs ${cognitionScore(bigger)}`);

  const smallBrain = createBrain(undefined, defaultGenome({ brainMassKg: 0.5 }), new Rng(2));
  assert.ok(cognitionScore(smallBrain) < cognitionScore(base));
});

test('a starving individual prefers foraging over socialising', () => {
  const brain = createBrain(undefined, defaultGenome(), new Rng(3));
  const utilities = actionUtilities(
    brain,
    {
      ...EMPTY_PERCEPTION,
      hunger: 1,
      energyFraction: 0,
      foodAvailability: 0,
      socialDensity: 0,
      mateAvailability: 0,
      threat: 0,
    },
    defaultGenome(),
  );
  assert.ok(utilities.forage > utilities.socialize);
  assert.ok(utilities.forage > utilities.explore);
});

test('species presets resolve consistently', () => {
  const human = resolveSpecies(SPECIES_PRESETS.human!);
  assert.equal(human.role, 'omnivore');
  assert.ok(human.genome.brainMassKg > 1);
  const predator = resolveSpecies(SPECIES_PRESETS.predator!);
  assert.equal(predator.role, 'carnivore');
  const ganglion = resolveSpecies(SPECIES_PRESETS['ganglion-race']!);
  assert.equal(ganglion.brain.regions?.ganglion?.present, true);
});
