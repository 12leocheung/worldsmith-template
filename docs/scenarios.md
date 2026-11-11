# Scenario reference

A scenario is a default-exported `Scenario` object in `scenarios/*.ts`. It is loaded by
the CLI with a dynamic import, so Node's type stripping runs it directly. Validation
runs before the world is built and reports every problem at once.

## Shape

```ts
interface Scenario {
  name: string;
  description: string;
  seed?: number;                 // default 20260101; CLI --seed overrides
  world: WorldSpec;
  species: SpeciesSpec[];
  founders?: FoundingSpec[];     // default: each species at defaultCount
  run: { ticks: number; yearsPerTick: number; maxPopulation?: number };
  interventions?: Intervention[];
}
```

### WorldSpec

| Field | Meaning |
| --- | --- |
| `system` | Explicit star + planets, or `{ generate: { planetCount } }` for a plausible random system |
| `focusPlanet` | Planet id/name to simulate the surface of; defaults to the first ocean/super-Earth |
| `grid` | Surface grid; default 64×32, max 512×256 |
| `oceanFraction` | Override the focus planet's water coverage |
| `continentScale`, `roughness` | Terrain shape and mountain intensity |
| `harvestedAreaFraction` | Fraction of each cell actually exploited; default 0.001. Raise it for a richer world, lower it for a harsher one |

Planets may specify `targetMeanTempC`, in which case the greenhouse parameter is solved
from the equilibrium temperature instead of guessed.

### FoundingSpec

```ts
{
  speciesId: string;
  count?: number;
  preferBiomes?: BiomeId[];      // e.g. ['savanna', 'grassland']
  minTempC?: number; maxTempC?: number;
  startingTech?: string[];       // technologies known at founding
}
```

Founders are placed in weighted settlements (habitability, thermal comfort, low
ruggedness). Carnivores are preferentially founded in cells that already contain prey,
because a predator guild that starts where there is nothing to eat simply starves.

### Interventions

All have `atTick` (multiply by `yearsPerTick` mentally if you think in years).

| Kind | Fields | Effect |
| --- | --- | --- |
| `ablateRegion` | `regionId`, `speciesId?`, `fraction?` | Removes a brain region from living individuals. Not heritable; offspring use the species architecture |
| `boostRegion` | `regionId`, `scale`, `speciesId?`, `fraction?` | Enlarges a region on living individuals |
| `plague` | `mortality`, `speciesId?` | Per-individual death chance reduced by disease resistance |
| `teach` | `technology`, `speciesId?`, `fraction?` | Grants a technology |
| `climateShock` | `deltaC`, `durationTicks` | Global mean-temperature offset for a period |
| `introduceSpecies` | `speciesId`, `count` | Seeds new individuals mid-run |

For a heritable change (a different lineage), define a species with a modified genome or
brain architecture instead of using an intervention. This distinction matters: lesions
are acquired, architectures are inherited.

## Included experiments

| File | Question |
| --- | --- |
| `earthlike.ts` | Baseline: humans, grazers, predators on a 14 °C ocean world at 1 AU |
| `medulla-less.ts` | A heritable lineage with no autonomic region at all |
| `ganglion-race.ts` | A medulla replaced by distributed ganglia |
| `hypercognitive.ts` | A 2.4 kg brain with a denser, larger cortex and faster learning |
| `climate-shock.ts` | An ice-age cooling intervention mid-run |
| `close-orbiting-world.ts` | Heat-adapted life on a tidally locked M-dwarf ocean world |

## CLI

```bash
npm run sim -- list
npm run sim -- inspect scenarios/close-orbiting-world.ts
npm run sim -- validate
npm run sim -- run scenarios/hypercognitive.ts --ticks 300 --seed 7
npm run sim -- compare scenarios/earthlike.ts scenarios/ganglion-race.ts --ticks 300
```

`--ticks` and `--seed` override the scenario without editing it, which is useful for
sensitivity analysis. `--out` changes the output directory. `--html false` skips the HTML
report, `--quiet` prints only paths.

## Reading a result

`summary` aggregates the living population; `species` is per lineage and includes mean
genome, technologies, cognition, deaths by cause and behaviour mix; `series` is the time
series; `map` is the final biome/population grid; `digest` identifies the exact state.

Per-species population ceilings are performance guards. They are not carrying capacity;
food, disease and predation do that job. If two species are near their ceilings, the
ecology is not what is limiting them.

## Choosing a timestep

- `yearsPerTick: 1` — the default; good for human-scale history and animal demography.
- `< 0.25` — seasons become visible in temperature, food and behaviour; good for
  ecological detail but short spans.
- `> 1` — only for coarse questions. The engine scales energy and reproduction, but
  individuals get one decision per multi-year step, so behaviour is less responsive.

## Reproducibility

Keep the scenario, seed, tick count and code fixed to reproduce a digest. If you change
an RNG stream's consumption inside a system, unrelated streams stay stable thanks to
forked streams — but changes in the same stream do change results, as they should.
