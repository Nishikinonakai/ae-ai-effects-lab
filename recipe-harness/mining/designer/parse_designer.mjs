// parse_designer.mjs — mine ALL Trapcode Designer presets (plain JSON .xbxc / .xbxs)
// under the installed Trapcode Packs as recipe RAW MATERIAL.
//
// Scope: /Users/Shared/Red Giant/Trapcode Packs/*/Presets/**  (625 files: 548 Particular +
//   77 Form; .xbxc = single-system "customs", .xbxs = multi-system "full scenes").
// Read-only against /Users/Shared. Writes only under this directory.
//
// Two container shapes (both plain JSON, verified 625/625 parse):
//   .xbxc : { version,name,identifier,helpText,preview, groups[] }
//           params live at  groups[].blocks[].groups{}.params{}   (one system)
//   .xbxs : { ..., customOptions, effectChains[<=16], settingsBlock }
//           each chain is a Particular/Form system; chain[0] is the authored PRIMARY,
//           the rest are default "Effect Chain Template" slots. Effect id lives on the
//           chain identifier (com.redgiant.tc.par.* = Particular, tc.form.* = Form).
//
// Over-life CURVE encoding (the point of this mine — see REPORT.md):
//   * color curves  — FXid_PColorOverLifeArb / FXid_SE_PColorOverLifeArb / FXid_ColorMapArb
//     and rg.custom.col.life[.aux] : control points PosP[] (life position) + PosR/PosG/PosB[].
//   * scalar curves — rg.custom.op.life (opacity), .size.life (size), .xfer.life (blend)
//     [+ .aux twins] : control points curveX[]/curveY[] + a baked 200-pt `samples` LUT
//     + isCurveMode flag. Fully readable → extractable for master authoring / planner priors.
//   All curve blobs are preserved VERBATIM under the extracted file's "curves" key. They are
//   NOT script-settable into AE (CUSTOM_VALUE); the master-clone route owns application.
//
// Outputs:
//   index.json                         one metadata row per preset
//   extracted/<pack>/<slug>.json       normalized {FXid -> value} param dump + curves + refs
//
// usage: node mining/designer/parse_designer.mjs [--packs="…"] [--limit=N]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const flag = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] || d;
const PACKS = flag('packs', '/Users/Shared/Red Giant/Trapcode Packs');
const LIMIT = Number(flag('limit', 0)) || Infinity;

const OUT = __dirname;
const EXTRACTED = path.join(OUT, 'extracted');
fs.mkdirSync(EXTRACTED, { recursive: true });

// ---- enum label maps (Designer 0-based; labels best-effort, raw int is authoritative) ----
const EMITTER_LABEL = { 0: 'Point', 1: 'Box', 2: 'Sphere', 3: 'Grid', 4: 'Light(s)',
  5: 'Layer', 6: 'Layer Grid', 7: 'Text/Mask', 8: 'OBJ Model', 9: 'OBJ Model' };
const PTYPE_LABEL = { 0: 'Sphere', 1: 'Glow Sphere', 2: 'Star', 3: 'Cloudlet', 4: 'Streaklet',
  5: 'Sprite', 6: 'Sprite Colorize', 7: 'Sprite Fill', 8: 'Textured Polygon', 9: 'Text/Mask',
  10: 'Sprite (var)', 11: 'Streaklet (var)' };
const FORM_BASESHAPE_LABEL = { 0: 'Box Grid', 1: 'Sphere', 2: 'Object', 3: 'Layered' };

// ---- archetype guess from name + category + a couple of param hints ----
const ARCH_RULES = [
  ['fire',  /\b(fire|flame|ember|blaze|ignit|burn|torch|lava|magma|inferno|pyro|candle|campfire|combust)\b/i],
  ['smoke', /\b(smoke|smok|fume|plume|haze|mist|steam|vapor|smolder|cloud|fog|dust|debris|ash|sand)\b/i],
  ['snow',  /\b(snow|blizzard|frost|flurr|ice|icy|winter|flake|glacier)\b/i],
  ['rain',  /\b(rain|drizzle|downpour|droplet|storm|shower|water\s*drop|monsoon)\b/i],
  ['space', /\b(space|star|stars|starfield|galax|nebula|cosmic|cosmos|planet|portal|warp|astro|solar|comet|meteor|orbit|celestial|aurora|northern\s*lights)\b/i],
  ['magic', /\b(magic|magical|sparkle|glitter|fairy|pixie|enchant|wand|spell|glow|glowing|shimmer|mystic|arcane|wizard|firefl|bokeh|twinkle)\b/i],
  ['text',  /\b(text|type|title|typograph|letter|word|caption|logo|headline)\b/i],
];
const CATEGORY_ARCH = {
  'smoke and fire': 'fire', 'explosive': 'fire', 'fireworks': 'magic',
  'nature': 'other', 'dust and debris': 'smoke', 'light and magic': 'magic',
  'text': 'text', 'abstract and geometric': 'abstract', 'motion graphics': 'abstract',
  'backgrounds': 'abstract', 'basics': 'abstract', 'fluid': 'abstract',
  'bokeh': 'magic', 'fractals': 'abstract', 'geometry': 'abstract', 'lines': 'abstract',
  'shape grids': 'abstract', 'spin dots': 'abstract', 'landscape': 'space',
  'kaleidospace': 'space', 'flocking': 'abstract', 'bounce': 'abstract',
  'spline primitives': 'abstract', 'form behaviors': 'abstract', 'example scenes': 'abstract',
};
function archetype(name, category, effect) {
  const hay = `${name} ${category}`;
  for (const [arch, re] of ARCH_RULES) if (re.test(hay)) return arch;
  const c = (category || '').toLowerCase();
  if (CATEGORY_ARCH[c]) return CATEGORY_ARCH[c];
  return 'other';
}

// ---- curve helpers ----
const isColorCurve = v => v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.PosP);
const isScalarCurve = v => v && typeof v === 'object' && !Array.isArray(v) &&
  (Array.isArray(v.curveX) || Array.isArray(v.curveY) || Array.isArray(v.samples));
const isCurveBlob = v => isColorCurve(v) || isScalarCurve(v);
const isCurveKey = k => /^rg\.custom\./.test(k) || /OverLifeArb$|MapArb$/.test(k);

// "active" = the curve actually varies (real ramp/gradient), not a serialized default no-op.
function curveIsActive(v) {
  const varies = arr => Array.isArray(arr) && arr.length > 1 &&
    (Math.max(...arr) - Math.min(...arr)) > 0.01;
  if (isColorCurve(v)) return varies(v.PosR) || varies(v.PosG) || varies(v.PosB);
  if (isScalarCurve(v)) return v.isCurveMode === true || varies(v.curveY) || varies(v.samples);
  return false;
}

// ---- flatten a groups[] array (xbxc top-level, or one xbxs effect chain) into buckets ----
// recurse through BOTH objects and arrays (params live under blocks[] arrays), collecting
// every `params` bag encountered.
function collectBags(node, bags) {
  if (Array.isArray(node)) { for (const v of node) collectBags(v, bags); return; }
  if (!node || typeof node !== 'object') return;
  if (node.params && typeof node.params === 'object' && !Array.isArray(node.params)) bags.push(node.params);
  for (const v of Object.values(node)) collectBags(v, bags);
}
function flattenSystem(groupsArr) {
  const params = {}, curves = {}, refs = {};
  const bags = [];
  collectBags(groupsArr || [], bags);
  for (const bag of bags) {
    for (const [k, v] of Object.entries(bag)) {
      if (isCurveKey(k) || isCurveBlob(v)) { curves[k] = v; continue; }
      if (k.startsWith('rg.')) { refs[k] = v; continue; }   // sprite/footage/system refs
      params[k] = v;                                          // FXid_* scalars/vectors/colors
    }
  }
  return { params, curves, refs };
}

// pick the authored primary chain of an .xbxs scene, and count POPULATED systems.
// A chain is a real system only if it configured an emitter/particle (the other <=15
// slots are default template stubs — often renamed "Untitled" — with no such params).
const SYS_MARKERS = ['FXid_Gen1EmitterType', 'FXid_EmitterType', 'FXid_PType', 'FXid_ParticlesPerSecF', 'FXid_BaseShape'];
function chainIsPopulated(chain) {
  const bags = [];
  collectBags(chain.groups || [], bags);
  return bags.some(b => SYS_MARKERS.some(m => m in b));
}
function primaryChain(d) {
  const chains = d.effectChains || [];
  const populated = chains.filter(chainIsPopulated);
  const primary = populated[0] || chains[0] || null;
  return { primary, sceneChains: chains.length, systems: populated.length || (chains.length ? 1 : 0) };
}

function effectFromIdentifier(id) {
  if (!id) return null;
  if (/tc\.par\b|tc\.par\./.test(id)) return 'Particular';
  if (/tc\.form\b|tc\.form\./.test(id)) return 'Form';
  if (/tc\.mir\b/.test(id)) return 'Mir';
  if (/tc\.tao\b/.test(id)) return 'Tao';
  return null;
}

// ---- walk ----
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const files = [...walk(PACKS)].filter(f => /\/Presets\/.*\.(xbxc|xbxs)$/.test(f)).sort();

// de-collide slugs within a pack (13 basenames repeat across categories in TC14)
const slugCount = {};
for (const f of files) {
  const pack = path.relative(PACKS, f).split(path.sep)[0];
  const slug = path.basename(f).replace(/\.(xbxc|xbxs)$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const key = pack + '/' + slug;
  slugCount[key] = (slugCount[key] || 0) + 1;
}

const index = [];
const stats = {
  total: files.length, parsed: 0, failed: 0, failedFiles: [],
  byExt: {}, byEffect: {}, byArchetype: {}, withCurves: 0, withThumb: 0,
};
let n = 0;

for (const file of files) {
  if (n >= LIMIT) break;
  const ext = file.endsWith('.xbxc') ? 'xbxc' : 'xbxs';
  const rel = path.relative(PACKS, file);
  const pack = rel.split(path.sep)[0];
  // category = the folder directly under Presets/<Effect>/
  const parts = rel.split(path.sep);
  const pi = parts.indexOf('Presets');
  const pathEffect = parts[pi + 1] || null;                // 'Particular' | 'Form'
  const category = parts.slice(pi + 2, -1).join('/') || '(root)';
  const base = path.basename(file).replace(/\.(xbxc|xbxs)$/, '');

  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { stats.failed++; stats.failedFiles.push({ file: rel, error: e.message }); continue; }
  stats.parsed++;
  stats.byExt[ext] = (stats.byExt[ext] || 0) + 1;
  if (d.preview?.b64data) stats.withThumb++;

  // extract the primary system's params/curves/refs
  let sys, sceneChains = null, systems = 1, effIdent = null;
  if (ext === 'xbxs') {
    const pc = primaryChain(d);
    sceneChains = pc.sceneChains; systems = pc.systems;
    effIdent = effectFromIdentifier(pc.primary?.identifier) || effectFromIdentifier(d.identifier);
    sys = pc.primary ? flattenSystem(pc.primary.groups) : { params: {}, curves: {}, refs: {} };
  } else {
    sys = flattenSystem(d.groups);
    // xbxc has no per-effect identifier; infer from FXid namespace as a cross-check
    effIdent = ('FXid_BaseShape' in sys.params) ? 'Form'
      : ('FXid_PType' in sys.params || 'FXid_EmitterBehaviour' in sys.params) ? 'Particular' : null;
  }
  const effect = pathEffect || effIdent || 'other';
  const p = sys.params;

  // emitter / particle types
  let emitterRaw = null, emitterLabel = null, particleRaw = null, particleLabel = null;
  if (effect === 'Form') {
    emitterRaw = p.FXid_BaseShape ?? null;
    emitterLabel = emitterRaw != null ? (FORM_BASESHAPE_LABEL[emitterRaw] || `baseShape:${emitterRaw}`) : null;
  } else {
    emitterRaw = p.FXid_Gen1EmitterType ?? p.FXid_EmitterType ?? null;
    emitterLabel = emitterRaw != null ? (EMITTER_LABEL[emitterRaw] || `emitter:${emitterRaw}`) : null;
  }
  if (p.FXid_PType != null) { particleRaw = p.FXid_PType; particleLabel = PTYPE_LABEL[particleRaw] || `ptype:${particleRaw}`; }

  // curve accounting: presence vs. actually-authored (active) curves
  const curveEntries = Object.entries(sys.curves);
  const activeCurves = curveEntries.filter(([, v]) => curveIsActive(v));
  const hasCurveData = activeCurves.length > 0;
  const curveKinds = {};
  for (const [k, v] of activeCurves) {
    const kind = /col|Color/.test(k) ? 'color' : /op\.life|Opac/.test(k) ? 'opacity'
      : /size\.life|Size/.test(k) ? 'size' : /xfer/.test(k) ? 'transfer' : 'other';
    curveKinds[kind] = (curveKinds[kind] || 0) + 1;
  }
  if (hasCurveData) stats.withCurves++;

  const arch = archetype(base, category, effect);
  stats.byEffect[effect] = (stats.byEffect[effect] || 0) + 1;
  stats.byArchetype[arch] = (stats.byArchetype[arch] || 0) + 1;

  // de-collided slug + write path (extracted/<pack>/<slug>.json)
  let slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (slugCount[pack + '/' + slug] > 1) {
    slug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + slug;
  }
  const extractedRel = path.join('extracted', pack, slug + '.json');
  const extractedAbs = path.join(OUT, extractedRel);

  const extracted = {
    _mined_from: file,
    _pack: pack,
    _category: category,
    _effect: effect,
    _ext: ext,
    _container: ext === 'xbxs' ? { sceneChains, populatedSystems: systems } : 'single-system',
    name: base,
    displayName: d.name || base,
    identifier: d.identifier || null,
    emitter: emitterRaw != null ? { raw: emitterRaw, label: emitterLabel } : null,
    particle: particleRaw != null ? { raw: particleRaw, label: particleLabel } : null,
    archetype: arch,
    paramCount: Object.keys(p).length,
    activeCurveKinds: curveKinds,
    params: p,        // normalized FXid -> value (color/vector values verbatim)
    refs: sys.refs,   // sprite / footage / system references (rg.* non-curve)
    curves: sys.curves, // verbatim over-life curve/gradient blobs (color + scalar)
  };
  fs.mkdirSync(path.dirname(extractedAbs), { recursive: true });
  fs.writeFileSync(extractedAbs, JSON.stringify(extracted, null, 2));

  index.push({
    file, pack, category, name: base, displayName: d.name || base, ext, effect,
    emitterType: emitterLabel, emitterRaw,
    particleType: particleLabel, particleRaw,
    paramCount: Object.keys(p).length,
    hasCurveData,
    curveKinds: Object.keys(curveKinds),
    archetype: arch,
    hasThumb: !!d.preview?.b64data,
    sceneChains, populatedSystems: ext === 'xbxs' ? systems : 1,
    extracted: extractedRel,
  });
  n++;
}

index.sort((a, b) => (a.pack + a.effect + a.name).localeCompare(b.pack + b.effect + b.name));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  _generated_from: PACKS,
  _generated_at: new Date().toISOString(),
  _stats: {
    total: stats.total, parsed: stats.parsed, failed: stats.failed,
    byExt: stats.byExt, byEffect: stats.byEffect, byArchetype: stats.byArchetype,
    withActiveCurves: stats.withCurves, withThumbnail: stats.withThumb,
  },
  _failed_files: stats.failedFiles,
  presets: index,
}, null, 2));

// ---- console summary ----
console.log(`parsed ${stats.parsed}/${stats.total} presets (failed ${stats.failed})`);
console.log('by ext    :', JSON.stringify(stats.byExt));
console.log('by effect :', JSON.stringify(stats.byEffect));
console.log('by arch   :', JSON.stringify(stats.byArchetype));
console.log(`with active over-life curves: ${stats.withCurves}   with thumbnail: ${stats.withThumb}`);
if (stats.failedFiles.length) {
  console.log('FAILED:');
  stats.failedFiles.forEach(f => console.log('  ' + f.file + ' — ' + f.error));
}
console.log(`\nindex : ${path.join(OUT, 'index.json')}`);
console.log(`extracted dumps under: ${EXTRACTED}`);
