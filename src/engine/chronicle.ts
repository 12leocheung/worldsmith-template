import { BIOMES, type BiomeId } from '../geo/biomes.ts';
import type { DeepTimeProjection } from '../cosmos/deep-time.ts';
import type { RunResult } from './report.ts';

/**
 * A sampled, presentable history of one run.
 *
 * The simulation itself tracks every individual; a chronicle keeps a bounded number
 * of snapshots so a static page can show people, settlements and events at any year
 * without embedding the whole population on every tick.
 */
export interface ResidentView {
  id: number;
  name: string;
  speciesId: string;
  speciesName: string;
  color: string;
  cell: number;
  action: string;
  actionLabel: string;
  ageYears: number;
  /** Stored energy as a percentage of capacity. */
  energy: number;
  /** Health as a percentage. */
  health: number;
  techs: number;
  known: string[];
  offspring: number;
  sapient: boolean;
  /** Deterministic position within the tile, 0..1. */
  x: number;
  y: number;
}

export interface ChronicleSnapshot {
  tick: number;
  year: number;
  population: number;
  settlements: number;
  centerCell: number;
  place: string;
  region: {
    width: number;
    height: number;
    originX: number;
    originY: number;
    centerX: number;
    centerY: number;
    biome: BiomeId[];
    population: number[];
  };
  residents: ResidentView[];
}

export interface ChronicleEvent {
  tick: number;
  year: number;
  title: string;
  detail: string;
  speciesId?: string;
  techId?: string;
}

export interface Chronicle {
  intervalTicks: number;
  snapshots: ChronicleSnapshot[];
  technologies: ChronicleEvent[];
  theories: ChronicleEvent[];
  wars: ChronicleEvent[];
  accidents: ChronicleEvent[];
  /** Astrophysical projection from the end of the simulated run to 10 Gyr. */
  deepTime: DeepTimeProjection;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Render the interactive, pixel-isometric chronicle for one run.
 *
 * The page is completely self-contained: no external fonts, scripts or requests.
 */
export const renderChronicle = (result: RunResult): string => {
  const chronicle = result.chronicle;
  if (!chronicle || chronicle.snapshots.length === 0) {
    return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(result.scenario.name)} — chronicle</title>
<body style="background:#0b0f14;color:#e8f0f2;font:14px monospace;padding:32px">
<p>No chronicle snapshots were recorded for this run.</p>
<p><a style="color:#7ef0c0" href="report.html">Back to the report</a></p></body>`;
  }

  const payload = {
    scenario: {
      name: result.scenario.name,
      description: result.scenario.description,
      seed: result.scenario.seed,
      yearsTotal: result.scenario.yearsTotal,
    },
    species: result.species.map((species) => ({ id: species.id, name: species.name, color: species.color })),
    mapWidth: result.map.width,
    biomeColors: Object.fromEntries(Object.entries(BIOMES).map(([id, biome]) => [id, biome.color])),
    chronicle,
  };
  const data = JSON.stringify(payload).replace(/</g, '\\u003c');
  const title = escapeHtml(result.scenario.name);
  const description = escapeHtml(result.scenario.description);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Worldsmith chronicle</title>
<style>
  :root {
    --ink:#080d12; --panel:#101922; --panel2:#15212b; --line:#2b3d4a;
    --text:#e8f0f2; --muted:#8fa3ad; --accent:#7ef0c0; --gold:#ffd166;
    --red:#ff6b6b; --pink:#f48fb1; --blue:#7cc7ff; --violet:#c3a6ff;
  }
  * { box-sizing:border-box; }
  html, body { margin:0; }
  body {
    background:var(--ink); color:var(--text);
    font:14px/1.55 "Courier New", ui-monospace, monospace;
    image-rendering:pixelated;
  }
  a { color:var(--accent); }
  .wrap { max-width:1240px; margin:0 auto; padding:0 18px 48px; }
  header.top {
    padding:26px 0 18px; border-bottom:2px solid var(--line);
    display:flex; justify-content:space-between; gap:18px; align-items:flex-end; flex-wrap:wrap;
  }
  .eyebrow { color:var(--accent); font-size:11px; letter-spacing:.22em; text-transform:uppercase; margin:0 0 8px; }
  h1 { margin:0; font-size:clamp(24px,4vw,40px); letter-spacing:-.02em; text-shadow:3px 3px 0 #000; }
  .sub { color:var(--muted); margin:6px 0 0; max-width:76ch; font-size:13px; }
  .back { color:var(--muted); font-size:12px; text-decoration:none; border-bottom:1px dashed var(--line); padding-bottom:2px; white-space:nowrap; }
  .back:hover { color:var(--accent); }
  .layout { display:grid; grid-template-columns:minmax(0,1.7fr) minmax(280px,.9fr); gap:14px; margin-top:16px; }
  @media (max-width:900px) { .layout { grid-template-columns:1fr; } }
  .panel {
    background:var(--panel); border:2px solid var(--line);
    box-shadow:4px 4px 0 #000; padding:12px;
  }
  .panel h2 {
    margin:0 0 10px; font-size:12px; letter-spacing:.14em; text-transform:uppercase;
    color:var(--muted); display:flex; justify-content:space-between; gap:10px; align-items:center;
  }
  .scene-wrap { position:relative; background:#0a1218; border:2px solid var(--line); box-shadow:4px 4px 0 #000; overflow:hidden; }
  .scene-wrap::after {
    content:""; position:absolute; inset:0; pointer-events:none;
    background:repeating-linear-gradient(0deg, rgba(0,0,0,.16) 0 1px, transparent 1px 3px);
    mix-blend-mode:multiply;
  }
  canvas#scene { display:block; width:100%; height:auto; image-rendering:pixelated; cursor:crosshair; }
  .hud { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  .stat { flex:1 1 90px; background:var(--panel2); border:2px solid var(--line); padding:7px 9px; }
  .stat b { display:block; font-size:17px; font-variant-numeric:tabular-nums; color:var(--accent); }
  .stat span { font-size:10px; color:var(--muted); letter-spacing:.1em; text-transform:uppercase; }
  .place { color:var(--gold); font-size:13px; margin-top:8px; }
  .people { display:flex; flex-direction:column; gap:5px; max-height:330px; overflow:auto; padding-right:4px; }
  .person {
    display:flex; align-items:center; gap:8px; width:100%; text-align:left; cursor:pointer;
    background:var(--panel2); border:2px solid transparent; color:var(--text);
    font:12px/1.3 "Courier New", monospace; padding:5px 6px;
  }
  .person:hover { border-color:var(--line); }
  .person.selected { border-color:var(--accent); box-shadow:2px 2px 0 #000; }
  .swatch { width:8px; height:8px; flex:0 0 auto; box-shadow:0 0 0 1px #000; }
  .person .act { margin-left:auto; color:var(--muted); font-size:10px; text-transform:uppercase; }
  .detail { background:var(--panel2); border:2px solid var(--line); padding:10px; min-height:118px; margin-top:10px; }
  .detail h3 { margin:0 0 2px; font-size:15px; color:var(--gold); }
  .detail .species { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
  .detail p { margin:7px 0 0; font-size:12px; color:#c9d6dc; }
  .bars { display:grid; gap:4px; margin-top:8px; }
  .bar { height:7px; background:#0a1218; border:1px solid var(--line); position:relative; }
  .bar i { display:block; height:100%; }
  .bar span { position:absolute; right:3px; top:-13px; font-size:9px; color:var(--muted); }
  .timeline { margin-top:14px; }
  .time-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .time-head b { color:var(--gold); font-size:18px; font-variant-numeric:tabular-nums; }
  button.pixel {
    background:var(--accent); color:#052019; border:2px solid #000; box-shadow:2px 2px 0 #000;
    font:11px/1 "Courier New", monospace; letter-spacing:.08em; text-transform:uppercase;
    padding:8px 10px; cursor:pointer;
  }
  button.pixel:active { transform:translate(2px,2px); box-shadow:none; }
  button.ghost { background:var(--panel2); color:var(--text); border-color:var(--line); }
  input[type=range] {
    -webkit-appearance:none; appearance:none; width:100%; height:18px; background:transparent; margin:12px 0 4px;
  }
  input[type=range]::-webkit-slider-runnable-track { height:6px; background:#20313d; border:1px solid #000; }
  input[type=range]::-moz-range-track { height:6px; background:#20313d; border:1px solid #000; }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance:none; width:12px; height:18px; background:var(--accent); border:2px solid #000; margin-top:-7px;
  }
  input[type=range]::-moz-range-thumb { width:10px; height:16px; background:var(--accent); border:2px solid #000; border-radius:0; }
  .markers { position:relative; height:18px; border-bottom:1px solid var(--line); }
  .marker {
    position:absolute; top:4px; width:5px; height:9px; padding:0; border:1px solid #000; cursor:pointer; transform:translateX(-2px);
  }
  .marker:hover { outline:1px solid var(--text); }
  .legend { display:flex; gap:12px; flex-wrap:wrap; color:var(--muted); font-size:10px; margin-top:8px; text-transform:uppercase; letter-spacing:.06em; }
  .legend i { display:inline-block; width:7px; height:7px; margin-right:4px; box-shadow:0 0 0 1px #000; }
  .lower { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(300px,.9fr); gap:14px; margin-top:14px; }
  @media (max-width:900px) { .lower { grid-template-columns:1fr; } }
  .tabs { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px; }
  .tab { background:var(--panel2); border:2px solid var(--line); color:var(--muted); font:10px/1 "Courier New", monospace; letter-spacing:.08em; text-transform:uppercase; padding:7px 8px; cursor:pointer; }
  .tab.active { color:#052019; background:var(--gold); border-color:#000; box-shadow:2px 2px 0 #000; }
  .ledger { display:flex; flex-direction:column; gap:5px; max-height:300px; overflow:auto; }
  .entry {
    display:grid; grid-template-columns:52px 1fr; gap:8px; width:100%; text-align:left; cursor:pointer;
    background:var(--panel2); border:2px solid transparent; color:var(--text); font:12px/1.35 "Courier New", monospace; padding:6px 7px;
  }
  .entry:hover { border-color:var(--line); }
  .entry .year { color:var(--gold); font-variant-numeric:tabular-nums; }
  .entry .detail { border:0; padding:0; margin:2px 0 0; min-height:0; background:transparent; font-size:11px; color:var(--muted); }
  .empty { color:var(--muted); font-size:12px; padding:10px 2px; }
  .foot { margin-top:18px; color:var(--muted); font-size:11px; border-top:2px solid var(--line); padding-top:12px; }
  .kbd { color:var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <p class="eyebrow">Worldsmith chronicle · seed ${result.scenario.seed}</p>
      <h1>${title}</h1>
      <p class="sub">${description}</p>
    </div>
    <a class="back" href="report.html">← data report</a>
  </header>

  <div class="layout">
    <div>
      <div class="scene-wrap"><canvas id="scene" width="640" height="400"></canvas></div>
      <div class="hud">
        <div class="stat"><b id="stat-pop">0</b><span>people</span></div>
        <div class="stat"><b id="stat-settlements">0</b><span>settled cells</span></div>
        <div class="stat"><b id="stat-year">0</b><span>year</span></div>
        <div class="stat"><b id="stat-species">0</b><span>lineages</span></div>
      </div>
      <p class="place" id="place">—</p>
      <div class="timeline">
        <div class="time-head">
          <button class="pixel" id="play">▶ play</button>
          <b id="year-label">year 0</b>
          <span class="legend"><i style="background:var(--accent)"></i>technology <i style="background:var(--violet)"></i>theory <i style="background:var(--red)"></i>war <i style="background:var(--pink)"></i>plague / accident <i style="background:#ff9f43"></i>deep time</span>
        </div>
        <div class="markers" id="markers"></div>
        <input type="range" id="time" min="0" max="${chronicle.snapshots.length + (chronicle.deepTime?.frames.length ?? 0) - 1}" value="0" step="1" />
        <div class="legend">drag to move through time · click a marker to jump to an event</div>
      </div>
    </div>

    <aside class="panel">
      <h2>People <span id="people-count"></span></h2>
      <div class="people" id="people"></div>
      <div class="detail" id="detail"></div>
    </aside>
  </div>

  <div class="lower">
    <section class="panel">
      <h2>Chronicle <span class="kbd">click to jump</span></h2>
      <div class="tabs" id="tabs"></div>
      <div class="ledger" id="ledger"></div>
    </section>
    <section class="panel">
      <h2>What you are looking at</h2>
      <p class="sub" style="margin:0;font-size:12px">
        Each sprite is one simulated individual in the most populated settlement region. Its colour is its lineage;
        the small square above its head shows what it did in the current tick. Click a sprite or a name to inspect age,
        health, energy, knowledge and offspring. The ledger lists first discoveries, theories, raids and disease or
        accident outbreaks. Scrub the timeline to watch the settlement change.
      </p>
      <p class="sub" style="margin:10px 0 0;font-size:11px">
        Snapshots every ${chronicle.intervalTicks} tick${chronicle.intervalTicks === 1 ? '' : 's'} ·
        ${chronicle.snapshots.length} simulated frames · ${result.scenario.yearsTotal} simulated years,
        then a log-spaced astrophysical projection ${chronicle.deepTime?.frames.length ?? 0} frames out to
        ${(chronicle.deepTime?.targetYears ?? 10_000_000_000).toLocaleString('en-US')} years.
        Deep-time frames are a stellar-evolution projection, not a second ecological simulation.
      </p>
    </section>
  </div>

  <p class="foot">Worldsmith · pixel-isometric chronicle · deterministic seed ${result.scenario.seed} · digest <span class="kbd">${result.digest}</span></p>
</div>

<script id="chronicle-data" type="application/json">${data}</script>
<script>
(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('chronicle-data').textContent);
  var C = DATA.chronicle;
  var SNAPS = C.snapshots;
  var DEEP = C.deepTime || { targetYears: 0, frames: [], events: [] };
  var LAST = SNAPS[SNAPS.length - 1];
  var FRAMES = SNAPS.map(function (s) { s.kind = 'history'; return s; });
  DEEP.frames.forEach(function (f) {
    FRAMES.push({
      kind: 'deep', tick: 0, year: f.year, population: 0, settlements: 0,
      centerCell: LAST.centerCell, place: f.epoch, region: LAST.region, residents: [],
      epoch: f.epoch, description: f.description, temperatureC: f.temperatureC,
      luminositySolar: f.luminositySolar, habitable: f.habitable
    });
  });
  var LEDGERS = {
    technologies: C.technologies, theories: C.theories, wars: C.wars,
    accidents: C.accidents, epochs: DEEP.events || []
  };
  var BIOMES = DATA.biomeColors;
  var SPECIES = {};
  DATA.species.forEach(function (s) { SPECIES[s.id] = s; });
  var MAP_WIDTH = DATA.mapWidth;
  var ACTION_COLORS = {
    forage: '#7ef0c0', hunt: '#ff6b6b', mate: '#f48fb1', rest: '#7cc7ff',
    explore: '#ffd166', teach: '#5eead4', socialize: '#c3a6ff', innovate: '#ffa94d', flee: '#adb5bd'
  };
  var TILE_W = 48, TILE_H = 24;
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var hitboxes = [];
  var index = 0;
  var selectedId = null;
  var activeTab = 'technologies';
  var timer = null;

  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16);
    n = n + (n << 3);
    n = n ^ (n >>> 4);
    n = Math.imul(n, 0x27d4eb2d);
    n = n ^ (n >>> 15);
    return n >>> 0;
  }
  function shade(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.max(0, Math.min(255, (n >> 16) + amount));
    var g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
    var b = Math.max(0, Math.min(255, (n & 255) + amount));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function tileCenter(x, y) {
    return [canvas.width / 2 + (x - y) * (TILE_W / 2), 44 + (x + y) * (TILE_H / 2)];
  }
  function diamond(cx, cy, color) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - TILE_H / 2);
    ctx.lineTo(cx + TILE_W / 2, cy);
    ctx.lineTo(cx, cy + TILE_H / 2);
    ctx.lineTo(cx - TILE_W / 2, cy);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#0a1218';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  function hut(cx, cy, size, body, roof) {
    var w = 5 * size, h = 4 * size;
    ctx.fillStyle = '#241a14';
    ctx.fillRect(Math.round(cx - w / 2), Math.round(cy - h), Math.round(w), Math.round(h));
    ctx.fillStyle = body;
    ctx.fillRect(Math.round(cx - w / 2 + 1), Math.round(cy - h + 1), Math.round(w - 2), Math.round(h - 1));
    ctx.fillStyle = roof;
    ctx.fillRect(Math.round(cx - w / 2 - 1), Math.round(cy - h - 2 * size), Math.round(w + 2), Math.round(2 * size));
    ctx.fillStyle = '#080d12';
    ctx.fillRect(Math.round(cx - 1), Math.round(cy - h + size), 2, Math.round(2 * size));
  }
  function drawAgent(resident, x, y, isSelected) {
    var tc = tileCenter(x, y);
    var px = Math.round(tc[0] + (resident.x - 0.5) * TILE_W * 0.55);
    var py = Math.round(tc[1] + (resident.y - 0.5) * TILE_H * 0.45 + 3);
    var color = resident.color || '#f2c14e';
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(px - 3, py + 1, 7, 2);
    if (isSelected) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px - 4, py - 11, 9, 14);
    }
    ctx.fillStyle = color;
    ctx.fillRect(px - 2, py - 6, 5, 7);
    ctx.fillStyle = shade(color, -28);
    ctx.fillRect(px - 2, py - 9, 5, 3);
    ctx.fillStyle = '#080d12';
    ctx.fillRect(px - 1, py - 8, 1, 1);
    ctx.fillRect(px + 1, py - 8, 1, 1);
    ctx.fillStyle = ACTION_COLORS[resident.action] || '#ffffff';
    ctx.fillRect(px + 3, py - 12, 3, 3);
    hitboxes.push({ x: px - 5, y: py - 13, w: 11, h: 17, id: resident.id });
  }
  function drawScene() {
    var snap = FRAMES[index];
    var region = snap.region;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#0a1620');
    sky.addColorStop(0.55, '#10222b');
    sky.addColorStop(1, '#0a1218');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    hitboxes = [];
    var x, y;
    for (y = 0; y < region.height; y++) {
      for (x = 0; x < region.width; x++) {
        var i = y * region.width + x;
        var biome = region.biome[i] || 'grassland';
        var color = BIOMES[biome] || '#3f7d3a';
        var tc = tileCenter(x, y);
        diamond(tc[0], tc[1], color);
        var h = hash(i + region.originX * 131 + region.originY * 977);
        if (h % 3 === 0) {
          ctx.fillStyle = shade(color, 14);
          ctx.fillRect(Math.round(tc[0] - 8 + (h % 9)), Math.round(tc[1] - 4 + (h % 5)), 2, 1);
        }
        if (h % 4 === 0) {
          ctx.fillStyle = shade(color, -18);
          ctx.fillRect(Math.round(tc[0] + 4 - (h % 7)), Math.round(tc[1] + 2), 3, 1);
        }
        var pop = region.population[i] || 0;
        var isCenter = (region.originX + x === region.centerX) && (region.originY + y === region.centerY);
        if (pop > 0 && snap.kind !== 'deep') {
          var huts = Math.min(3, 1 + Math.floor(pop / 8));
          for (var k = 0; k < huts; k++) {
            var hk = hash(h + k * 37);
            var ox = ((hk % 17) - 8) * 0.7;
            var oy = ((hk >>> 5) % 9) - 4;
            hut(tc[0] + ox, tc[1] + oy, k === 0 ? 1 : 0.8, isCenter ? '#d8b46a' : '#8a6a44', isCenter ? '#ffd166' : shade(color, -40));
          }
          if (isCenter) {
            ctx.fillStyle = '#ffd166';
            ctx.fillRect(Math.round(tc[0] - 2), Math.round(tc[1] - 26), 2, 6);
            ctx.fillStyle = '#080d12';
            ctx.fillRect(Math.round(tc[0] + 1), Math.round(tc[1] - 26), 6, 3);
          }
        }
      }
    }
    if (snap.kind === 'deep') {
      var heat = Math.max(0, Math.min(0.62, (snap.temperatureC - 10) / 170));
      if (heat > 0) {
        ctx.fillStyle = 'rgba(200,64,32,' + heat + ')';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (snap.habitable) {
        ctx.fillStyle = 'rgba(48,120,80,.10)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.fillStyle = '#ffd166';
      ctx.font = '10px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('DEEP TIME · ' + String(snap.epoch).toUpperCase(), canvas.width / 2, 18);
      ctx.fillStyle = '#e8f0f2';
      ctx.fillText(formatYear(snap.year) + ' YEARS · ' + snap.temperatureC.toFixed(0) + ' °C', canvas.width / 2, 31);
      ctx.textAlign = 'left';
      return;
    }
    var residents = snap.residents.slice().sort(function (a, b) {
      return (a.cell % MAP_WIDTH) - (b.cell % MAP_WIDTH) || Math.floor(a.cell / MAP_WIDTH) - Math.floor(b.cell / MAP_WIDTH);
    });
    residents.forEach(function (r) {
      var tx = (r.cell % MAP_WIDTH) - region.originX;
      var ty = Math.floor(r.cell / MAP_WIDTH) - region.originY;
      if (tx >= 0 && ty >= 0 && tx < region.width && ty < region.height) drawAgent(r, tx, ty, r.id === selectedId);
    });
  }
  function currentSnap() { return FRAMES[index]; }
  function formatYear(year) {
    if (year >= 1e9) return (year / 1e9).toFixed(year >= 1e10 ? 0 : 1) + ' Gyr';
    if (year >= 1e6) return (year / 1e6).toFixed(1) + ' Myr';
    if (year >= 1e4) return (year / 1e3).toFixed(1) + ' kyr';
    return Math.round(year).toLocaleString() + ' y';
  }
  function nearestIndexForYear(year) {
    var best = 0, diff = Infinity;
    for (var i = 0; i < FRAMES.length; i++) {
      var d = Math.abs(FRAMES[i].year - year);
      if (d < diff) { diff = d; best = i; }
    }
    return best;
  }
  function renderStats() {
    var s = currentSnap();
    document.getElementById('stat-pop').textContent = s.kind === 'deep' ? '0' : s.population.toLocaleString();
    document.getElementById('stat-settlements').textContent = s.kind === 'deep' ? '—' : s.settlements.toLocaleString();
    document.getElementById('stat-year').textContent = s.year.toLocaleString();
    document.getElementById('stat-species').textContent = s.kind === 'deep' ? '—' : String(DATA.species.length);
    document.getElementById('place').textContent = s.kind === 'deep'
      ? '◎ ' + s.epoch + ' · astrophysical projection'
      : '◎ ' + s.place + ' · the largest settlement in this frame';
    document.getElementById('year-label').textContent = 'year ' + s.year.toLocaleString();
    document.getElementById('time').value = String(index);
  }
  function renderPeople() {
    var s = currentSnap();
    var holder = document.getElementById('people');
    if (s.kind === 'deep') {
      document.getElementById('people-count').textContent = '(deep time)';
      holder.innerHTML = '<p class="empty">No living residents in this astrophysical epoch.</p>';
      return;
    }
    document.getElementById('people-count').textContent = '(' + s.residents.length + ' shown)';
    holder.innerHTML = '';
    s.residents.forEach(function (r) {
      var b = document.createElement('button');
      b.className = 'person' + (r.id === selectedId ? ' selected' : '');
      b.innerHTML = '<span class="swatch" style="background:' + r.color + '"></span>' +
        '<span>' + r.name + '</span><span class="act">' + r.actionLabel + '</span>';
      b.addEventListener('click', function () { selectedId = r.id; renderAll(); });
      holder.appendChild(b);
    });
  }
  function bar(label, value, color) {
    return '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, value)) + '%;background:' + color + '"></i><span>' + label + ' ' + Math.round(value) + '%</span></div>';
  }
  function renderDetail() {
    var s = currentSnap();
    var holder = document.getElementById('detail');
    if (s.kind === 'deep') {
      holder.innerHTML = '<h3>' + s.epoch + '</h3><p class="species">' + formatYear(s.year) + ' from now · deep time</p>' +
        '<p>' + s.description + '</p><p>Surface ' + s.temperatureC.toFixed(1) + ' °C · luminosity ' +
        s.luminositySolar.toFixed(3) + ' L☉ · ' + (s.habitable ? 'habitable window' : 'outside the habitable window') + '.</p>';
      return;
    }
    var r = null;
    if (selectedId !== null) {
      for (var i = 0; i < s.residents.length; i++) if (s.residents[i].id === selectedId) { r = s.residents[i]; break; }
    }
    if (!r) {
      holder.innerHTML = '<h3>' + s.place + '</h3><p class="species">' + s.year + ' years · ' + s.population.toLocaleString() + ' people</p>' +
        '<p>Click a pixel person in the scene or pick a name to see what they are doing. The highlighted tile is the largest settlement in this frame.</p>';
      return;
    }
    var known = r.known.length ? r.known.join(' · ') : 'no formal knowledge';
    holder.innerHTML = '<h3>' + r.name + '</h3><p class="species">' + r.speciesName + ' · ' + r.actionLabel + '</p>' +
      '<p>Age ' + r.ageYears.toFixed(0) + ' years · ' + (r.techs) + ' technologies · ' + r.offspring + ' offspring</p>' +
      '<div class="bars">' + bar('health', r.health, '#7ef0c0') + bar('energy', r.energy, '#ffd166') + '</div>' +
      '<p>Knows: ' + known + '</p>';
  }
  function jump(year) { setIndex(nearestIndexForYear(year)); }
  function renderMarkers() {
    var holder = document.getElementById('markers');
    holder.innerHTML = '';
    var maxIndex = Math.max(1, FRAMES.length - 1);
    var groups = [
      { list: C.technologies, color: '#7ef0c0' },
      { list: C.theories, color: '#c3a6ff' },
      { list: C.wars, color: '#ff6b6b' },
      { list: C.accidents, color: '#f48fb1' },
      { list: DEEP.events, color: '#ff9f43' }
    ];
    groups.forEach(function (group) {
      group.list.slice(0, 80).forEach(function (e) {
        var m = document.createElement('button');
        m.className = 'marker';
        m.style.left = Math.max(0, Math.min(99.5, (nearestIndexForYear(e.year) / maxIndex) * 100)) + '%';
        m.style.background = group.color;
        m.title = 'Year ' + e.year + ' · ' + e.title;
        m.addEventListener('click', function () { jump(e.year); });
        holder.appendChild(m);
      });
    });
  }
  function renderLedger() {
    var tabs = [
      ['technologies', 'technologies'],
      ['theories', 'theories'],
      ['wars', 'wars'],
      ['accidents', 'plagues & accidents'],
      ['epochs', 'deep time']
    ];
    var tabHolder = document.getElementById('tabs');
    tabHolder.innerHTML = '';
    tabs.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tab' + (activeTab === t[0] ? ' active' : '');
      b.textContent = t[1] + ' (' + LEDGERS[t[0]].length + ')';
      b.addEventListener('click', function () { activeTab = t[0]; renderLedger(); });
      tabHolder.appendChild(b);
    });
    var holder = document.getElementById('ledger');
    holder.innerHTML = '';
    var entries = LEDGERS[activeTab] || [];
    if (!entries.length) {
      holder.innerHTML = '<p class="empty">Nothing recorded in this category for this run.</p>';
      return;
    }
    entries.slice(0, 120).forEach(function (e) {
      var b = document.createElement('button');
      b.className = 'entry';
      b.innerHTML = '<span class="year">y' + e.year + '</span><span>' + e.title +
        (e.detail ? '<span class="detail">' + e.detail + '</span>' : '') + '</span>';
      b.addEventListener('click', function () { jump(e.year); });
      holder.appendChild(b);
    });
  }
  function renderAll() { drawScene(); renderStats(); renderPeople(); renderDetail(); }
  function setIndex(i) {
    index = Math.max(0, Math.min(FRAMES.length - 1, i));
    if (selectedId !== null) {
      var found = false;
      for (var k = 0; k < FRAMES[index].residents.length; k++) if (FRAMES[index].residents[k].id === selectedId) found = true;
      if (!found) selectedId = null;
    }
    renderAll();
  }
  canvas.addEventListener('click', function (event) {
    var rect = canvas.getBoundingClientRect();
    var x = (event.clientX - rect.left) * (canvas.width / rect.width);
    var y = (event.clientY - rect.top) * (canvas.height / rect.height);
    for (var i = hitboxes.length - 1; i >= 0; i--) {
      var h = hitboxes[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        selectedId = h.id;
        renderAll();
        return;
      }
    }
    var px = x - canvas.width / 2;
    var py = y - 44;
    var fx = (px / (TILE_W / 2) + py / (TILE_H / 2)) / 2;
    var fy = (py / (TILE_H / 2) - px / (TILE_W / 2)) / 2;
    var tx = Math.floor(fx), ty = Math.floor(fy);
    var s = currentSnap();
    if (tx >= 0 && ty >= 0 && tx < s.region.width && ty < s.region.height) {
      var cellIndex = ty * s.region.width + tx;
      var cell = (s.region.originY + ty) * MAP_WIDTH + (s.region.originX + tx);
      var biome = s.region.biome[cellIndex];
      var pop = s.kind === 'deep' ? 0 : (s.region.population[cellIndex] || 0);
      document.getElementById('detail').innerHTML = '<h3>Tile ' + (s.region.originX + tx) + ',' + (s.region.originY + ty) + '</h3>' +
        '<p class="species">' + biome + ' · ' + pop + ' people here · cell ' + cell + '</p>' +
        (s.kind === 'deep'
          ? '<p>This is the same region projected into deep time. The surface is ' + s.temperatureC.toFixed(0) + ' °C.</p>'
          : '<p>Huts show where people live; the gold flag marks the frame\\'s largest settlement. Click a person to inspect them.</p>');
    }
  });
  document.getElementById('time').addEventListener('input', function (e) { setIndex(Number(e.target.value)); });
  document.getElementById('play').addEventListener('click', function () {
    var button = this;
    if (timer) {
      clearInterval(timer); timer = null; button.textContent = '▶ play'; button.classList.add('ghost');
      return;
    }
    button.textContent = '❚❚ pause'; button.classList.remove('ghost');
    timer = setInterval(function () {
      if (index >= FRAMES.length - 1) {
        clearInterval(timer); timer = null;
        button.textContent = '▶ play'; button.classList.add('ghost');
        return;
      }
      setIndex(index + 1);
    }, 650);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') setIndex(index + 1);
    if (e.key === 'ArrowLeft') setIndex(index - 1);
  });
  document.getElementById('time').max = String(FRAMES.length - 1);
  renderMarkers();
  renderLedger();
  setIndex(0);
})();
</script>
</body>
</html>`;
};
