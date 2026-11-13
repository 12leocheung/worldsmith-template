# Agent guide

This repository is a **template**. Optimise for clarity, extensibility and reproducible
experiments, not for a single impressive output. Read `README.md` and
`docs/architecture.md` before changing model behaviour.

## Commands

```bash
npm install
npm run typecheck                 # tsc --noEmit over src, scenarios, tests
npm test                          # node:test, 51 tests
npm run sim -- run scenarios/earthlike.ts
npm run sim -- compare scenarios/earthlike.ts scenarios/hypercognitive.ts --ticks 200
npm run sim -- validate
```

Node ≥ 22.18 runs `.ts` directly via type stripping. Imports must use explicit `.ts`
extensions. Avoid `enum`, `namespace` and parameter properties (not supported by
stripping).

## Where things live

| Concern | File |
| --- | --- |
| Seed streams | `src/core/rng.ts` |
| Tick loop, phases, founding, interventions, results | `src/engine/world.ts` |
| Scenario contract and validation | `src/engine/scenario.ts` |
| Markdown/HTML report | `src/engine/report.ts` |
| Behaviour, feeding, hunting, reproduction, teaching | `src/society/actions.ts` |
| Action set | `src/neuro/actions.ts` |
| Brain regions | `src/neuro/regions.ts` |
| Perception, utilities, learning | `src/neuro/brain.ts` |
| Genes | `src/bio/genome.ts` |
| Metabolism, thermal, mortality | `src/bio/metabolism.ts` |
| Species presets | `src/bio/species.ts` |
| Technology tree | `src/society/technology.ts` |
| Terrain / climate / biomes | `src/geo/*` |
| Stars, orbits, planets, systems | `src/cosmos/*` |

## Hard invariants

- **Determinism.** No `Math.random`. Use `world.rng` (the tick stream) or
  `rng.fork(label)` for independent streams. Same seed, scenario and code must produce
  the same digest; `tests/engine.test.ts` enforces this.
- **Tick scaling.** Anything expressed per year is multiplied by `yearsPerTick` when
  applied. Energy uses `tickEnergyDemandKcal` / `energyCapacityKcal`; do not reintroduce
  a fixed 60-day energy cap.
- **Units.** kg, km, AU, K/°C, kcal, years. Constants in `src/core/units.ts`.
- **Phase order.** Interventions → environment → behaviour → metabolism/mortality →
  diffusion → compaction → metrics. Do not move work across phases silently.
- **Species architecture vs. lesions.** A heritable brain difference belongs in the
  species `BrainSpec`; an experiment on living individuals uses an intervention. Offspring
  inherit the species architecture.
- **Per-species population ceiling.** `maxPopulation` applies per species. Do not revert
  this to a global cap: fast breeders would exclude everyone else.

## Extending

Follow `docs/extending.md`. Checklist for a new action: `ACTION_IDS`, `ACTIONS`,
`ACTION_WEIGHTS`, gene modifiers in `actionUtilities`, handler in `society/actions.ts`,
reward for learning. Checklist for a new region: `BRAIN_REGIONS.ensure`, default
membership, optional new function tag weights. For a technology: append (never insert)
to `TECH_SEQUENCE`.

After a model change, run a scenario and inspect:

- `summary.deathCauses` — is anything pathological (e.g. autonomic failure at scale)?
- `species[].actions` — is one action monopolising behaviour?
- population trajectories — do they crash or sit exactly at the ceiling?

Then run `npm run typecheck` and `npm test`. Report checks that could not run rather
than claiming them.

## Style

- Match the existing file structure and naming; keep modules free of cross-layer
  concepts.
- Document the physical meaning of constants and why a coefficient was chosen.
- Keep scenario files self-explanatory; they are the primary user interface.
- Do not add dependencies for what Node's standard library provides (assertions, test
  runner, argument parsing, crypto).
