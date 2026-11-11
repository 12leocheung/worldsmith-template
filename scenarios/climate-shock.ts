import { SPECIES_PRESETS } from '../src/bio/species.ts';
import type { Scenario } from '../src/engine/scenario.ts';
import { earthFounders, earthLikeWorld } from './shared.ts';

/**
 * Intervention example: an abrupt cooling episode.
 *
 * At year 250 the mean surface temperature falls by 10 °C for 120 years, then
 * recovers. Compare with the baseline to see whether cultural buffering (clothing,
 * fire, agriculture) is enough to carry the population through.
 */
const scenario: Scenario = {
  name: 'Ice-age shock',
  description:
    'Baseline world hit by a −10 °C climate shock at year 250, lasting 120 years. Demonstrates interventions and the interaction between thermal tolerance, technology and food supply.',
  seed: 42,
  world: earthLikeWorld,
  species: [SPECIES_PRESETS.human, SPECIES_PRESETS.grazer, SPECIES_PRESETS.predator],
  founders: earthFounders,
  run: { ticks: 500, yearsPerTick: 1, maxPopulation: 1400 },
  interventions: [{ atTick: 250, kind: 'climateShock', deltaC: -10, durationTicks: 120 }],
};

export default scenario;
