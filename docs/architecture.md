# Architecture

## Layering

Dependencies point in one direction:

```
core ──► cosmos ──► geo ──► bio ──► neuro ──► society ──► engine ──► cli
```

`core` knows nothing about worlds. `cosmos` knows nothing about life. Behaviour code
(`society/actions.ts`) receives a `SimulationContext` interface rather than the engine,
so it can be tested and reused. Only `engine` wires the layers together.

## Time

A tick is an arbitrary number of years:

```
currentYear = tick × yearsPerTick
```

At `yearsPerTick = 1` the model behaves like an annual census; a human lives ~72 ticks
and a grazer ~18. Sub-year ticks (< 0.25) let seasonal temperature matter; multi-year
ticks are allowed but coarsen demography. The engine scales energy demand, energy
stores, reproduction spacing and ageing by tick length so that a change of timestep does
not silently change the energy budget, but temporal resolution is genuinely lower.

## Tick phases

1. Advance tick and derive the tick's RNG stream (`fork('tick:N')`).
2. Apply interventions scheduled for this tick.
3. Environment: orbital distance → planetary mean temperature (+ shock) → climate grid
   → regenerate food stocks → rebuild spatial indexes and per-species technology.
4. Behaviour: every living individual, in a deterministically shuffled order, perceives,
   evaluates action utilities, chooses via softmax, acts, and learns from the reward.
5. Conflict: a dense settlement of an encephalised, aggressive lineage may raid a
   neighbouring group of the same species. This is bounded territorial violence, not a
   strategic war model; deaths are recorded with cause `war`.
6. Metabolism and mortality: pay the tick's energy demand, age, accumulate hazards
   (old age, autonomic failure, disease, exposure, starvation, injury), resolve them.
   Disease spikes and accident clusters are emitted as `plague` / `accident` events.
7. Cultural diffusion: co-located conspecifics exchange knowledge.
8. Compact the dead, rebuild indexes, update species knowledge unions, record metrics.
   The metrics step also samples a chronicle frame (people, settlement region, actions)
   every `ceil(ticks / 50)` ticks.

After the tick loop, `buildFutureHistory` extends the chronicle from the last simulated
year to 10 Gyr. This is a coarse future-history model, not a second individual-level
ecology: it integrates population, settlements and technology level with a logistic
carrying capacity, habitat loss and seeded shocks (plague, war, golden age, migration,
machine disruption, climate). Near-future frames include 2026; later frames are
log-spaced. The same seed always produces the same future; different seeds and starting
states produce different histories. Future residents are representatives of that
frame's population, not surviving individuals from the historical run.

`buildDeepTimeProjection` supplies the physical stage: main-sequence luminosity grows as
`L0 · (1 + 0.08 · massSolar · Gyr)`, surface temperature follows Stefan-Boltzmann scaling,
and the star leaves the main sequence at `lifetimeGyr`, becoming a red giant. Thresholds at
47 °C, 100 °C and 150 °C date the moist greenhouse, ocean loss and biosphere collapse. The
future model drives population to zero once the surface can no longer support it.

First collective discoveries are emitted when a species' knowledge union gains a
technology: `technology` for practical knowledge and `theory` for mathematics, germ
theory, the scientific method and genetics. Per-individual attempts are deliberately
not logged, so event ledgers stay readable.

The order is fixed; no system runs "whenever". This is what makes runs reproducible and
what makes `compare` meaningful.

## Determinism

- All randomness comes from `Rng`, a mulberry32 stream seeded by splitmix32.
- `rng.fork(label)` derives a new stream from the *original seed*, not from current
  state. Consuming numbers in one stream cannot shift another.
- Scenarios, species, interventions and initial conditions are data.
- The digest in the result hashes the final living population (ids, knowledge, genomes
  rounded to 6 decimals), the population series and event kinds.

Consequences: same seed + same code + same scenario = same digest, and adding a new
random system should not change existing streams. Tests assert both.

## Energy accounting

```
daily demand = 70 · massKg^0.75 · (1.25 − 0.5·metabolicEfficiency) + brainKg · 240
tick demand  = daily demand · 365 · yearsPerTick
store        = 3 · tick demand
```

Feeding actions target more than the store (organisms keep eating through the tick);
passive subsistence covers 75% of demand when the individual spent the tick on
something other than an explicit forage/hunt. This is an abstraction imposed by
"one action per tick", and it is documented in the code.

Plant and meat energy are converted with diet-dependent digestion efficiency. Thermal
stress beyond the comfort band adds resting cost and, beyond 12 °C of stress, mortality.
Predation is resolved as energy transfer: a successful kill transfers meat energy and
ends the prey.

## Reproduction and mortality

Reproduction requires: alive, healthy, inside the fertile window (14%–68% of lifespan),
past the birth spacing (3% of lifespan, minimum 0.5 y), sufficient energy, a receptive
conspecific in the same cell, and room below the per-species ceiling. Clutch size scales
with tick length:

```
clutch = clamp(round(fertility · yearsPerTick / (0.12 · lifespan)), 1, 8)
```

Mortality is a competing-risks model. Each hazard is per year and converted to the tick:
Gompertz senescence, autonomic failure `(1 − vitalTone)·1.9`, density-dependent disease,
thermal exposure, starvation, injury. The cause of each death is recorded, globally and
per species, and appears in reports.

## Brains

Regions carry functional tags (`vital`, `homeostasis`, `threat`, `memory`, `planning`,
`motor`, `social`). Each region integrates relevant percepts through sigmoid activation.
Action utilities sum region activity × weight × capacity, plus gene effects (curiosity,
aggression, sociality, fertility) and learned preference. Choice is a softmax draw whose
temperature comes from the species' exploration setting and the individual's learning
rate.

`cognition = 0.1 + 0.55·planning + 0.25·memory + 0.2·motor`, with region capacity
affected by the brain-mass gene (exponent 0.45) and per-region efficiency.

`vitalTone` is the normalised capacity of regions tagged `vital`. Normal architectures
sit at 1; ablating the medulla (with no ganglion substitute) gives 0, which drives a
~1.9/year mortality hazard — autonomic failure, not a behaviour penalty.

Learning is reward-modulated: the chosen action's preference shifts toward positive
rewards, with decay and clamping. This allows individuals to stop wasting effort on
unproductive actions.

## Culture and knowledge

Technologies are an ordered list; each has a bit, prerequisites and additive effects
(food yield, survival, fertility, innovation, transmission, cold resistance). Knowledge
is stored per individual as a bitmask. A species' effective technology is the union over
living members, so knowledge can be lost. It spreads through the `teach` action and
through passive diffusion among co-located conspecifics, both scaled by language/writing
effects and sociality.

## Outputs

`World.toResult()` produces a serialisable `RunResult`. `engine/report.ts` renders
Markdown and a dependency-free HTML report (canvas charts and a biome map). The digest is
part of both.

## What to replace first

For climate-focused work, replace `geo/climate.ts` with an energy-balance or GCM
coupling; the interface is a grid of temperature/precipitation/biome/NPP. For
cognition-focused work, replace `neuro/brain.ts` behind the same perception/action API.
For genetics, replace `bio/genome.ts` with explicit loci and expression. The rest of the
engine only depends on the exported functions.
