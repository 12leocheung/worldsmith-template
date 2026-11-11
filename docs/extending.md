# Extending Worldsmith

The engine touches the layers through small interfaces, so most extensions do not
require engine edits. Keep the invariants at the end.

## Add a brain region

1. Define a `RegionDefinition` in `src/neuro/regions.ts`:

```ts
BRAIN_REGIONS.ensure('thalamus', {
  id: 'thalamus',
  name: 'Thalamus',
  description: 'Sensory relay and attention gating.',
  functions: ['memory', 'planning'],
  vital: false,
  defaultShare: 0.05,
  color: '#5b8def',
});
```

2. Decide whether it belongs to the default architecture. Regions not listed in
   `DEFAULT_REGION_IDS` are absent unless a scenario or species switches them on
   (`{ regions: { thalamus: { present: true } } }`).

Function tags already feed the utility model: any region tagged `planning` adds to
cognition and innovation; `vital` adds to autonomic tone; `threat`, `homeostasis`,
`memory`, `motor` and `social` have their own input and action weights in
`src/neuro/brain.ts`.

3. Add `FUNCTION_INPUTS` / `ACTION_WEIGHTS` entries if you introduce a new function tag.

## Add an action

1. Add the id to `ACTION_IDS` and `ACTIONS` in `src/neuro/actions.ts`.
2. Give it weights per region function in `ACTION_WEIGHTS` (`src/neuro/brain.ts`).
3. Add the gene-driven modifiers in `actionUtilities`, and a handler in
   `ACTION_HANDLERS` (`src/society/actions.ts`).

The handler receives `SimulationContext` and the individual, and returns a reward in
roughly −1..1 used for learning. Use `world.move`, `world.recordDeath`,
`world.recordAction`, `world.addOffspring` rather than mutating state directly.

## Add a technology

Append to `TECH_SEQUENCE` in `src/society/technology.ts`. Order determines the bit index,
so append rather than insert. `requires` is by id; effects are additive. Available
technologies are computed from the prerequisites automatically, and the discovery event
and report pick it up without further changes.

## Add a species

Add a `SpeciesSpec` to `SPECIES_PRESETS` or define one inside a scenario. A species is
a base genome (missing genes fall back to defaults), a founder spread, and a `BrainSpec`:

```ts
brain: {
  regions: {
    medulla: { present: false },
    ganglion: { present: true, scale: 1 },
    cortex: { scale: 1.45, efficiency: 1.2 },
  },
  efficiency: 1.2,
  plasticity: 1.4,
  exploration: 0.3,
  note: 'Distributed autonomic control, enlarged cortex.',
}
```

Genes are in `src/bio/genome.ts`; add a gene there (with bounds, default and mutation
size) and it is automatically inherited, mutated, sampled and reported.

## Add or replace a physical layer

`cosmos`, `geo` and `bio` are independent modules. If you replace climate, keep the
`Climate` shape (temperature, precipitation, biome, NPP, cell areas, aggregates) so the
society layer keeps working. If you replace terrain, keep `Terrain` (elevation, ocean
mask, ruggedness, cell areas). If you replace the brain, keep the perception → utilities
→ action API.

## Add reporting

- Metrics: collect in `World.recordMetrics` and add to `Series` in
  `src/engine/report.ts`.
- Final result: extend `RunResult` and fill it in `World.toResult`.
- Text/visual: render in `renderMarkdown` / `renderHtmlReport`.

Reports must remain deterministic; do not sample randomness in them.

## Invariants

1. **Determinism** — never use `Math.random`. Derive a stream with `rng.fork(label)`;
   do not share a stream across systems that should vary independently.
2. **Units** — physical quantities stay in their real units; use `core/units.ts` rather
   than magic constants.
3. **Phase order** — do not run behaviour outside the behaviour phase or metabolism
   outside its phase. Interventions happen at the start of a tick.
4. **Tick scaling** — anything per-year must be scaled by `yearsPerTick`; anything that
   is a stock must be scaled consistently. Use `tickEnergyDemandKcal` and
   `energyCapacityKcal` as examples.
5. **One source of truth** — species architecture comes from the species spec;
   individuals may deviate through lesions or genome changes, never by editing presets.
6. **Validation** — new scenario fields or ids must be checked in
   `validateScenario` with an actionable message.
7. **Checks** — after a change run `npm run typecheck` and `npm test`; for ecology
   changes also run a scenario and inspect death causes and behaviour mix.

## A worked experiment

Testing "what if this race had no cerebellum?":

```ts
species: [{ ...SPECIES_PRESETS.human, id: 'ataxic', name: 'Ataxic hominin',
           brain: { regions: { cerebellum: { present: false } } } }],
founders: [{ speciesId: 'ataxic', count: 90 }],
```

The cerebellum contributes `motor` capacity, which feeds cognition and action execution
but is not vital, so the lineage survives with lower cognition and no autonomic penalty.
Compare against `earthlike.ts`: the difference isolates the module's contribution.
