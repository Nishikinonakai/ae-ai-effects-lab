// mine_xbxc.mjs — mine Trapcode Designer presets (.xbxc, plain JSON) into recipe drafts.
//
// The vendor ships 186 Particular presets with the suite (Trapcode Packs). Each contains:
//   - scriptable param values under Designer-internal FXid_* keys (→ mappable to matchNames)
//   - the over-life CURVES as readable data (rg.custom.*.life: sample arrays / gradient stops)
//   - an official preview render (base64 PNG) — a ready-made visual retrieval catalog
//
// This miner: walks the packs → maps FXid→matchName (normalize + alias table + fuzzy) →
// emits per-preset recipe DRAFTS in our schema + a catalog.json + extracted thumbnails.
// Drafts are RAW MATERIAL: enum offsets are assumed (+1 Designer→AE), nothing is validated —
// the tune loop is the validator. Curves are preserved verbatim in _curves (not settable by
// script; master-clone route owns application; the data enables planner semantics + future work).
//
// Licensing note: vendor content, installed with the user's license — fine as internal/local
// research material; do NOT ship derived recipes without clearance (see strategy memory).
//
// usage: node mining/mine_xbxc.mjs [--packs="/Users/Shared/Red Giant/Trapcode Packs"] [--limit=N]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const TSV = path.resolve(REPO, '..', 'gap-test', 'particular_params_fixed.tsv');

const flag = (name, dflt) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;
const PACKS = flag('packs', '/Users/Shared/Red Giant/Trapcode Packs');
const LIMIT = Number(flag('limit', 0)) || Infinity;

const OUT = path.join(__dirname);
const DRAFTS = path.join(OUT, 'drafts');
const THUMBS = path.join(OUT, 'thumbs');
fs.mkdirSync(DRAFTS, { recursive: true });
fs.mkdirSync(THUMBS, { recursive: true });

// ---- 1) main-system display-name → matchName from the param dump (first occurrence wins:
// the dump lists the main system before aux/systems 2..8, and display names collide) ----
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nameToMatch = new Map();
for (const line of fs.readFileSync(TSV, 'utf8').split('\n').slice(1)) {
  const [, name, matchName, type] = line.split('\t');
  if (!name || !matchName) continue;
  if (type === '6412') continue;                    // group headers, not settable
  const n = norm(name);
  if (n && !nameToMatch.has(n)) nameToMatch.set(n, matchName);
}

// ---- 2) FXid normalization + curated alias table (Designer id → dump display name) ----
// Aliases marked here were read off Designer/AE UI correspondence; enum VALUE offsets are
// handled separately below. Unmapped FXids are reported, not guessed.
const ALIAS = {
  'particles per sec f': 'particles sec',
  'emitter behaviour': null,                        // designer-only concept
  'p life': 'life seconds', 'p life rnd': 'life random',
  'emitter size x': 'emitter size xyz',             // 0014 doubles as uniform size
  'p size max': 'size', 'p size rnd': '@tc Particular-0074',  // 0775 is the emitter-group dupe
  'p opac max': 'opacity', 'p opac rnd': 'opacity random',
  'p color': 'color', 'p color rnd': 'color random',
  'p feather': 'sphere feather',
  'p aspect ratio': 'aspect ratio',
  'p rot x': 'rotation x', 'p rot y': 'rotation y', 'p rot z': 'rotation z',
  'vel': 'velocity', 'vel rnd': 'velocity random',
  'vel spread': '@tc Particular-0012',              // Velocity Random [%] — vendor values are 0-100, and VelRnd never appears in packs
  'vel emit': 'velocity from emitter mot',          // truncated dump name, prefix-matched below
  'grid emitter particles in x': 'particles in x',
  'grid emitter particles in y': 'particles in y',
  'grid emitter particles in z': 'particles in z',
  'p set color': 'set color',
  'p unmult': 'unmult',
  'subframe pos': 'position subframe',
  'dir spread': 'direction spread',
  'emitter dir': 'direction',
  'angle x': 'x rotation', 'angle y': 'y rotation', 'angle z': 'z rotation',
  'f affect pos': 'affect position', 'f affect size': 'affect size',
  'f scale': 'scale', 'f complexity': 'complexity',
  'f evolution': 'evolution speed',                 // ASSUMED
  'air resist': 'air resistance',
  'spin amp': 'spin amplitude', 'spin freq': 'spin frequency',
  'grav': 'gravity',
  'p type': '@tc Particular-0703',                  // 0026 is a hidden legacy dupe
  'emitter type': 'emitter type',
  // aux system (Designer SE_* / Options_Aux_*) -> the TSV aux group
  'se emitter': null,                               // aux Emit enum unverified (+1 guess FLOODED snow presets round 2) — probe 0148 before enabling
  'se particles per sec f': '@tc Particular-0149',
  'se p vel': '@tc Particular-0152',
  'se p life': '@tc Particular-0150',
  'se p size': '@tc Particular-0154',
  'se p opacity': '@tc Particular-0160',
  'se p type': '@tc Particular-0151',
  'se p color from main': null,                     // no matchName found in the dump
  'aux control inherit velocity': '@tc Particular-0194',
  'aux gravity': '@tc Particular-0189',
  'aux air physics turbulence': '@tc Particular-0201',
  'aux transfer mode': '@tc Particular-0190',
  'aux randomness life': '@tc Particular-0204',
  'aux randomness size': '@tc Particular-0205',
  'aux randomness opacity': '@tc Particular-0206',
};
// params whose Designer value is a 0-based enum while AE popups are 1-based
const ENUM_OFFSET = new Set(['p type', 'emitter type', 'emitter dir', 'pt mode', 'p set color',
  'se emitter', 'se p type', 'aux transfer mode']);

// AE 0703 Particle Type — PROBED 2026-07-16: 1=Sphere 2=GlowSphere 3=Star 4=Cloudlet
// 5=Streaklet 6=Square, values >6 REJECTED. Designer 0-4 = same list (+1 correct);
// Designer >=5 are sprite/textured types AE 0703 doesn't carry — blind +1 landed Sprite
// on SQUARE (the white-square failure class). Fallback: smoke/fire-ish -> Cloudlet, else GlowSphere.
const SMOKEISH = /smoke|fire|cloud|fume|plume|haze|smolder|burn|ember|flame/i;

function stripFxid(key) {
  return norm(key.replace(/^FXid_/, '').replace(/^Options_/, '').replace(/^Settings_/, '')
    .replace(/^Gen1/, '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')      // PLife -> P Life, PTMode -> PT Mode
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2'));       // SizeMax -> Size Max
}

function mapParam(fxid, value) {
  const stripped = stripFxid(fxid);
  let target = null, via = 'exact', enumAdj = false;
  if (ALIAS[stripped] !== undefined) {
    if (ALIAS[stripped] === null) return { skip: true };
    target = ALIAS[stripped].startsWith('@')
      ? ALIAS[stripped].slice(1)                    // direct matchName (collision overrides)
      : nameToMatch.get(ALIAS[stripped]) || null;
    via = 'alias';
    enumAdj = ENUM_OFFSET.has(stripped);
  } else if (nameToMatch.has(stripped)) {
    target = nameToMatch.get(stripped);
  } else {
    // fuzzy: all tokens of the fxid appear in exactly one dump name
    const toks = stripped.split(' ').filter(Boolean);
    const hits = [...nameToMatch.keys()].filter(n => toks.every(t => n.includes(t)));
    if (hits.length === 1) { target = nameToMatch.get(hits[0]); via = 'fuzzy:' + hits[0]; }
  }
  if (!target) return null;

  // value transforms
  let v = value;
  if (v && typeof v === 'object' && 'r' in v) v = [v.r / 255, v.g / 255, v.b / 255, 1];
  else if (typeof v === 'boolean') v = v ? 1 : 0;
  else if (enumAdj && typeof v === 'number') { v = v + 1; via += '+enumOffset'; }
  if (v && typeof v === 'object' && !Array.isArray(v)) return null;   // footage refs etc.
  return { matchName: target, value: v, via };
}

// ---- 3) walk the packs ----
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const catalog = { generated_from: PACKS, presets: [], scenes: [] };
const unmappedFreq = new Map();
let mined = 0;

// slug collisions (same preset name in two categories) overwrote drafts in round 1 —
// prefix the category when a basename occurs more than once
const files = [...walk(PACKS)].filter(f => /Presets\/Particular/.test(f));
const baseCount = new Map();
for (const f of files.filter(f => f.endsWith('.xbxc'))) {
  const b = path.basename(f, '.xbxc');
  baseCount.set(b, (baseCount.get(b) || 0) + 1);
}

for (const file of files) {
  const rel = path.relative(PACKS, file);
  const pack = rel.split(path.sep)[0];
  const category = path.basename(path.dirname(file));
  const base = path.basename(file).replace(/\.(xbxc|xbxs)$/, '');

  if (file.endsWith('.xbxs')) {                     // full scenes: catalog only (for now)
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      catalog.scenes.push({ name: d.name || base, pack, category, file, chains: (d.effectChains || []).length });
    } catch { /* skip unreadable */ }
    continue;
  }
  if (!file.endsWith('.xbxc') || mined >= LIMIT) continue;

  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }

  // flatten all block params
  const flat = {};
  for (const g of d.groups || [])
    for (const b of g.blocks || [])
      for (const gg of Object.values(b.groups || {}))
        Object.assign(flat, gg.params || {});

  const params = [], curves = {}, unmapped = {}, expressionsOut = [];
  for (const [k, v] of Object.entries(flat)) {
    if (k.startsWith('rg.custom.')) { curves[k] = v; continue; }
    if (k.startsWith('rg.')) continue;              // sprite/footage refs
    const m = mapParam(k, v);
    if (m?.skip) continue;
    if (m) params.push([m.matchName, m.value, `${k} (${m.via})`]);
    else { unmapped[k] = v; unmappedFreq.set(k, (unmappedFreq.get(k) || 0) + 1); }
  }

  // PType fallback: Designer sprite/textured types (>=5, i.e. mapped value >=6) either land
  // on AE Square or get rejected — substitute a built-in soft type instead.
  const ptype = params.find(p => p[0] === 'tc Particular-0703');
  if (ptype && ptype[1] >= 6) {
    ptype[1] = SMOKEISH.test(category + ' ' + base) ? 4 : 2;
    ptype[2] += ` [sprite fallback -> ${ptype[1] === 4 ? 'Cloudlet' : 'Glow Sphere'}]`;
  }

  // gradient flatten: Set Color = Over Life / Random exposes the UNSCRIPTABLE color-over-life
  // gradient (AE default = blue) — flatten the vendor's mined gradient to its mean color,
  // write it as the flat particle color, and force Set Color back to At Birth.
  const setColor = params.find(p => p[0] === 'tc Particular-0088');
  const colLife = curves['rg.custom.col.life'];
  if (setColor && setColor[1] >= 2 && colLife?.PosP?.length > 1) {
    const P = colLife.PosP, span = P[P.length - 1] - P[0] || 1;
    const mean = ch => {
      let s = 0;
      for (let i = 0; i < P.length - 1; i++) s += ((ch[i] + ch[i + 1]) / 2) * (P[i + 1] - P[i]);
      return Math.max(0, Math.min(1, s / span));
    };
    const flat = [mean(colLife.PosR || []), mean(colLife.PosG || []), mean(colLife.PosB || []), 1];
    setColor[1] = 1;
    setColor[2] += ' [forced At Birth: gradient unscriptable]';
    const pcol = params.find(p => p[0] === 'tc Particular-0070');
    if (pcol) { pcol[1] = flat; pcol[2] += ' [flattened col.life gradient]'; }
    else params.push(['tc Particular-0070', flat, 'flattened col.life gradient']);
  }

  // burst translation: Designer EmitterBehaviour 1 = Explode (probed: 0=continuous 139×,
  // 1=explode on all 45 explosion-named presets). AE has no explode enum — emit the whole
  // burst in the first 0.1s via an expression spike, and sample earlier frames.
  let isBurst = false, burstFrames = null;
  if (flat.FXid_EmitterBehaviour === 1) {
    isBurst = true;
    const psec = params.find(p => p[0] === 'tc Particular-0146');
    const burstN = (psec ? psec[1] : 100) || 100;
    expressionsOut.push(['tc Particular-0146', `time < 0.1 ? ${Math.round(burstN * 10)} : 0`, 'Explode -> 0.1s burst spike']);
    // sample within the particles' lifetime (muzzle-flash-class lives ~0.2s — round-2's
    // fixed [0.5, 2] sampled corpses)
    const life = flat.FXid_PLife || 2;
    burstFrames = [Math.min(0.15, life * 0.5), Math.max(0.4, Math.min(2, life * 0.7))];
  }

  // physics guard: the engine ignores Wind AND Air Turbulence when Air Resistance == 0,
  // and AE pops a MODAL warning if you set them anyway — a bridge-stalling hazard. The
  // vendor's own preview was rendered with them inert (same engine), so the faithful
  // translation DROPS them rather than activating physics the vendor never saw.
  // (Verified on fire-motion: AirResist 0 render matches the thumb; clamping to 0.2 bends
  // the plume away from it.)
  const airResist = params.find(p => p[0] === 'tc Particular-0018');
  let droppedInert = [];
  if (airResist && airResist[1] === 0) {
    const INERT = new Set(['tc Particular-0749', 'tc Particular-0750', 'tc Particular-0751', 'tc Particular-0711']);
    droppedInert = params.filter(p => INERT.has(p[0]) && p[1] !== 0);
    for (const d of droppedInert) params.splice(params.indexOf(d), 1);
  }

  // thumbnail
  let thumb = null;
  if (d.preview?.b64data) {
    thumb = path.join(THUMBS, pack, category, base + '.png');
    fs.mkdirSync(path.dirname(thumb), { recursive: true });
    fs.writeFileSync(thumb, Buffer.from(d.preview.b64data, 'base64'));
  }

  let slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if ((baseCount.get(base) || 0) > 1) slug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + slug;
  const draft = {
    _mined_from: file,
    _pack: pack, _category: category,
    _map_coverage: `${params.length} mapped / ${Object.keys(unmapped).length} unmapped / ${Object.keys(curves).length} curves`,
    _dropped_inert: droppedInert.length ? droppedInert : undefined,
    _unmapped: unmapped,
    _curves: curves,
    intent: `vendor preset "${d.name || base}" (${category}) — validate against its thumbnail`,
    name: slug,
    compName: 'Mined_' + base.replace(/[^a-zA-Z0-9]+/g, ''),
    comp: { width: 1280, height: 720, fps: 30, duration: 6 },
    background: [0, 0, 0],
    hostName: 'Mined',
    effects: [{ matchName: 'tc Particular', params, expressions: expressionsOut }],
    camera: null,
    renderFrames: isBurst ? burstFrames : [1, 4],
  };
  const draftPath = path.join(DRAFTS, pack, slug + '.json');
  fs.mkdirSync(path.dirname(draftPath), { recursive: true });
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));

  catalog.presets.push({
    name: d.name || base, pack, category, file,
    draft: path.relative(OUT, draftPath),
    thumb: thumb ? path.relative(OUT, thumb) : null,
    mapped: params.length, unmapped: Object.keys(unmapped).length, curves: Object.keys(curves),
  });
  mined++;
}

fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 2));

// ---- stats ----
const cov = catalog.presets.map(p => p.mapped / Math.max(1, p.mapped + p.unmapped));
console.log(`mined ${catalog.presets.length} xbxc presets (+ ${catalog.scenes.length} xbxs scenes cataloged)`);
if (cov.length) {
  console.log(`mean param coverage: ${(100 * cov.reduce((a, b) => a + b, 0) / cov.length).toFixed(0)}%`);
  console.log(`with curves: ${catalog.presets.filter(p => p.curves.length).length}`);
}
console.log('\ntop unmapped FXids (alias-table candidates for next round):');
[...unmappedFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}× ${k}`));
console.log(`\ncatalog: ${path.join(OUT, 'catalog.json')}`);
