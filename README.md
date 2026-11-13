# Worldsmith

A modular, deterministic **world-simulation template** for experiments that span scales:
stars and planetary systems, planetary surfaces and climate, genetics and metabolism,
brains and behaviour, populations and culture. It is a starting point, not a finished
model of reality: every layer is explicit, inspectable and replaceable.

The design goal is that an experiment can be *any* question — "what if this lineage had
no medulla?", "what if the cortex were twice as large?", "what if an ice age arrived
early?", "what lives on a tidally locked world around an M dwarf?" — and you express it
as a declarative scenario instead of rewriting a simulator.

```
cosmos  →  geo  →  bio  →  neuro  →  society  →  experiment harness
stars      terrain  genomes   brain     actions      scenarios
orbits     climate  metabolism regions  knowledge    compare/report
planets    biomes   species    learning demography   determinism digest
```

## Quick start

Requires Node.js ≥ 22.18 (the project runs TypeScript directly through Node's type
stripping; there is no build step and no runtime dependency).

```bash
npm install                 # dev dependencies only: typescript, @types/node
npm run sim -- list         # list the experiment scenarios
npm run sim -- inspect scenarios/earthlike.ts
npm run sim -- run scenarios/earthlike.ts
npm run sim -- compare scenarios/earthlike.ts scenarios/hypercognitive.ts --ticks 200
npm test                    # 51 tests
npm run typecheck
```

A run writes four artefacts to `runs/<scenario>-s<seed>/`:

| File | Contents |
| --- | --- |
| `run.json` | Complete result: configuration, planetary setting, time series, species summaries, events, chronicle snapshots, surface map, state digest |
| `report.md` | Human-readable report with physical setting, outcome, species, time series, death causes, behaviour mix |
| `report.html` | Self-contained visual report: population chart, culture/cognition chart, biome map with settlements, species table |
| `chronicle.html` | Pixel-isometric chronicle: scrubbable timeline, clickable residents and their actions, ledgers of technologies, theories, wars and disease/accident outbreaks, and a simulated future history to 10 billion years |

All three HTML/JSON artefacts open directly in a browser; the HTML files have no external dependencies. The chronicle samples up to 51 frames and 36 residents per frame from the underlying individual simulation, so the page stays small while every sprite is a real simulated person or animal. After the simulated centuries it continues with a seeded future-history model: population, settlements and technology are integrated with logistic growth, carrying capacity and stochastic plagues, wars, golden ages and climate shocks. Each world carries its known technologies forward and accumulates research from its living population; technologies such as steam power, cars, computers, the internet and AI are discovered at their own dates when their prerequisites are met, not assigned to 2026. Near-future frames include 2026, so the page shows whatever that particular world has actually learned by then. Later frames are log-spaced out to 10,000,000,000 years. The future is coarse (one step per frame, not one tick per person), deterministic for a given seed, and visibly different across seeds. People remain until the surface becomes genuinely uninhabitable.

## Repository map

```
src/
  core/       seeded RNG with independent streams, math, units, registry, digest
  cosmos/     stars, Keplerian orbits, planets, atmospheres, system assembly
  geo/        spherical heightmaps, climate fields, biome classification
  bio/        quantitative genomes, metabolic scaling, species presets
  neuro/      modular brain regions, perception, action utilities, learning
  society/    individuals, actions, technology tree, species runtimes
  engine/     scenario contract, tick loop, results, Markdown/HTML reports, chronicle
  cli.ts      list / run / compare / inspect / validate
scenarios/    declarative experiments
tests/        node:test suites for every layer
docs/         architecture, scenario reference, extension guide
```

## What is actually simulated

| Layer | Model | Anchors |
| --- | --- | --- |
| Stars | Main-sequence mass/luminosity/temperature, spectral class, lifetime | Solar units; t ∝ M/L |
| Orbits | Kepler's equation solved by Newton iteration; full 3D elements; vis-viva speed | AU, years, solar masses |
| Planets | Mass, radius, albedo, greenhouse, rotation, tilt, moons, atmosphere | Earth = 1 M⊕, 6371 km, 255 K equilibrium |
| Climate | Zonal temperature + elevation lapse + seasonal migration, zonal precipitation bands, Whittaker biomes | 6.5 °C/km lapse, 255 K blackbody, Earth-like bands |
| Terrain | 3D value-noise continents on the sphere + ridged mountains; sea level set by quantile | Cell areas computed per latitude band |
| Energy | Kleiber BMR 70·m^0.75 kcal/day plus brain cost; digestion efficiency by diet; thermal stress | Real kcal, kg, °C |
| Genetics | 13 quantitative genes; recombination + mutation; founder variation | Mendelian abstraction |
| Brains | Six default regions (medulla, hypothalamus, amygdala, hippocampus, cortex, cerebellum) plus optional ganglia/pallium; region activity → action utilities → softmax choice → reward learning | Vital tone, cognition, teaching fidelity |
| Culture | 20 technologies as a bitmask, prerequisites, species-level union, teaching and diffusion | Knowledge dies with its last holder |
| Demography | Ageing (Gompertz), starvation, disease density, thermal exposure, predation, reproduction with birth spacing and clutch scaling | Per-species population ceiling |
| Conflict | Dense neighbouring settlements of an encephalised, aggressive lineage may raid each other; deaths are recorded as `war` | Bounded territorial raids, not a strategic war model |

Everything is in physical units so parameters can be checked against the real world
rather than tuned into a corner.

## Determinism and experiments

One seed reproduces the exact final state, and the result carries a digest so two runs
can be compared mechanically. Randomness is split into named streams (`terrain`,
`system`, `tick:N`, …) so adding a subsystem does not perturb unrelated layers.

Comparisons run a baseline and variants with the same seed, world and founder
population:

```bash
npm run sim -- compare scenarios/earthlike.ts scenarios/hypercognitive.ts scenarios/ganglion-race.ts --ticks 300
```

The comparison table reports absolute values for the baseline and deltas for each
variant. Because physics and ecology are identical across those files, differences are
attributable to the species or intervention, not environmental luck.

## Writing a scenario

A scenario is a default-exported TypeScript object, so the compiler checks it:

```ts
import { SPECIES_PRESETS } from '../src/bio/species.ts';
import type { Scenario } from '../src/engine/scenario.ts';

const scenario: Scenario = {
  name: 'What if the cortex doubled?',
  description: 'Same world, same founders, a larger and denser cortex.',
  seed: 42,
  world: {
    name: 'Terrarium',
    system: { star: { spectralClass: 'G' }, planets: [
      { id: 'earth', name: 'Terrarium', kind: 'ocean', orbit: { semiMajorAxisAu: 1 }, targetMeanTempC: 14 },
    ] },
    focusPlanet: 'earth',
    grid: { width: 64, height: 32 },
    harvestedAreaFraction: 0.0015,
  },
  species: [{ ...SPECIES_PRESETS.human, id: 'big-cortex', name: 'Big-cortex hominin', brain: { regions: { cortex: { scale: 2 } }, efficiency: 1.2 } }],
  founders: [{ speciesId: 'big-cortex', count: 90, preferBiomes: ['savanna', 'grassland'] }],
  run: { ticks: 400, yearsPerTick: 1, maxPopulation: 2000 },
};

export default scenario;
```

Interventions can change a run partway through: `ablateRegion`, `boostRegion`, `plague`,
`teach`, `climateShock`, `introduceSpecies`. See [docs/scenarios.md](docs/scenarios.md)
for the full reference.

## Extending the template

The layers are designed for extension without engine edits:

- **New brain region** — register it in `society`-independent `neuro/regions.ts` with
  function tags; scenarios can then ablate or enlarge it by id.
- **New action** — add it to `neuro/actions.ts`, give it region weights in
  `neuro/brain.ts`, implement it in `society/actions.ts`.
- **New technology** — append to the ordered list in `society/technology.ts`.
- **New species** — a genome partial plus a brain architecture; presets live in
  `bio/species.ts`.
- **New metric/report field** — compute in `World.recordMetrics` / `toResult`, render in
  `engine/report.ts`.

[docs/extending.md](docs/extending.md) walks through each with the invariants to keep.
[AGENTS.md](AGENTS.md) contains the same guidance for an AI coding agent working in
this repository.

## Honest limits

This is a template for *reasoning with simulations*, not a validated replica of Earth:

- Climate is zonal, not a general circulation model: latitude, elevation, season and
  greenhouse strength are represented; weather, ocean currents and clouds are not.
- Grid cells are continental in size, so local ecology is aggregated and carrying
  capacity needs the `harvestedAreaFraction` correction.
- One action per tick means the tick length matters. Annual ticks are the default;
  multi-year ticks require the energy and reproduction scaling the engine already
  applies, but reduce temporal resolution.
- Genetics is quantitative, not nucleotide-level. Brains are rate-coded modules, not
  spiking networks. Neither is intended to reproduce wet-lab detail.
- Small closed ecosystems can lose their predator guild through overshoot; that is a
  real dynamic, not a guarantee of stability. Enlarge the habitat, seed more founders,
  or add interventions to study recovery.
- Population ceilings are **per species**; the ceiling is a performance guard, not an
  ecological law.

These are documented so results are interpreted at the right resolution. The point is
to make assumptions explicit and experiments reproducible, then replace the layer that
matters for your question.

## Checks

`npm test` covers RNG stream independence, Kepler solutions, planetary temperatures and
gravity, terrain determinism and area accounting, biome classification, genetic bounds,
metabolic scaling, brain ablation, technology prerequisites, scenario validation, run
determinism, chronicle sampling and report rendering. `npm run typecheck` type-checks
source, scenarios and tests.
