import { SPECIES_PRESETS } from '../src/bio/species.ts';
import type { Scenario } from '../src/engine/scenario.ts';
import { earthLikeWorld, foundersWith } from './shared.ts';

/**
 * What if the lineage simply never had a medulla?
 *
 * Unlike an acquired lesion, this is heritable: every individual, including every
 * newborn, lacks autonomic control circuitry. The medulla-less preset has no
 * substituting region, so vital tone is zero and death follows within a year or two.
 * The rest of the ecosystem is the baseline's.
 */
const scenario: Scenario = {
  name: 'Medulla-less lineage',
  description:
    'A hominin lineage with no medulla and no replacement. Vital tone is zero from birth, so autonomic failure removes the lineage while the ecosystem continues.',
  seed: 42,
  world: earthLikeWorld,
  species: [SPECIES_PRESETS['medulla-less'], SPECIES_PRESETS.grazer, SPECIES_PRESETS.predator],
  founders: foundersWith('medulla-less'),
  run: { ticks: 60, yearsPerTick: 1, maxPopulation: 2000 },
};

export default scenario;
