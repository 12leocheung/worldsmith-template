import { SPECIES_PRESETS } from '../src/bio/species.ts';
import type { Scenario } from '../src/engine/scenario.ts';
import { earthLikeWorld, foundersWith } from './shared.ts';

/**
 * A race smarter than humans: enlarged, denser cortex, faster plasticity and a longer
 * life. The experiment asks a physical question rather than granting a bonus: bigger
 * brains cost energy, and cultural accumulation depends on both innovation and
 * transmission. Compare technology count and population trajectory with the baseline.
 */
const scenario: Scenario = {
  name: 'Hypercognitive hominin',
  description:
    'A hominin lineage with a 2.4 kg brain, 1.45× cortex and faster learning, on the baseline world. Tests whether raw cognition accelerates culture when brains also cost more to run.',
  seed: 42,
  world: earthLikeWorld,
  species: [SPECIES_PRESETS['hyper-human'], SPECIES_PRESETS.grazer, SPECIES_PRESETS.predator],
  founders: foundersWith('hyper-human'),
  run: { ticks: 600, yearsPerTick: 1, maxPopulation: 2000 },
};

export default scenario;
