import { mean, round } from '../core/math.ts';
import type { Genome } from '../bio/genome.ts';
import type { BiomeId } from '../geo/biomes.ts';
import { BIOMES } from '../geo/biomes.ts';
import type { WorldEvent } from '../society/context.ts';
import type { Chronicle } from './chronicle.ts';

export interface Series {
  ticks: number[];
  population: number[];
  speciesPopulation: Record<string, number[]>;
  births: number[];
  deaths: number[];
  meanCognition: number[];
  meanBrainMassKg: number[];
  meanBodyMassKg: number[];
  techCount: number[];
  foodFraction: number[];
  meanTempC: number[];
}

export interface SpeciesSummary {
  id: string;
  name: string;
  color: string;
  description: string;
  initialPopulation: number;
  finalPopulation: number;
  peakPopulation: number;
  births: number;
  deaths: number;
  extinct: boolean;
  extinctionTick: number | null;
  meanCognition: number;
  meanGenome: Genome;
  technologies: string[];
  brainSummary: string;
  /** Deaths by cause for this species. */
  deathCauses: Record<string, number>;
  /** Action mix for this species, in counts. */
  actions: Record<string, number>;
}

export interface RunResult {
  scenario: {
    name: string;
    description: string;
    seed: number;
    ticks: number;
    yearsPerTick: number;
    yearsTotal: number;
  };
  star: {
    name: string;
    spectralClass: string;
    massSolar: number;
    luminositySolar: number;
    surfaceTempK: number;
    lifetimeGyr: number;
  };
  focusPlanet: {
    name: string;
    kind: string;
    distanceAu: number;
    radiusKm: number;
    massEarth: number;
    gravity: number;
    yearDays: number;
    dayHours: number;
    axialTiltDeg: number;
    oceanFraction: number;
    meanTempC: number;
    gridWidth: number;
    gridHeight: number;
  };
  planets: { name: string; kind: string; distanceAu: number; meanTempC: number; massEarth: number }[];
  summary: {
    initialPopulation: number;
    finalPopulation: number;
    peakPopulation: number;
    births: number;
    deaths: number;
    extinctions: string[];
    technologies: string[];
    meanCognition: number;
    meanBrainMassKg: number;
    meanBodyMassKg: number;
    meanLifespanYears: number;
    logEntries: number;
    deathCauses: Record<string, number>;
    actions: Record<string, number>;
  };
  series: Series;
  species: SpeciesSummary[];
  events: WorldEvent[];
  /** Sampled people, settlements and event ledgers for the interactive page. */
  chronicle: Chronicle;
  map: {
    width: number;
    height: number;
    biome: BiomeId[];
    temperatureC: number[];
    population: number[];
  };
  digest: string;
}

const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;

const geneticHighlight = (genome: Genome): string =>
  [
    `body ${genome.bodyMassKg.toFixed(1)} kg`,
    `brain ${genome.brainMassKg.toFixed(2)} kg`,
    `lifespan ${genome.lifespanYears.toFixed(0)} y`,
    `diet ${genome.diet.toFixed(2)}`,
    `curiosity ${genome.curiosity.toFixed(2)}`,
  ].join(', ');

/** Human-readable Markdown report for one run. */
export const renderMarkdown = (result: RunResult): string => {
  const lines: string[] = [];
  const s = result.scenario;
  lines.push(`# ${s.name}`, '', s.description, '');
  lines.push(
    `**Seed** \`${s.seed}\` · **Duration** ${s.ticks} ticks × ${s.yearsPerTick} y = ${s.yearsTotal} simulated years · **Digest** \`${result.digest}\``,
    '',
  );

  lines.push('## Physical setting', '');
  lines.push('| Property | Value |', '| --- | --- |');
  lines.push(`| Star | ${result.star.name}, class ${result.star.spectralClass}, ${result.star.luminositySolar.toFixed(3)} L☉ |`);
  lines.push(`| Star lifetime | ${result.star.lifetimeGyr.toFixed(1)} Gyr |`);
  lines.push(
    `| Focus planet | ${result.focusPlanet.name} (${result.focusPlanet.kind}), ${result.focusPlanet.distanceAu.toFixed(2)} AU |`,
  );
  lines.push(
    `| Planet year / day | ${result.focusPlanet.yearDays.toFixed(0)} d / ${result.focusPlanet.dayHours.toFixed(1)} h |`,
  );
  lines.push(
    `| Gravity / tilt | ${result.focusPlanet.gravity.toFixed(2)} m/s² / ${result.focusPlanet.axialTiltDeg.toFixed(1)}° |`,
  );
  lines.push(`| Mean surface temperature | ${result.focusPlanet.meanTempC.toFixed(1)} °C |`);
  lines.push(`| Grid | ${result.focusPlanet.gridWidth} × ${result.focusPlanet.gridHeight} cells |`, '');

  lines.push('## Outcome', '');
  lines.push('| Metric | Value |', '| --- | --- |');
  lines.push(`| Population | ${result.summary.initialPopulation} → ${result.summary.finalPopulation} (peak ${result.summary.peakPopulation}) |`);
  lines.push(`| Births / deaths | ${result.summary.births} / ${result.summary.deaths} |`);
  lines.push(`| Mean cognition | ${result.summary.meanCognition.toFixed(2)} |`);
  lines.push(`| Mean brain mass | ${result.summary.meanBrainMassKg.toFixed(2)} kg |`);
  lines.push(`| Technologies | ${result.summary.technologies.length > 0 ? result.summary.technologies.join(', ') : 'none'} |`);
  lines.push(`| Extinctions | ${result.summary.extinctions.length > 0 ? result.summary.extinctions.join(', ') : 'none'} |`);
  const causes = Object.entries(result.summary.deathCauses)
    .map(([cause, count]) => `${cause} ${count}`)
    .join(', ');
  lines.push(`| Deaths by cause | ${causes || 'none'} |`);
  const actions = Object.entries(result.summary.actions)
    .map(([action, count]) => `${action} ${count}`)
    .join(', ');
  lines.push(`| Behaviour mix | ${actions || 'none'} |`, '');

  lines.push('## Species', '');
  lines.push('| Species | Start | End | Peak | Births | Deaths | Cognition | Fate |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const species of result.species) {
    lines.push(
      `| ${species.name} | ${species.initialPopulation} | ${species.finalPopulation} | ${species.peakPopulation} | ${species.births} | ${species.deaths} | ${species.meanCognition.toFixed(2)} | ${species.extinct ? 'extinct' : 'alive'} |`,
    );
  }
  lines.push('');

  for (const species of result.species) {
    lines.push(`### ${species.name}`, '', species.description, '');
    lines.push(`- Brain: ${species.brainSummary}`);
    lines.push(`- Mean genome: ${geneticHighlight(species.meanGenome)}`);
    lines.push(`- Knowledge: ${species.technologies.length > 0 ? species.technologies.join(', ') : 'none'}`);
    const speciesActions = Object.entries(species.actions).map(([action, count]) => `${action} ${count}`).join(', ');
    lines.push(`- Behaviour: ${speciesActions || 'none'}`);
    const speciesCauses = Object.entries(species.deathCauses).map(([cause, count]) => `${cause} ${count}`).join(', ');
    lines.push(`- Deaths: ${speciesCauses || 'none'}`, '');
  }

  lines.push('## Time series', '');
  lines.push('| Tick | Year | Population | Births | Deaths | Cognition | Techs | Food | Temp °C |');
  lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  const stride = Math.max(1, Math.floor(result.series.ticks.length / 12));
  for (let i = 0; i < result.series.ticks.length; i += stride) {
    lines.push(
      `| ${result.series.ticks[i]} | ${(result.series.ticks[i] as number) * s.yearsPerTick} | ${result.series.population[i]} | ${result.series.births[i]} | ${result.series.deaths[i]} | ${(result.series.meanCognition[i] as number).toFixed(2)} | ${result.series.techCount[i]} | ${pct(result.series.foodFraction[i] as number)} | ${(result.series.meanTempC[i] as number).toFixed(1)} |`,
    );
  }
  lines.push('');

  const biomeSummary = Object.entries(
    result.map.biome.reduce<Record<string, number>>((acc, biome) => {
      acc[biome] = (acc[biome] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .map(([biome, count]) => `${BIOMES[biome as BiomeId]?.name ?? biome} ${((count / result.map.biome.length) * 100).toFixed(1)}%`)
    .join(', ');
  lines.push('## Surface', '', `Biome coverage: ${biomeSummary}.`, '');

  if (result.events.length > 0) {
    lines.push('## Events', '');
    for (const event of result.events.slice(0, 30)) {
      lines.push(`- **t${event.tick}** (${event.kind}): ${event.message}`);
    }
    if (result.events.length > 30) lines.push(`- … and ${result.events.length - 30} more`);
    lines.push('');
  }

  lines.push('## Interpretation notes', '');
  lines.push(
    '- The climate model is zonal, not a general circulation model; latitude, elevation, seasons and greenhouse strength are represented, weather is not.',
    '- Energy flow follows Kleiber scaling. Population change is the sum of foraging success, predation, disease, thermal stress and ageing.',
    '- Cognition comes from a modular brain model; ablating a vital region (medulla, ganglia) causes autonomic failure rather than a behavioural penalty.',
    '- Cultural knowledge is held by individuals and unioned per species; technologies can be lost if every holder dies.',
    '- The digest identifies the exact final state. Re-running with the same seed, scenario and code reproduces it.',
    '',
  );

  return lines.join('\n');
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Render a single self-contained HTML report with charts and a surface map. */
export const renderHtmlReport = (result: RunResult): string => {
  // The chronicle has its own page; keeping it out of this payload preserves the
  // report's small, chart-focused script tag.
  const data = JSON.stringify({ ...result, chronicle: undefined }).replace(/</g, '\\u003c');
  const biomeColors = JSON.stringify(
    Object.fromEntries(Object.entries(BIOMES).map(([id, info]) => [id, info.color])),
  );
  const title = escapeHtml(result.scenario.name);
  const cards = [
    ['Population', `${result.summary.initialPopulation} → ${result.summary.finalPopulation}`],
    ['Peak', String(result.summary.peakPopulation)],
    ['Births / deaths', `${result.summary.births} / ${result.summary.deaths}`],
    ['Technologies', String(result.summary.technologies.length)],
    ['Mean cognition', result.summary.meanCognition.toFixed(2)],
    ['Extinctions', String(result.summary.extinctions.length)],
  ]
    .map(([label, value]) => `<div class="card"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`)
    .join('\n');

  const speciesRows = result.species
    .map(
      (species) =>
        `<tr><td><span class="dot" style="background:${escapeHtml(species.color)}"></span>${escapeHtml(species.name)}</td>` +
        `<td>${species.initialPopulation}</td><td>${species.finalPopulation}</td><td>${species.peakPopulation}</td>` +
        `<td>${species.births}</td><td>${species.deaths}</td><td>${species.meanCognition.toFixed(2)}</td>` +
        `<td>${species.extinct ? 'extinct' : 'alive'}</td></tr>`,
    )
    .join('\n');

  const techList = result.summary.technologies.length > 0 ? result.summary.technologies.join(' · ') : 'none';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Worldsmith report</title>
<style>
  :root { --bg:#0c1116; --panel:#141c24; --line:#25313d; --text:#e6edf3; --muted:#8b9bab; --accent:#5eead4; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { padding:32px 28px 18px; border-bottom:1px solid var(--line); }
  h1 { margin:0 0 6px; font-size:26px; letter-spacing:-0.02em; }
  h2 { font-size:16px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin:28px 0 12px; }
  p.sub { color:var(--muted); margin:0; max-width:90ch; }
  main { padding:0 28px 48px; max-width:1180px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-top:18px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:4px; }
  .card .label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:0.06em; }
  .card .value { font-size:20px; font-variant-numeric:tabular-nums; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width:900px) { .grid { grid-template-columns:1fr; } }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; }
  canvas { width:100%; height:auto; display:block; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
  th { color:var(--muted); font-weight:500; }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; }
  .meta { color:var(--muted); font-size:13px; }
  code { background:#1b2632; padding:1px 5px; border-radius:4px; }
  .legend { display:flex; flex-wrap:wrap; gap:10px; color:var(--muted); font-size:12px; margin-top:8px; }
  .legend span { display:inline-flex; align-items:center; gap:5px; }
  .swatch { width:11px; height:11px; border-radius:2px; }
  .chronicle-link { display:inline-block; border:1px solid var(--line); background:var(--accent); color:#06231f; text-decoration:none; font-weight:600; padding:7px 11px; border-radius:7px; font-size:13px; }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <p class="sub">${escapeHtml(result.scenario.description)}</p>
  <p class="meta">Seed <code>${result.scenario.seed}</code> · ${result.scenario.ticks} ticks × ${result.scenario.yearsPerTick} y = ${result.scenario.yearsTotal} years · digest <code>${result.digest}</code></p>
  <p style="margin:12px 0 0"><a class="chronicle-link" href="chronicle.html">Open the interactive chronicle →</a></p>
  <div class="cards">${cards}</div>
</header>
<main>
  <div class="grid">
    <section class="panel">
      <h2>Population</h2>
      <canvas id="populationChart" width="560" height="260"></canvas>
      <div class="legend" id="populationLegend"></div>
    </section>
    <section class="panel">
      <h2>Culture and cognition</h2>
      <canvas id="cultureChart" width="560" height="260"></canvas>
      <div class="legend"><span><span class="swatch" style="background:#5eead4"></span>technologies</span><span><span class="swatch" style="background:#f2c14e"></span>mean cognition</span></div>
    </section>
  </div>
  <h2>Surface</h2>
  <section class="panel">
    <canvas id="mapCanvas" width="960" height="420"></canvas>
    <div class="legend" id="biomeLegend"></div>
  </section>
  <h2>Species</h2>
  <section class="panel">
    <table>
      <thead><tr><th>Species</th><th>Start</th><th>End</th><th>Peak</th><th>Births</th><th>Deaths</th><th>Cognition</th><th>Fate</th></tr></thead>
      <tbody>${speciesRows}</tbody>
    </table>
  </section>
  <h2>Technology</h2>
  <section class="panel"><p>${escapeHtml(techList)}</p></section>
  <h2>Physical setting</h2>
  <section class="panel">
    <p class="meta">${escapeHtml(result.star.name)} (${escapeHtml(result.star.spectralClass)}) · ${result.star.luminositySolar.toFixed(3)} L☉ · ${result.star.lifetimeGyr.toFixed(1)} Gyr main sequence</p>
    <p class="meta">${escapeHtml(result.focusPlanet.name)} (${escapeHtml(result.focusPlanet.kind)}) · ${result.focusPlanet.distanceAu.toFixed(2)} AU · year ${result.focusPlanet.yearDays.toFixed(0)} d · day ${result.focusPlanet.dayHours.toFixed(1)} h · gravity ${result.focusPlanet.gravity.toFixed(2)} m/s² · mean ${result.focusPlanet.meanTempC.toFixed(1)} °C</p>
  </section>
  <h2>Events</h2>
  <section class="panel"><ul id="events"></ul></section>
</main>
<script id="run-data" type="application/json">${data}</script>
<script>
const data = JSON.parse(document.getElementById('run-data').textContent);
const biomeColors = ${biomeColors};
const palette = ['#5eead4','#f2c14e','#f472b6','#93c5fd','#c4b5fd','#fb923c','#a3e635','#fca5a5'];

const line = (ctx, points, color, width) => {
  ctx.beginPath();
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
  ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.stroke();
};

const drawAxes = (canvas, maxValue, minValue = 0) => {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, pad = 34;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#25313d'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad + ((h - pad * 1.4) * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - 10, y); ctx.stroke();
    ctx.fillStyle = '#8b9bab'; ctx.font = '11px system-ui'; ctx.textAlign = 'right';
    const value = maxValue - ((maxValue - minValue) * i) / 4;
    ctx.fillText(Number.isInteger(value) ? String(value) : value.toFixed(1), pad - 6, y + 4);
  }
  return { ctx, w, h, pad };
};

const xScale = (index, length, w, pad) => pad + ((w - pad - 12) * index) / Math.max(1, length - 1);

const drawPopulation = () => {
  const series = data.series;
  const maxValue = Math.max(1, ...series.population);
  const { ctx, w, h, pad } = drawAxes(document.getElementById('populationChart'), maxValue);
  Object.entries(series.speciesPopulation).forEach(([id, values], index) => {
    const species = data.species.find(s => s.id === id);
    const color = species ? species.color : palette[index % palette.length];
    line(ctx, values.map((v, i) => [xScale(i, values.length, w, pad), h - 18 - (v / maxValue) * (h - pad - 30)]), color, 2);
  });
  const legend = document.getElementById('populationLegend');
  legend.innerHTML = data.species.map(s => '<span><span class="swatch" style="background:' + s.color + '"></span>' + s.name + '</span>').join('');
};

const drawCulture = () => {
  const series = data.series;
  const maxTech = Math.max(1, ...series.techCount);
  const maxCog = Math.max(1, ...series.meanCognition);
  const { ctx, w, h, pad } = drawAxes(document.getElementById('cultureChart'), Math.max(maxTech, maxCog));
  line(ctx, series.techCount.map((v, i) => [xScale(i, series.techCount.length, w, pad), h - 18 - (v / Math.max(maxTech, maxCog)) * (h - pad - 30)]), '#5eead4', 2);
  line(ctx, series.meanCognition.map((v, i) => [xScale(i, series.meanCognition.length, w, pad), h - 18 - (v / Math.max(maxTech, maxCog)) * (h - pad - 30)]), '#f2c14e', 2);
};

const drawMap = () => {
  const canvas = document.getElementById('mapCanvas');
  const ctx = canvas.getContext('2d');
  const { width, height, biome, population } = data.map;
  const cellW = canvas.width / width;
  const cellH = canvas.height / height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const id = biome[j * width + i];
      ctx.fillStyle = biomeColors[id] || '#333';
      ctx.fillRect(i * cellW, j * cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
  }
  const maxPop = Math.max(1, ...population);
  for (let k = 0; k < population.length; k++) {
    if (!population[k]) continue;
    const i = k % width, j = Math.floor(k / width);
    const radius = 1.2 + Math.sqrt(population[k] / maxPop) * Math.min(cellW, cellH) * 0.42;
    ctx.beginPath();
    ctx.arc((i + 0.5) * cellW, (j + 0.5) * cellH, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
  }
  const legend = document.getElementById('biomeLegend');
  const counts = {};
  biome.forEach(id => counts[id] = (counts[id] || 0) + 1);
  legend.innerHTML = Object.entries(counts).sort((a,b) => b[1]-a[1]).map(([id, n]) =>
    '<span><span class="swatch" style="background:' + (biomeColors[id] || '#333') + '"></span>' +
    id + ' ' + ((n / biome.length) * 100).toFixed(1) + '%</span>').join('');
};

const events = document.getElementById('events');
events.innerHTML = data.events.slice(0, 40).map(e =>
  '<li><span class="meta">t' + e.tick + ' · ' + e.kind + '</span> — ' + String(e.message).replace(/</g, '&lt;') + '</li>'
).join('') || '<li class="meta">none</li>';

drawPopulation(); drawCulture(); drawMap();
</script>
</body>
</html>
`;
};

/** Compact metric comparison used by `sim compare`. */
export const comparisonMetrics = (result: RunResult): Record<string, number> => ({
  finalPopulation: result.summary.finalPopulation,
  peakPopulation: result.summary.peakPopulation,
  births: result.summary.births,
  deaths: result.summary.deaths,
  technologies: result.summary.technologies.length,
  meanCognition: round(result.summary.meanCognition, 3),
  meanBrainMassKg: round(result.summary.meanBrainMassKg, 3),
  extinctions: result.summary.extinctions.length,
  meanTempC: round(result.focusPlanet.meanTempC, 1),
  survivingSpecies: result.species.filter((species) => !species.extinct).length,
});

export const meanOfSeries = (values: number[]): number => round(mean(values), 3);
