import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunResult } from '../src/engine/report.ts';

/**
 * Build a static gallery for GitHub Pages from the generated runs.
 *
 * Pages serves `docs/` directly: this script copies each self-contained HTML report
 * into `docs/worlds/` and writes an index page with summary cards. No server, no
 * client-side build and no external dependencies.
 */

const RUNS_DIR = path.resolve('runs');
const OUT_DIR = path.resolve('docs');
const WORLDS_DIR = path.join(OUT_DIR, 'worlds');

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatNumber = (value: number): string => new Intl.NumberFormat('en-US').format(value);

interface WorldEntry {
  slug: string;
  result: RunResult;
  reportFile: string;
}

const loadWorlds = async (): Promise<WorldEntry[]> => {
  let entries: string[];
  try {
    entries = await readdir(RUNS_DIR);
  } catch {
    return [];
  }
  const worlds: WorldEntry[] = [];
  for (const slug of entries.sort()) {
    const runPath = path.join(RUNS_DIR, slug, 'run.json');
    const reportPath = path.join(RUNS_DIR, slug, 'report.html');
    let raw: string;
    try {
      raw = await readFile(runPath, 'utf8');
    } catch {
      continue;
    }
    try {
      await readFile(reportPath, 'utf8');
    } catch {
      continue;
    }
    worlds.push({ slug, result: JSON.parse(raw) as RunResult, reportFile: reportPath });
  }
  return worlds;
};

const card = (world: WorldEntry, highlight: boolean): string => {
  const { result } = world;
  const techs = result.summary.technologies.length;
  const species = result.species
    .map((entry) => `${escapeHtml(entry.name)} ${entry.finalPopulation > 0 ? formatNumber(entry.finalPopulation) : 'extinct'}`)
    .join(' · ');
  return `
    <article class="card${highlight ? ' highlight' : ''}">
      <header>
        <h2>${escapeHtml(result.scenario.name)}</h2>
        <p class="tagline">${escapeHtml(result.scenario.description)}</p>
      </header>
      <dl>
        <div><dt>Years simulated</dt><dd>${formatNumber(result.scenario.yearsTotal)}</dd></div>
        <div><dt>Population</dt><dd>${formatNumber(result.summary.finalPopulation)}</dd></div>
        <div><dt>Technologies</dt><dd>${techs} / 20</dd></div>
        <div><dt>Mean surface</dt><dd>${result.focusPlanet.meanTempC.toFixed(1)} °C</dd></div>
      </dl>
      <p class="species">${species}</p>
      <p class="meta">${escapeHtml(result.star.name)} (${escapeHtml(result.star.spectralClass)}) · ${escapeHtml(result.focusPlanet.name)} at ${result.focusPlanet.distanceAu.toFixed(2)} AU · seed <code>${result.scenario.seed}</code></p>
      <a class="button${highlight ? ' primary' : ''}" href="worlds/${encodeURIComponent(world.slug)}.html">Open report →</a>
    </article>`;
};

const build = async (): Promise<void> => {
  const worlds = await loadWorlds();
  if (worlds.length === 0) {
    throw new Error('No runs found. Run `npm run sim -- run scenarios/earthlike.ts` first.');
  }
  const defaultWorld =
    worlds.find((world) => world.result.scenario.name.toLowerCase().includes('baseline')) ?? worlds[0];
  const ordered = [defaultWorld, ...worlds.filter((world) => world !== defaultWorld)];

  await mkdir(WORLDS_DIR, { recursive: true });
  for (const world of worlds) {
    await copyFile(world.reportFile, path.join(WORLDS_DIR, `${world.slug}.html`));
  }
  await writeFile(path.join(OUT_DIR, '.nojekyll'), '');

  const totalYears = Math.max(...worlds.map((world) => world.result.scenario.yearsTotal));
  const totalPopulation = Math.max(...worlds.map((world) => world.result.summary.peakPopulation));

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Worldsmith — world simulation template</title>
<style>
  :root { --bg:#0b1015; --panel:#131c24; --line:#243241; --text:#e6edf3; --muted:#8b9bab; --accent:#5eead4; --gold:#f2c14e; }
  * { box-sizing: border-box; }
  body { margin:0; background:radial-gradient(1200px 600px at 70% -10%, #12303a 0%, var(--bg) 55%); color:var(--text); font:15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  a { color:var(--accent); }
  .wrap { max-width:1180px; margin:0 auto; padding:0 24px 64px; }
  header.hero { padding:72px 0 32px; border-bottom:1px solid var(--line); }
  .eyebrow { color:var(--accent); font-size:12px; letter-spacing:0.18em; text-transform:uppercase; margin:0 0 14px; }
  h1 { font-size:clamp(34px, 5vw, 56px); line-height:1.05; letter-spacing:-0.03em; margin:0 0 16px; }
  .lede { color:var(--muted); max-width:78ch; font-size:17px; margin:0 0 24px; }
  .stats { display:flex; gap:28px; flex-wrap:wrap; margin:20px 0 28px; }
  .stats div { display:flex; flex-direction:column; }
  .stats strong { font-size:26px; font-weight:600; font-variant-numeric:tabular-nums; }
  .stats span { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:0.08em; }
  .button { display:inline-block; border:1px solid var(--line); color:var(--text); text-decoration:none; padding:10px 16px; border-radius:9px; font-size:14px; }
  .button.primary { background:var(--accent); border-color:var(--accent); color:#06231f; font-weight:600; }
  .button.primary:hover { filter:brightness(1.08); }
  h2 { margin:0 0 8px; font-size:20px; letter-spacing:-0.01em; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; margin:28px 0 0; }
  .card { display:flex; flex-direction:column; gap:14px; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:20px; }
  .card.highlight { border-color:#2f6f66; box-shadow:0 0 0 1px #2f6f66 inset, 0 18px 50px -30px #5eead4; }
  .tagline { color:var(--muted); font-size:13.5px; margin:0; }
  dl { display:grid; grid-template-columns:1fr 1fr; gap:10px 16px; margin:0; }
  dt { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0.07em; }
  dd { margin:2px 0 0; font-size:18px; font-variant-numeric:tabular-nums; }
  .species { margin:0; font-size:13px; color:#c8d3dd; }
  .meta { margin:0; color:var(--muted); font-size:12px; }
  code { background:#1b2632; padding:1px 5px; border-radius:4px; }
  .card .button { margin-top:auto; text-align:center; }
  section.about { margin-top:48px; display:grid; grid-template-columns:1.3fr 1fr; gap:24px; }
  @media (max-width:800px) { section.about { grid-template-columns:1fr; } }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:22px; }
  .panel h3 { margin:0 0 10px; font-size:16px; }
  .panel p, .panel li { color:#c2ccd6; font-size:14px; }
  .panel ul { margin:0; padding-left:18px; }
  pre { margin:12px 0 0; padding:14px; background:#0a1218; border:1px solid var(--line); border-radius:10px; overflow-x:auto; font-size:13px; color:#bfe9e2; }
  footer { margin-top:40px; padding-top:18px; border-top:1px solid var(--line); color:var(--muted); font-size:12.5px; display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; }
  nav.docs { display:flex; gap:16px; flex-wrap:wrap; margin-top:18px; font-size:13.5px; }
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <p class="eyebrow">Deterministic world-simulation template</p>
    <h1>Worldsmith</h1>
    <p class="lede">Stars, planets and climate. Genomes and metabolism. Modular brains, animal populations and cultural evolution.
    Each world below is a reproducible experiment: same seed, same code, same digest. The default world is the place to start.</p>
    <div class="stats">
      <div><strong>${worlds.length}</strong><span>experiments</span></div>
      <div><strong>${formatNumber(totalYears)}</strong><span>max simulated years</span></div>
      <div><strong>${formatNumber(totalPopulation)}</strong><span>peak population</span></div>
      <div><strong>20</strong><span>technologies</span></div>
    </div>
    <a class="button primary" href="worlds/${encodeURIComponent(defaultWorld.slug)}.html">Watch the default world →</a>
    <nav class="docs">
      <a href="architecture.md">Architecture</a>
      <a href="scenarios.md">Scenario reference</a>
      <a href="extending.md">Extend it</a>
      <a href="../README.md">README</a>
    </nav>
  </header>

  <section class="grid">
${ordered.map((world) => card(world, world === defaultWorld)).join('\n')}
  </section>

  <section class="about">
    <div class="panel">
      <h3>What an experiment contains</h3>
      <ul>
        <li>A physical setting: star, orbit, planet, surface grid, climate and biomes.</li>
        <li>Genomes, metabolic budgets, brain architecture and individual behaviours.</li>
        <li>Demography, predation, disease, technology and cultural transmission.</li>
        <li>Interventions at chosen ticks, followed by comparable outcomes.</li>
      </ul>
      <p>Each report shows the population trajectory, technology and cognition curves, the final surface map with settlements, species outcomes, causes of death and behaviour mix.</p>
    </div>
    <div class="panel">
      <h3>Run it yourself</h3>
      <p>Clone the template and reproduce any report. Node 22.18+ runs the TypeScript directly.</p>
      <pre>npm install
npm run sim -- run scenarios/earthlike.ts
npm run sim -- compare scenarios/earthlike.ts \\
  scenarios/hypercognitive.ts --ticks 300</pre>
      <p>The seed and state digest are printed in every report, so two runs can be compared mechanically.</p>
    </div>
  </section>

  <footer>
    <span>Worldsmith · ${worlds.length} generated world${worlds.length === 1 ? '' : 's'} · static gallery for GitHub Pages</span>
    <span>Reports are self-contained; no tracking, no external requests.</span>
  </footer>
</div>
</body>
</html>
`;

  await writeFile(path.join(OUT_DIR, 'index.html'), html);
  console.log(`Wrote docs/index.html and ${worlds.length} world report(s) to docs/worlds/`);
};

build().catch((error: unknown) => {
  console.error(`Site build failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
