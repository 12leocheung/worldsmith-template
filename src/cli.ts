import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { World } from './engine/world.ts';
import { validateScenario, type Scenario } from './engine/scenario.ts';
import { comparisonMetrics, renderHtmlReport, renderMarkdown, type RunResult } from './engine/report.ts';
import { describeBody } from './cosmos/system.ts';
import { BIOMES } from './geo/biomes.ts';

const HELP = `Worldsmith — a deterministic world simulation template

Usage:
  npm run sim -- <command> [options]

Commands:
  list                      List scenario files in ./scenarios
  run <scenario.ts>         Run one scenario and write a report
  compare <base> <var...>   Run several scenarios with the same seed and compare
  inspect <scenario.ts>     Print the physical setting without running time
  validate [files...]       Type-check-ish validation of scenarios
  help                      Show this message

Options:
  --seed <number>           Override the scenario seed
  --ticks <number>          Override the number of ticks
  --out <dir>               Output directory (default: runs)
  --html <true|false>       Write the HTML report (default: true)
  --quiet                   Only print the output paths
`;

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'run';

const loadScenario = async (file: string): Promise<Scenario> => {
  const url = pathToFileURL(path.resolve(process.cwd(), file)).href;
  let module: { default?: unknown };
  try {
    module = (await import(url)) as { default?: unknown };
  } catch (error) {
    throw new Error(`Could not load scenario "${file}": ${(error as Error).message}`);
  }
  const scenario = module.default as Scenario | undefined;
  if (!scenario || typeof scenario !== 'object') {
    throw new Error(`Scenario file "${file}" must default-export a Scenario object`);
  }
  validateScenario(scenario);
  return scenario;
};

const scenarioFiles = async (): Promise<string[]> => {
  const dir = path.resolve(process.cwd(), 'scenarios');
  const entries = await readdir(dir);
  return entries
    .filter((entry) => entry.endsWith('.ts') && !entry.startsWith('_') && entry !== 'shared.ts')
    .sort()
    .map((entry) => path.join('scenarios', entry));
};

const printSummary = (result: RunResult, outputs: string[]): void => {
  const s = result.scenario;
  console.log(`\n${s.name}`);
  console.log(`${s.ticks} ticks × ${s.yearsPerTick} y = ${s.yearsTotal} years · seed ${s.seed} · digest ${result.digest}`);
  console.log(
    `${result.star.name} (${result.star.spectralClass}) · ${result.focusPlanet.name} at ${result.focusPlanet.distanceAu.toFixed(2)} AU, mean ${result.focusPlanet.meanTempC.toFixed(1)} °C`,
  );
  console.log(
    `population ${result.summary.initialPopulation} → ${result.summary.finalPopulation} (peak ${result.summary.peakPopulation}), births ${result.summary.births}, deaths ${result.summary.deaths}`,
  );
  console.log(
    `technologies ${result.summary.technologies.length}: ${result.summary.technologies.join(', ') || 'none'}`,
  );
  if (result.summary.extinctions.length > 0) console.log(`extinctions: ${result.summary.extinctions.join(', ')}`);
  for (const species of result.species) {
    console.log(
      `  ${species.name.padEnd(24)} ${String(species.initialPopulation).padStart(5)} → ${String(species.finalPopulation).padStart(5)}  peak ${String(species.peakPopulation).padStart(5)}  cognition ${species.meanCognition.toFixed(2)}`,
    );
  }
  if (outputs.length > 0) console.log(`\nWrote:\n${outputs.map((file) => `  ${file}`).join('\n')}`);
};

const runOne = async (
  file: string,
  options: { seed?: number; ticks?: number; outDir: string; html: boolean; quiet: boolean },
): Promise<{ result: RunResult; dir: string }> => {
  const scenario = await loadScenario(file);
  const result = new World(scenario, { seed: options.seed, ticks: options.ticks }).run();
  const dir = path.join(options.outDir, `${slugify(result.scenario.name)}-s${result.scenario.seed}`);
  await mkdir(dir, { recursive: true });
  const outputs = [
    path.join(dir, 'run.json'),
    path.join(dir, 'report.md'),
  ];
  await writeFile(path.join(dir, 'run.json'), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(dir, 'report.md'), renderMarkdown(result));
  if (options.html) {
    await writeFile(path.join(dir, 'report.html'), renderHtmlReport(result));
    outputs.push(path.join(dir, 'report.html'));
  }
  if (options.quiet) {
    console.log(outputs.join('\n'));
  } else {
    printSummary(result, outputs);
  }
  return { result, dir };
};

const commandRun = async (files: string[], options: RunOptions): Promise<void> => {
  if (files.length !== 1) throw new Error('run needs exactly one scenario file');
  await runOne(files[0] as string, options);
};

const commandCompare = async (files: string[], options: RunOptions): Promise<void> => {
  if (files.length < 2) throw new Error('compare needs a baseline and at least one variant');
  const runs: { file: string; result: RunResult }[] = [];
  for (const file of files) {
    const { result } = await runOne(file, { ...options, quiet: true });
    runs.push({ file, result });
  }
  const seed = runs[0]?.result.scenario.seed ?? options.seed ?? 0;
  const dir = path.join(options.outDir, `compare-${slugify(runs[0]?.result.scenario.name ?? 'baseline')}-s${seed}`);
  await mkdir(dir, { recursive: true });

  const base = runs[0] as { result: RunResult };
  const baseMetrics = comparisonMetrics(base.result);
  const metrics = Object.keys(baseMetrics);
  const rows = metrics.map((metric) => {
    const cells = runs.map(({ result }, index) => {
      const value = comparisonMetrics(result)[metric] ?? 0;
      if (index === 0) return String(value);
      const delta = value - (baseMetrics[metric] ?? 0);
      const sign = delta > 0 ? '+' : '';
      return `${value} (${sign}${Number.isInteger(delta) ? delta : delta.toFixed(3)})`;
    });
    return `| ${metric} | ${cells.join(' | ')} |`;
  });

  const header = `| Metric | ${runs.map((run) => run.result.scenario.name).join(' | ')} |`;
  const separator = `| --- | ${runs.map(() => '---:').join(' | ')} |`;
  const markdown = [
    '# Scenario comparison',
    '',
    `Seed \`${seed}\` · ${runs[0]?.result.scenario.ticks ?? 0} ticks × ${runs[0]?.result.scenario.yearsPerTick ?? 0} years`,
    '',
    header,
    separator,
    ...rows,
    '',
    'Deltas are relative to the first (baseline) scenario. Same seed and world mean differences come from the species/interventions, not from environmental luck.',
    '',
    ...runs.map(
      (run) =>
        `## ${run.result.scenario.name}\n\n${run.result.scenario.description}\n\nDigest: \`${run.result.digest}\``,
    ),
    '',
  ].join('\n');

  await writeFile(path.join(dir, 'comparison.json'), `${JSON.stringify(runs.map((run) => ({ file: run.file, metrics: comparisonMetrics(run.result), digest: run.result.digest, scenario: run.result.scenario })), null, 2)}\n`);
  await writeFile(path.join(dir, 'comparison.md'), markdown);

  console.log(`\nComparison (seed ${seed})`);
  console.log(header);
  for (const row of rows) console.log(row);
  console.log(`\nWrote:\n  ${path.join(dir, 'comparison.md')}\n  ${path.join(dir, 'comparison.json')}`);
};

const commandInspect = async (files: string[]): Promise<void> => {
  if (files.length !== 1) throw new Error('inspect needs exactly one scenario file');
  const scenario = await loadScenario(files[0] as string);
  const world = new World(scenario);
  console.log(`\n${scenario.name}`);
  console.log(scenario.description);
  console.log(`\nStar: ${world.star.name} (${world.star.spectralClass}), ${world.star.luminositySolar.toFixed(3)} L☉, ${world.star.lifetimeGyr.toFixed(1)} Gyr`);
  console.log(`Focus planet: ${world.planet.name} at ${world.focusBody.orbit.semiMajorAxisAu.toFixed(2)} AU`);
  for (const body of world.system.bodies) console.log(`  ${describeBody(world.system, body)}`);
  console.log(`\nSurface: ${world.terrain.width}×${world.terrain.height} cells, mean ${world.climate.meanTempC.toFixed(1)} °C, land ${(world.climate.landFraction * 100).toFixed(1)}%`);
  const biomeEntries = Object.entries(world.climate.biomeAreaFraction)
    .filter(([, fraction]) => fraction > 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([id, fraction]) => `${BIOMES[id as keyof typeof BIOMES]?.name ?? id} ${(fraction * 100).toFixed(1)}%`);
  console.log(`Biomes: ${biomeEntries.join(', ')}`);
  console.log(`\nFounding populations:`);
  for (const [id, runtime] of world.speciesById) {
    const count = world.individuals.filter((individual) => individual.speciesId === id).length;
    console.log(`  ${runtime.resolved.name}: ${count} (${runtime.resolved.role}) — ${runtime.resolved.brain.note ?? 'default brain'}`);
  }
  console.log('');
};

const commandList = async (): Promise<void> => {
  const files = await scenarioFiles();
  for (const file of files) {
    try {
      const scenario = await loadScenario(file);
      console.log(`${file}\n  ${scenario.name} — ${scenario.description}`);
    } catch (error) {
      console.log(`${file}\n  (invalid: ${(error as Error).message.split('\n')[0]})`);
    }
  }
};

const commandValidate = async (files: string[]): Promise<number> => {
  const targets = files.length > 0 ? files : await scenarioFiles();
  let failures = 0;
  for (const file of targets) {
    try {
      await loadScenario(file);
      console.log(`ok   ${file}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${file}\n  ${(error as Error).message}`);
    }
  }
  return failures === 0 ? 0 : 1;
};

interface RunOptions {
  seed?: number;
  ticks?: number;
  outDir: string;
  html: boolean;
  quiet: boolean;
}

const main = async (): Promise<number> => {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      seed: { type: 'string' },
      ticks: { type: 'string' },
      out: { type: 'string' },
      html: { type: 'boolean' },
      quiet: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (parsed.values.help) {
    console.log(HELP);
    return 0;
  }
  const [command = 'help', ...rest] = parsed.positionals;
  const seed = parsed.values.seed !== undefined ? Number(parsed.values.seed) : undefined;
  const ticks = parsed.values.ticks !== undefined ? Number(parsed.values.ticks) : undefined;
  if (seed !== undefined && !Number.isFinite(seed)) throw new Error('--seed must be a number');
  if (ticks !== undefined && (!Number.isFinite(ticks) || ticks <= 0)) throw new Error('--ticks must be a positive number');
  const options: RunOptions = {
    seed,
    ticks,
    outDir: parsed.values.out ?? 'runs',
    html: parsed.values.html ?? true,
    quiet: parsed.values.quiet ?? false,
  };

  switch (command) {
    case 'run':
      await commandRun(rest, options);
      return 0;
    case 'compare':
      await commandCompare(rest, options);
      return 0;
    case 'inspect':
      await commandInspect(rest);
      return 0;
    case 'list':
      await commandList();
      return 0;
    case 'validate':
      return commandValidate(rest);
    case 'help':
      console.log(HELP);
      return 0;
    default:
      console.error(`Unknown command "${command}"\n`);
      console.log(HELP);
      return 1;
  }
};

main()
  .then((code) => {
    if (code !== 0) process.exitCode = code;
  })
  .catch((error) => {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
  });

export type { RunOptions };
