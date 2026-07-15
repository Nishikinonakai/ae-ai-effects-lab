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
  'vel spread': 'velocity distribution',            // ASSUMED — validate via loop
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
};
// params whose Designer value is a 0-based enum while AE popups are 1-based
const ENUM_OFFSET = new Set(['p type', 'emitter type', 'emitter dir', 'p t mode']);

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

for (const file of walk(PACKS)) {
  if (!/Presets\/Particular/.test(file)) continue;
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

  const params = [], curves = {}, unmapped = {};
  for (const [k, v] of Object.entries(flat)) {
    if (k.startsWith('rg.custom.')) { curves[k] = v; continue; }
    if (k.startsWith('rg.')) continue;              // sprite/footage refs
    const m = mapParam(k, v);
    if (m?.skip) continue;
    if (m) params.push([m.matchName, m.value, `${k} (${m.via})`]);
    else { unmapped[k] = v; unmappedFreq.set(k, (unmappedFreq.get(k) || 0) + 1); }
  }

  // thumbnail
  let thumb = null;
  if (d.preview?.b64data) {
    thumb = path.join(THUMBS, pack, category, base + '.png');
    fs.mkdirSync(path.dirname(thumb), { recursive: true });
    fs.writeFileSync(thumb, Buffer.from(d.preview.b64data, 'base64'));
  }

  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const draft = {
    _mined_from: file,
    _pack: pack, _category: category,
    _map_coverage: `${params.length} mapped / ${Object.keys(unmapped).length} unmapped / ${Object.keys(curves).length} curves`,
    _unmapped: unmapped,
    _curves: curves,
    intent: `vendor preset "${d.name || base}" (${category}) — validate against its thumbnail`,
    name: slug,
    compName: 'Mined_' + base.replace(/[^a-zA-Z0-9]+/g, ''),
    comp: { width: 1280, height: 720, fps: 30, duration: 6 },
    background: [0, 0, 0],
    hostName: 'Mined',
    effects: [{ matchName: 'tc Particular', params, expressions: [] }],
    camera: null,
    renderFrames: [1, 4],
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
