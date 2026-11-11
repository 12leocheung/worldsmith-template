import { SPECIES_PRESETS } from '../src/bio/species.ts';
import type { Scenario } from '../src/engine/scenario.ts';
import { earthLikeWorld, foundersWith } from './shared.ts';

/**
 * What if a lineage had no medulla but did have a functional replacement?
 *
 * The ganglion-race species has distributed ganglia providing autonomic tone. The
 * physics and ecosystem are the baseline's, so any difference is attributable to the
 * substituted architecture.
 */
const scenario: Scenario = {
  name: 'Ganglion race',
  description:
    'Humans whose medulla is replaced by distributed ganglia. Same world and ecosystem as the baseline; only the autonomic architecture differs.',
  seed: 42,
  world: earthLikeWorld,
  species: [SPECIES_PRESETS['ganglion-race'], SPECIES_PRESETS.grazer, SPECIES_PRESETS.predator],
  founders: foundersWith('ganglion-race'),
  run: { ticks: 600, yearsPerTick: 1, maxPopulation: 2000 },
};

export default scenario;
