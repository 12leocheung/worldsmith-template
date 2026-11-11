import { SPECIES_PRESETS } from '../src/bio/species.ts';
import type { Scenario } from '../src/engine/scenario.ts';
import { earthFounders, earthLikeWorld } from './shared.ts';

/**
 * Reference run: humans and a two-level animal food chain on an Earth-like world.
 * Use this as the baseline for comparisons.
 */
const scenario: Scenario = {
  name: 'Earth-like baseline',
  description:
    'Humans, grazers and predators on a 14 °C ocean world at 1 AU. Six centuries of cultural accumulation with no interventions: the baseline for brain and species experiments.',
  seed: 42,
  world: earthLikeWorld,
  species: [SPECIES_PRESETS.human, SPECIES_PRESETS.grazer, SPECIES_PRESETS.predator],
  founders: earthFounders,
  run: { ticks: 600, yearsPerTick: 1, maxPopulation: 2000 },
};

export default scenario;
