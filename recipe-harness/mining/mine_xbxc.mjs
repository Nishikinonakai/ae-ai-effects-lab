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
  'emitter size option': '@tc Particular-0577',     // size mode: 1 XYZ-linked / 2 individual — GATES 0015/0016 (round-1 wall, solved r6)
  'p size max': 'size', 'p size rnd': '@tc Particular-0074',  // 0775 is the emitter-group dupe
  'p opac max': 'opacity', 'p opac rnd': 'opacity random',
  'p color': 'color', 'p color rnd': 'color random',
  'p feather': 'sphere feather',
  'p aspect ratio': 'aspect ratio',
  // particle rotation (round-6: was 'p rot *' — Designer actually emits PRotate*, so these
  // NEVER matched and 127 presets lost their tumble; ids read off the Rotation group rows)
  'p rotate': '@tc Particular-0136',                // Rotate Z (the 2D one)
  'p rotate x': '@tc Particular-0275', 'p rotate y': '@tc Particular-0276',
  'p rotate rnd': '@tc Particular-0137',            // Random Rotation
  'p rotate speed': '@tc Particular-0138',          // Rotation Speed Z
  'p rotate speed x': '@tc Particular-0277', 'p rotate speed y': '@tc Particular-0278',
  'p rotate rnd speed': '@tc Particular-0279',      // Random Speed Rotate
  'p rotate rnd speed distr': '@tc Particular-0282',
  'p rot auto': '@tc Particular-0726',              // Orient to Motion
  'vel': 'velocity', 'vel rnd': 'velocity random',
  'vel spread': '@tc Particular-0012',              // Velocity Random [%] — vendor values are 0-100, and VelRnd never appears in packs
  'vel spread distr': '@tc Particular-0283',        // Velocity Distribution (default 0.5=0.5)
  'streaklet no spheres': '@tc Particular-0314',    // Number of Streaks (7=7)
  'streaklet spread': '@tc Particular-0315',        // Streak Size (60=60)
  'vel emit': 'velocity from emitter mot',          // truncated dump name, prefix-matched below
  'grid emitter particles in x': 'particles in x',
  'grid emitter particles in y': 'particles in y',
  'grid emitter particles in z': 'particles in z',
  'p set color': 'set color',
  // Unmult twins (probed 2026-07-17 on live instance): 0531 "Unmult" reads 1 but is
  // WRITE-LOCKED and inert — the LIVE toggle is 0694 (default 0/off). With 0694=0 luma
  // sprites composite as OPAQUE cards: invisible over the black bg, hard black occlusion
  // rectangles wherever particles overlap (the whole r6 "sprite-alpha" class).
  'p unmult': '@tc Particular-0694',
  'dir spread': 'direction spread',
  'emitter dir': 'direction',
  'angle x': 'x rotation', 'angle y': 'y rotation', 'angle z': 'z rotation',
  // turbulence field (round-6): Designer F* is the TURBULENCE FIELD group — the old
  // aliases hit the Air-Turbulence twins (0711 Affect Position is even in the inert-drop
  // set, so fire/smoke presets silently lost their turbulence). Default-value pairs pin
  // them: FAffectTime 0.5 = TF Fade-in Time 0045 (0.5), FScale 10 = TF Scale 0046 (10).
  'f affect pos': '@tc Particular-0042',            // TF Displace XYZ (v18 name for position displacement)
  'f affect size': '@tc Particular-0041',           // TF Affect Size
  'f affect time': '@tc Particular-0045',           // TF Fade-in Time (seconds)
  'f scale': '@tc Particular-0046', 'f complexity': '@tc Particular-0047',
  'f evolution': '@tc Particular-0052',             // TF Evolution Speed
  'air resist': 'air resistance',
  'spin amp': 'spin amplitude', 'spin freq': 'spin frequency',
  'spin time': '@tc Particular-0021',               // Fade-in Spin (seconds) — Designer default 1 = TSV default 1
  'grav': 'gravity',
  // shading / shadowlets (round-6; values inert unless the vendor also authored the enables)
  'p shade': '@tc Particular-0284',                 // Shading on/off
  'p shade falloff adjust': '@tc Particular-0304',  // Nominal Distance — Designer default 250 = TSV default 250
  'smokelet shadow color': '@tc Particular-0210',
  'smokelet shadow color strength': '@tc Particular-0211',
  'smokelet shadow opacity': '@tc Particular-0212',
  'glow transfer mode': '@tc Particular-0218',      // Glow Blend Mode
  'subframe pos': null,                             // no Position-Subframe param in v18 (removed)
  'p layer time': null,                             // consumed by the sprite connect (0067)
  'p type': '@tc Particular-0703',                  // 0026 is a hidden legacy dupe
  'emitter type': 'emitter type',
  // aux system (Designer SE_* / Options_Aux_*): consumed by the S2 translation block in the
  // preset loop — the legacy 01xx aux params rounds 2-3 aliased to are DORMANT in v2023
  // (multi-systems replaced the Aux UI; setting them has no visual effect). Null here keeps
  // them out of _unmapped; AUX_S2 below is the live route.
  'se emitter': null, 'se p color from main': null, 'se p shadow': null,
  'se p color over life arb': null,                 // flattened into Color S2 by the aux block
  'p color over life arb': null,                    // flattened into Color (0070) by the gradient block
  'se particles per sec f': null, 'se p vel': null, 'se p life': null,
  'se p size': null, 'se p opacity': null, 'se p type': null,
  'aux control inherit velocity': null, 'aux gravity': null,
  'aux air physics turbulence': null, 'aux air physics resistance': null,
  'aux air physics wind': null, 'aux transfer mode': null,
  'aux randomness life': null, 'aux randomness size': null, 'aux randomness opacity': null,
  'aux emit probability': null, 'aux feather': null,
  'aux control start emit': null, 'aux control stop emit': null,   // Emission-over-Parent-Life is 6419 (unscriptable)
  // fluid physics (Designer FXid_Fluid*): the live switch is 0638 Enable Fluid Motion
  // (PROBED 2026-07-17: settable; Physics Model 0119 is locked/derived — hidden-param class).
  // Designer/TSV default-value pairs pin the collision-prone ones: MotionType+1 -> 0615
  // Fluid Force (0+1=1=default), ForceOption+1 -> 0636 Apply Force (1+1=2=default),
  // VortexSize -> 0618 Force Region Size (500=500).
  'fluid motion type': '@tc Particular-0615',
  'fluid force option': '@tc Particular-0636',
  'fluid vortex strength': '@tc Particular-0616',
  'fluid vortex core size': '@tc Particular-0617',
  'fluid vortex size': '@tc Particular-0618',
  'fluid vortex tilt': '@tc Particular-0619',
  'fluid vortex rotate': '@tc Particular-0620',
  'fluid vortex rel pos': '@tc Particular-0635',
  'fluid physics time factor': '@tc Particular-0025',
  'fluid random swirl option': '@tc Particular-0654',
  'random swirl x': '@tc Particular-0630',          // Designer X = the XYZ/uniform slider
  'random swirl y': '@tc Particular-0631',
  'random swirl z': '@tc Particular-0632',
  'random swirl seed': '@tc Particular-0637',
  'swirl scale': '@tc Particular-0653',
  'fluid viscosity': '@tc Particular-0621',
  'fluid fidelity': '@tc Particular-0628',
  'fluid density': null,                            // no scriptable target found in the dump
  'fluid density blend mode': null,
  // 3D Model emitter options (main system; the MODEL itself rides a use-comp master —
  // model refs don't survive copyToComp, see runner). Designer OBJEmitFrom=1 → 0535
  // default 2 (+1 ✓ pinned).
  'obj emit from': '@tc Particular-0535',
  'obj normalize': '@tc Particular-0539',
  'obj sequence speed': '@tc Particular-0537',
  'obj sequence offset': '@tc Particular-0538',
  'obj invert z': '@tc Particular-0578',
  'obj layer': null,                                // consumed by the OBJ-master lookup below
};

// OBJ model → the user-authored use-comp master (2026-07-17: Choose Model is plugin-UI-only;
// the model ref survives project IMPORT but not layer copyToComp, hence mode:'use-comp')
const OBJ_MASTER = {
  'Tube_Short': 'MASTER_obj_tube',
  'Icosa': 'MASTER_obj_icosa',
  'Array_Octa': 'MASTER_obj_octa',
};
// params whose Designer value is a 0-based enum while AE popups are 1-based
const ENUM_OFFSET = new Set(['p type', 'emitter type', 'emitter dir', 'pt mode', 'p set color',
  'fluid motion type', 'fluid force option', 'fluid random swirl option', 'glow transfer mode',
  'emitter size option', 'obj emit from']);

// ---- aux → S2 translation (2026-07-17) ----
// Classic Aux became multi-system "Emit from Parent" in v2023. S2 params are script-settable
// ONLY on a layer cloned from MASTER_particular_S2 (system existence is plugin-private state;
// the master carries it — commit f1f05c0). Chain verified live: clone → 2830=8 → set 2xxx.
// SE_Emitter is 2 (Continuously) on every active preset in the packs; 0/absent = aux off.
// Param ids read off the flat dump; Size Random is 2122 (the 2823 name-twin is the STRINGS
// emitter block). Designer aux size/vel/life are absolute units like the main system.
const AUX_S2 = {   // stripped Designer key -> [matchName, 'enum'?]
  'se particles per sec f': ['tc Particular-2194'],
  'se p life':              ['tc Particular-2050'],
  'se p size':              ['tc Particular-2075'],
  'se p opacity':           ['tc Particular-2081'],
  'se p type':              ['tc Particular-2751', 'enum'],
  'se p vel':               ['tc Particular-2059'],
  'aux gravity':            ['tc Particular-2065'],
  'aux air physics turbulence': ['tc Particular-2759'],
  'aux air physics resistance': ['tc Particular-2066'],
  'aux air physics wind':   ['tc Particular-2797'],
  'aux transfer mode':      ['tc Particular-2117', 'enum'],
  'aux randomness life':    ['tc Particular-2113'],
  'aux randomness size':    ['tc Particular-2122'],
  'aux randomness opacity': ['tc Particular-2123'],
  'aux control inherit velocity': ['tc Particular-2242'],
  'aux emit probability':   ['tc Particular-2236'],
  'aux feather':            ['tc Particular-2077'],
};

// AE 0703 Particle Type — PROBED 2026-07-16: 1=Sphere 2=GlowSphere 3=Star 4=Cloudlet
// 5=Streaklet 6=Square, values >6 REJECTED. Designer 0-4 = same list (+1 correct);
// Designer >=5 are sprite/textured types AE 0703 doesn't carry — blind +1 landed Sprite
// on SQUARE (the white-square failure class). Fallback: smoke/fire-ish -> Cloudlet, else GlowSphere.
const SMOKEISH = /smoke|fire|cloud|fume|plume|haze|smolder|burn|ember|flame/i;

// dominant color per vendor thumbnail (built by a PIL pre-pass; keyed by xbxc path) —
// used to tint particles whose color-carrying texture is lost in the PType fallback
const THUMB_COLORS = fs.existsSync(path.join(__dirname, 'thumb_colors.json'))
  ? JSON.parse(fs.readFileSync(path.join(__dirname, 'thumb_colors.json'), 'utf8'))
  : {};

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

  // mode gates first: enum switches that REVEAL other params must be set before them
  // (hidden-param dependency: 0577 size mode gates Emitter Size Y/Z, 0782 emitter type
  // gates emitter geometry, 0703 particle type gates sprite controls). Stable sort keeps
  // everything else in mined order; later blocks push AFTER these (fluid 0638 unshifts to
  // the very front separately).
  const HOIST = ['tc Particular-0577', 'tc Particular-0782', 'tc Particular-0703'];
  params.sort((a, b) => {
    const ia = HOIST.indexOf(a[0]), ib = HOIST.indexOf(b[0]);
    return (ia < 0 ? HOIST.length : ia) - (ib < 0 ? HOIST.length : ib);
  });

  // sprite connect (PROBED 2026-07-17): 0703's max IS 6 and 6 IS Sprite — an unconnected
  // sprite renders as a white card, which round-3's visual probe misread as "Square".
  // When the vendor preset references a sprite the packs actually ship, connect it for
  // real: footage import as a video-off layer + Layer param 0066 (+ Time Sampling 0067
  // from PLayerTime). Designer's Colorize/Fill type variants map to the separate 0700/0701
  // booleans of v2023. Fallback below stays for refs we can't resolve on disk.
  const packRoot = path.join(PACKS, pack);
  let footageOut = null;
  let plRef = flat.FXid_PLayer;
  if (!(plRef && typeof plRef === 'object' && plRef.footage) && flat.FXid_PLayerMultiClips >= 1) {
    // multi-clip sprite presets (FXid_PLayerMultiClips >= 2) carry their refs in extra
    // block groups under the newer rg.p.sprite.id key, not FXid_PLayer — deep-scan and
    // take the first clip (wireframe-pyramids: 2 clips, both Pyramid Wireframe.mov)
    const stack = [d];
    while (stack.length) {
      const o = stack.pop();
      if (o && typeof o === 'object') {
        if (o['rg.p.sprite.id']?.footage) { plRef = o['rg.p.sprite.id']; break; }
        for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push(v);
      }
    }
  }
  if (plRef && typeof plRef === 'object' && plRef.footage) {
    const resolved = plRef.footage
      .replace('${RootAssetPack}', packRoot)
      .replace('${RootBlocks}', path.join(packRoot, 'Blocks'));
    if (fs.existsSync(resolved)) footageOut = [{ path: resolved, layerName: 'SpriteTex' }];
  }

  // PType fallback: Designer sprite/textured types (>=5, i.e. mapped value >=6) either land
  // on AE Square or get rejected — substitute a built-in type instead: Star for star-named
  // presets, Cloudlet for smoke/fire-ish, Glow Sphere otherwise. The lost TEXTURE usually
  // carried the color, so tint the flat particle color from the vendor THUMBNAIL's dominant
  // color (the thumb is the vendor's own render = ground truth for the intended hue).
  const ptype = params.find(p => p[0] === 'tc Particular-0703');
  if (ptype && ptype[1] >= 6 && footageOut) {
    const dsgn = ptype[1] - 1;                        // original Designer enum value
    ptype[2] += ` [Designer ${dsgn} -> Sprite + connected texture]`;
    ptype[1] = 6;
    params.push(['tc Particular-0066', { __layer: 'SpriteTex' }, 'Sprite texture layer (mined PLayer)']);
    // 0700/0701 are 0-100 AMOUNT sliders, not booleans (probed 2026-07-18: 1 -> 1% =
    // invisible tint, white sprites; 100 -> full teal. Corroborated by the artist's own
    // hibana project: petals rig authored Color Fill = 100).
    if (dsgn === 6 || dsgn === 9) params.push(['tc Particular-0700', 100, 'Colorize (Designer type variant, 0-100)']);
    if (dsgn === 7 || dsgn === 10) params.push(['tc Particular-0701', 100, 'Color Fill (Designer type variant, 0-100)']);
    const plTime = flat.FXid_PLayerTime;
    if (typeof plTime === 'number') params.push(['tc Particular-0067', plTime + 1, 'FXid_PLayerTime (+enumOffset)']);
    // keep the live unmult (0694) after the connect, and give fire-family luma sprites
    // the additive accumulation Designer's own preview shows (white-hot overlap cores on
    // Horizontal Fire); smoke banks stay Normal — unmult alone matches their thumbs.
    const unmIdx = params.findIndex(p => p[0] === 'tc Particular-0694');
    if (unmIdx >= 0) {
      const unm = params.splice(unmIdx, 1)[0];
      unm[2] += ' [after sprite connect]';
      params.push(unm);
      if (unm[1] === 1 && /fire|flare|spark|flame|ember/i.test(base))
        params.push(['tc Particular-0069', 2, 'Blend Mode: Add (curated — fire-family luma sprite)']);
    }
  } else if (ptype && ptype[1] >= 6) {
    const names = category + ' ' + base;
    ptype[1] = /star/i.test(names) ? 3 : SMOKEISH.test(names) ? 4 : 2;
    ptype[2] += ` [sprite fallback -> ${({ 3: 'Star', 4: 'Cloudlet', 2: 'Glow Sphere' })[ptype[1]]}]`;
    const tint = THUMB_COLORS[file];
    if (tint) {
      const pcol = params.find(p => p[0] === 'tc Particular-0070');
      if (pcol) { pcol[1] = [...tint, 1]; pcol[2] += ' [tinted from vendor thumb]'; }
      else params.push(['tc Particular-0070', [...tint, 1], 'tinted from vendor thumb']);
    }
  }

  // gradient flatten: Set Color = Over Life / Random exposes the UNSCRIPTABLE color-over-life
  // gradient (AE default = blue) — flatten the vendor's mined gradient to its mean color,
  // write it as the flat particle color, and force Set Color back to At Birth.
  // The gradient lives in EITHER rg.custom.col.life OR FXid_PColorOverLifeArb (same
  // PosP/PosR/PosG/PosB shape; candle-flame-class presets use the FXid form — found 2026-07-17).
  const setColor = params.find(p => p[0] === 'tc Particular-0088');
  let colLife = curves['rg.custom.col.life'] || flat.FXid_PColorOverLifeArb;
  // untouched-default guard (rising-bubbles 2026-07-18): Designer serializes a default
  // RAINBOW col.life gradient (red→green→blue; its weighted mean is the notorious
  // [0.375,0.75,0.375] green) even when the artist never opened the widget. Flattening
  // or sweeping it destroys the authored flat PColor — treat default as absent.
  if (colLife?.PosP?.length > 1) {
    const mAll = ch => { const P = colLife.PosP, span = P[P.length - 1] - P[0] || 1; let s = 0;
      for (let i = 0; i < P.length - 1; i++) s += (((ch[i] ?? 0) + (ch[i + 1] ?? 0)) / 2) * (P[i + 1] - P[i]);
      return s / span; };
    const m = [mAll(colLife.PosR || []), mAll(colLife.PosG || []), mAll(colLife.PosB || [])];
    if (Math.abs(m[0] - 0.375) < 0.01 && Math.abs(m[1] - 0.75) < 0.01 && Math.abs(m[2] - 0.375) < 0.01) colLife = null;
  }
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
    // two-tone upgrade: when the gradient's ends differ meaningfully, sweep the BIRTH
    // color across them over the emission window (population-level two-tone; a mean
    // can't do teal→orange). Expression rides on top of the static mean fallback.
    const R = colLife.PosR || [], G = colLife.PosG || [], B = colLife.PosB || [];
    if (R.length > 1) {
      const a = [R[0], G[0] ?? 0, B[0] ?? 0], b = [R[R.length - 1], G[G.length - 1] ?? 0, B[B.length - 1] ?? 0];
      const dist = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      if (dist > 0.25) {
        const f = v => v.map(x => Math.round(x * 1000) / 1000).join(',');
        expressionsOut.push(['tc Particular-0070',
          `linear(time,0,4,[${f(a)},1],[${f(b)},1])`,
          'birth-color sweep across gradient ends (two-tone)']);
      }
    }
  }

  // visibility floor (probed 2026-07-18 on floating-dust): sub-pixel Size (0.5) sprayed
  // through a room-scale emitter box renders ZERO coverage at 1280×720 — the vendor look
  // relies on DOF/exposure we don't reproduce. Clamp size up and densify when the box is
  // huge and the size sub-pixel; the probe (size 3 / psec 600) renders proper dust motes.
  {
    const sx = params.find(p => p[0] === 'tc Particular-0014');
    const sy = params.find(p => p[0] === 'tc Particular-0015');
    const sz = params.find(p => p[0] === 'tc Particular-0016');
    const volume = (sx?.[1] || 500) * (sy?.[1] || 500) * (sz?.[1] || 500);
    const psize = params.find(p => p[0] === 'tc Particular-0027');
    if (psize && ((volume > 5e8 && psize[1] < 1.5) || (volume > 1e7 && psize[1] < 0.8))) {
      psize[1] = Math.max(2.5, psize[1] * 4);
      psize[2] += ' [visibility floor: sub-pixel dust]';
      if (!params.find(p => p[0] === 'tc Particular-0005')) {
        params.push(['tc Particular-0005', 500, 'Particles/sec [visibility floor]']);
      }
    }
  }

  // burst translation: Designer EmitterBehaviour 1 = Explode (probed: 0=continuous 139×,
  // 1=explode on all 45 explosion-named presets). AE has no explode enum — emit the whole
  // burst in the first 0.1s via an expression spike, and sample earlier frames.
  let isBurst = false, burstFrames = null;
  if (flat.FXid_EmitterBehaviour === 1) {
    isBurst = true;
    const psec = params.find(p => p[0] === 'tc Particular-0146');
    const burstN = (psec ? psec[1] : 100) || 100;
    const life = flat.FXid_PLife || 2;
    // spike = flat 10× → total emitted = psec×10×0.1s = EXACTLY psec particles per burst,
    // which is Designer's Explode semantics (round-6 scoring proved it: the life-scaled
    // variant over-emitted long-life explosions 2-3× — solid pancakes/white walls once S2
    // trails multiplied on top — and under-emitted sub-second muzzle flashes).
    const spikeRate = Math.max(1, Math.round(burstN * 10));
    expressionsOut.push(['tc Particular-0146', `time < 0.1 ? ${spikeRate} : 0`, 'Explode -> 0.1s burst spike']);
    // frame 1 INSIDE the emission window (0.08 — alive whatever the life is; round-3's
    // life*0.5 sat exactly on the window edge for 0.2s lives), frame 2 mid-flight of the
    // last-born particles. EXCEPT instant flashes (life < 0.1s: muzzle-flash/spark-single
    // family): emission ticks at 0, 1/30, 2/30 and everything is dead life-seconds later,
    // so any post-window sample is EMPTY (r7: spark-directional t0.112 rendered 0 px while
    // t0.08 had 38k lit px). Sample two in-window instants instead.
    burstFrames = life < 0.1 ? [0.01, 0.08] : [0.08, Math.min(2, 0.1 + life * 0.6)];
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

  // fluid enable: any FXid_Fluid* block means the vendor authored under fluid physics.
  // 0638 goes FIRST — fluid children are gated behind it (hidden-param class).
  if (Object.keys(flat).some(k => k.startsWith('FXid_Fluid'))) {
    params.unshift(['tc Particular-0638', 1, 'Enable Fluid Motion (fluid preset)']);
  }

  // aux → S2 (see AUX_S2 table): active aux presets clone the S2 master and script the
  // 2xxx params. Color: classic aux has no flat color param — ColorFromMain % inherits the
  // parent's (final, post-flatten/tint) color; else the SE color curve flattens to its mean;
  // else classic default white (the MASTER's S2 red must always be overridden). Set Color S2
  // pinned to At Birth.
  const hasAuxS2 = flat.FXid_SE_Emitter === 2;
  if (hasAuxS2) {
    params.push(['tc Particular-2830', 8, 'aux -> S2 Emitter Type: Emit from Parent (v18)']);
    for (const [k, v] of Object.entries(flat)) {
      const spec = AUX_S2[stripFxid(k)];
      if (!spec || v === null || typeof v === 'object') continue;
      let val = typeof v === 'boolean' ? (v ? 1 : 0) : v;
      let lbl = `${k} (aux->S2)`;
      if (spec[1] === 'enum') { val += 1; lbl += '+enumOffset'; }
      params.push([spec[0], val, lbl]);
    }
    // S2 particle type: same v18 6-cap; aux sprites share the main texture layer via 2114
    const pt2 = params.find(p => p[0] === 'tc Particular-2751');
    if (pt2 && pt2[1] >= 6) {
      if (footageOut) {
        pt2[1] = 6; pt2[2] += ' [Sprite + shared texture]';
        params.push(['tc Particular-2114', { __layer: 'SpriteTex' }, 'S2 sprite texture layer']);
      } else {
        pt2[1] = 2; pt2[2] += ' [sprite fallback -> Glow Sphere]';
      }
    }
    const cfm = flat.FXid_SE_PColorFromMain || 0;
    const mainCol = params.find(p => p[0] === 'tc Particular-0070');
    let col2 = [1, 1, 1, 1], colSrc = 'classic aux default white';
    const seCol = flat.FXid_SE_PColorOverLifeArb;
    if (cfm >= 50 && mainCol) { col2 = mainCol[1]; colSrc = `inherit main (${cfm}%)`; }
    else if (seCol?.PosP?.length > 1) {
      const P = seCol.PosP, span = P[P.length - 1] - P[0] || 1;
      const mean = ch => {
        let s = 0;
        for (let i = 0; i < P.length - 1; i++) s += ((ch[i] + ch[i + 1]) / 2) * (P[i + 1] - P[i]);
        return Math.max(0, Math.min(1, s / span));
      };
      col2 = [mean(seCol.PosR || []), mean(seCol.PosG || []), mean(seCol.PosB || []), 1];
      colSrc = 'flattened SE color curve';
      // Designer serializes the SE gradient widget even when the artist never touched it;
      // the untouched default flattens to this exact green mean (same trap as Form's
      // ColorMapArb, found on streak-brush 2026-07-18). Default = not authored → prefer
      // the main system's mined color.
      if (Math.abs(col2[0] - 0.375) < 0.01 && Math.abs(col2[1] - 0.75) < 0.01 && Math.abs(col2[2] - 0.375) < 0.01) {
        col2 = mainCol ? mainCol[1] : [1, 1, 1, 1];
        colSrc = mainCol ? 'inherit main (SE curve untouched default)' : 'white (SE curve untouched default)';
      }
    }
    params.push(['tc Particular-2136', 1, 'Set Color S2: At Birth']);
    params.push(['tc Particular-2118', col2, `Color S2 (${colSrc})`]);
    // S2-psec burst normalization (r6 'aux-burst-density' + r7 'slow-frame'): each PARENT
    // emits the aux rate, so children/sec scale with parents alive — a Designer-Explode
    // spike (19k parents at once on ring-explosion) turns a vendor-tuned 450/s trail into
    // white walls and multi-million-particle mid-flight frames (19k × 450/s × 1s child
    // life ≈ 8.6M at t1.9 — the 15-min frame). Divide the S2 rate by the same ×10 the
    // spike applies to the parent rate; the visual loop is the arbiter of the ratio.
    if (isBurst) {
      const s2psec = params.find(p => p[0] === 'tc Particular-2194');
      if (s2psec && typeof s2psec[1] === 'number' && s2psec[1] > 0) {
        s2psec[1] = Math.max(1, Math.round(s2psec[1] / 10));
        s2psec[2] += ' [/10 burst-spike normalization]';
      }
    }
    // S2 physics guard — same engine rule as main: wind/turbulence are inert at
    // Air Resistance 0 and setting them anyway pops the bridge-stalling modal
    const air2 = params.find(p => p[0] === 'tc Particular-2066');
    if (!air2 || air2[1] === 0) {
      for (const mn of ['tc Particular-2797', 'tc Particular-2759']) {
        const idx = params.findIndex(p => p[0] === mn && p[1] !== 0);
        if (idx >= 0) { droppedInert.push(params[idx]); params.splice(idx, 1); }
      }
    }
  }

  // v18 emitter-type enum (read off the UI dropdown 2026-07-16): 1 Point / 2 Box / 3 Sphere /
  // 4 Light(s) / 5 Layer / 6 3D Model / 7 Text/Mask (+8 Emit-from-Parent on S2 only).
  // GRID was REMOVED in v18, so the blind Designer+1 mapping is wrong from Grid upward:
  // Designer 0,1,2 -> 1,2,3; 3 (Grid) -> 2 (Box fallback); 4 Light -> 4; 5 Layer -> 5;
  // 7 Text -> 7; 8/9 (OBJ) -> 6 (3D Model).
  const V18_EMITTER = { 1: 1, 2: 2, 3: 3, 4: 2, 5: 4, 6: 5, 7: 5, 8: 7, 9: 6, 10: 6 }; // keyed by old +1 value
  const emitType = params.find(p => p[0] === 'tc Particular-0782');
  if (emitType && V18_EMITTER[emitType[1]] !== undefined && V18_EMITTER[emitType[1]] !== emitType[1]) {
    emitType[2] += ` [v18 enum: ${emitType[1]}->${V18_EMITTER[emitType[1]]}]`;
    emitType[1] = V18_EMITTER[emitType[1]];
  }
  const needsLight = emitType && emitType[1] === 4;

  // OBJ master: vendor model ref → the user-authored use-comp master. Takes precedence
  // over the S2 master when both apply (one clone source per host; the model carries the
  // primary look — e.g. orbit trades its aux trails for the tube geometry).
  let objMaster = null;
  const objRef = flat.FXid_Options_OBJLayer;
  if (objRef && typeof objRef === 'object' && objRef.footage) {
    const objBase = objRef.footage.split('/').pop().replace(/\.obj$/i, '');
    if (OBJ_MASTER[objBase]) objMaster = OBJ_MASTER[objBase];
  }
  // OBJ options are hidden without a live model — every preset carries them at defaults,
  // so emit them only on actual OBJ drafts (param-fail noise otherwise)
  if (!objMaster) {
    const OBJ_OPTS = new Set(['tc Particular-0535', 'tc Particular-0539', 'tc Particular-0537', 'tc Particular-0538', 'tc Particular-0578']);
    for (let i = params.length - 1; i >= 0; i--) if (OBJ_OPTS.has(params[i][0])) params.splice(i, 1);
  } else {
    // the mined emitter type must not override the master's 3D Model (Designer stores
    // whatever pre-OBJ type the artist last touched — orbit came back as Point, ring
    // as Text/Mask, both wiping the model; round-7a lesson)
    const et = params.find(p => p[0] === 'tc Particular-0782');
    if (et) { et[1] = 6; et[2] += ' [forced 3D Model: OBJ master]'; }
    else params.push(['tc Particular-0782', 6, 'Emitter Type: 3D Model (OBJ master)']);
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
  // artist curve masters (authored in UI 2026-07-18): cloud = size-over-life bell +
  // opacity fade-out; fire = same curves + Set Color Over Life + white→yellow→orange→
  // deep-red gradient. Clone-into-comp carries the curves (the 4b25c4b route). Priority:
  // obj > aux-S2 (irreplaceable capabilities) > curves.
  const CURVE_MASTER = {
    'explode-out': 'MASTER_particular_cloud', 'explode-up': 'MASTER_particular_cloud',
    'explode-up-dark': 'MASTER_particular_cloud', 'floating-dust': 'MASTER_particular_cloud',
    'snowy-night-2': 'MASTER_particular_cloud', 'smoke-plume': 'MASTER_particular_cloud',
    'simple-smoke': 'MASTER_particular_cloud', 'smoke-puff-1': 'MASTER_particular_cloud',
    'smoke-rising-1': 'MASTER_particular_cloud', 'smoke-rising-2': 'MASTER_particular_cloud',
    'smoke-trail': 'MASTER_particular_cloud',
    'fire-burst-1': 'MASTER_particular_fire', 'ignition': 'MASTER_particular_fire',
    'hazy-fire': 'MASTER_particular_fire', 'smokey-fire': 'MASTER_particular_fire',
    'rocket-fire': 'MASTER_particular_fire', 'simple-fire': 'MASTER_particular_fire',
    'falling-sparks': 'MASTER_particular_fire',
  };
  // light-path class: Designer's previews animate the emitter along a built-in demo
  // path — the presets carry NO path data (verified: no keyframes in the xbxc). A
  // synthesized lissajous sweep lets the streaklets paint their light ribbons.
  if (['light-streaks-blue', 'light-streaks-orange', 'chemtrails'].includes(slug)) {
    // probed 2026-07-18: 0581 Position (3D) is the LIVE emitter position (0003 XY is a
    // dormant twin — expressions on it are inert), and 0005 is the live Particles/sec
    // (the aliased 0146 'ParticlesPerSecF' alone leaves near-zero emission; blue ribbon
    // painted perfectly with 0005+0581). 0146-vs-0005 semantics = round-11 worklist.
    expressionsOut.push(['tc Particular-0581',
      '[640 + 380*Math.sin(time*1.3), 360 + 190*Math.sin(time*2.6 + 1.2), 0]',
      'synthesized light-painting sweep (presets ship no emitter path)']);
    const f146 = params.find(p => p[0] === 'tc Particular-0146');
    params.push(['tc Particular-0005', f146 ? f146[1] : 2000, 'live psec (0146 twin insufficient)']);
  }
  const curveMaster = (!objMaster && !hasAuxS2 && CURVE_MASTER[slug]) || null;
  if (curveMaster === 'MASTER_particular_fire') {
    // the master's gradient is the point — drop the flatten's At-Birth forcing and any
    // thumb-tint flat color that would override it, and pin Set Color to Over Life
    for (let i = params.length - 1; i >= 0; i--) {
      const [id, , label = ''] = params[i];
      if ((id === 'tc Particular-0088' && label.includes('forced At Birth')) ||
          (id === 'tc Particular-0070' && (label.includes('flattened col.life') || label.includes('tinted from vendor thumb')))) {
        params.splice(i, 1);
      }
    }
    const sc = params.find(p => p[0] === 'tc Particular-0088');
    if (sc) { sc[1] = 2; sc[2] += ' [Over Life: fire master gradient]'; }
  }
  // use-comp masters render within the master's native 4s: a script-retimed comp stops
  // rendering particles at the ORIGINAL duration boundary (probed: t=3.9 lit, t=4.5 empty
  // with duration/outPoint/workArea all at 6 — plugin-private time cap, unexplained)
  const compDur = objMaster ? 4 : 6;
  const frames = isBurst ? burstFrames : (objMaster ? [1, 3] : [1, 4]);

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
    comp: { width: 1280, height: 720, fps: 30, duration: compDur },
    background: [0, 0, 0],
    lights: needsLight ? [{ name: 'Emitter', position: [640, 360, 0] }] : undefined,
    footage: footageOut || undefined,
    master: objMaster
      ? { library: 'library/particular-masters.aep', comp: objMaster, layer: 1, mode: 'use-comp' }
      : hasAuxS2
        ? { library: 'library/particular-masters.aep', comp: 'MASTER_particular_S2', layer: 1 }
        : curveMaster
          ? { library: 'library/particular-masters.aep', comp: curveMaster, layer: 1 }
          : undefined,
    hostName: 'Mined',
    effects: [{ matchName: 'tc Particular', params, expressions: expressionsOut }],
    camera: null,
    renderFrames: frames,
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
