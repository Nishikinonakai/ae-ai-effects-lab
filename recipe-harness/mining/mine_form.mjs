// mine_form.mjs — Form (tc Form) vendor-preset miner: 77 Form .xbxc → recipe drafts.
//
// Where mine_xbxc.mjs carries its alias table inline, this miner consumes the offline
// curation in form_alias_map.json (built 2026-07-18 from the tc_Form card + all 77 raw
// presets; see FORM_ALIAS_NOTES.md). Same draft schema as the Particular miner — the
// runner, validator and sheet pipeline are shared (--dir/--results flags on the validator).
//
//   node mining/mine_form.mjs   # → form_catalog.json, drafts_form/<pack>/<slug>.json, thumbs/
//
// Form-specific translation rules (notes §"Gating / write-order"):
//   - 0003 Base Form hoists first (gates String/3D-Model/Text sub-blocks);
//     0489 size-mode hoists before Size Y/Z; sprite: 0024 → 0027 connect → texture opts.
//   - Centers are NORMALIZED comp fractions → ×[W,H]; sphere/kaleido park sentinel
//     [-960,-540,540] means "inactive" → dropped.
//   - ColorMapArb/col-gradient → flatten to 0036 + Set Color 0042=1 (Particular recipe).
//   - OBJ presets (BaseShape=3): model connect needs the use-comp master route → v1 marks
//     them _objGated and keeps the rest of the look (no fake fallback geometry).
//   - No wind/air-resist modal exists in Form; fluid enable 0553 hoists before fluid params.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKS = '/Users/Shared/Red Giant/Trapcode Packs';
const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'form_alias_map.json'), 'utf8'));
const CARD = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'introspect', 'cards', 'tc_Form.json'), 'utf8'));
const DRAFTS = path.join(__dirname, 'drafts_form');
const THUMBS = path.join(__dirname, 'thumbs');
const W = 1280, H = 720;

const cardByMatch = new Map(CARD.params.map(p => [p.matchName, p]));
const SENTINEL = v => Array.isArray(v) && Math.abs(v[0] + 960) < 1 && Math.abs(v[1] + 540) < 1;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const files = [...walk(PACKS)].filter(f => /Presets\/Form\//.test(f) && f.endsWith('.xbxc'));
const baseCount = new Map();
for (const f of files) {
  const b = path.basename(f, '.xbxc');
  baseCount.set(b, (baseCount.get(b) || 0) + 1);
}

const catalog = { generated_from: PACKS, effect: 'tc Form', presets: [] };
const unmappedFreq = new Map();
fs.mkdirSync(DRAFTS, { recursive: true });

for (const file of files) {
  const rel = path.relative(PACKS, file);
  const pack = rel.split(path.sep)[0];
  const category = path.basename(path.dirname(file));
  const base = path.basename(file, '.xbxc');

  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }

  // flatten FXid params + capture asset refs and curve blocks
  const flat = {}, assets = {};
  for (const g of d.groups || [])
    for (const b of g.blocks || [])
      for (const gg of Object.values(b.groups || {}))
        for (const [k, v] of Object.entries(gg.params || {})) {
          if (k.startsWith('rg.')) assets[k] = v;
          else flat[k] = v;
        }

  const params = [], unmapped = {}, notes = [];
  let curves = 0;
  for (const [k, v] of Object.entries(flat)) {
    if (/Arb$/.test(k)) { curves++; continue; }     // curve blocks: master-clone territory
    const e = MAP[k];
    if (!e) { unmapped[k] = v; unmappedFreq.set(k, (unmappedFreq.get(k) || 0) + 1); continue; }
    if (e.via === 'skip' || !e.target) continue;
    if (e.confidence === 'low') { notes.push(`low-conf skipped: ${k}`); continue; }
    const card = cardByMatch.get(e.target);
    if (card && (card.type === 'CUSTOM')) { curves++; continue; }          // master-clone territory
    if (e.layerConnect) continue;                                          // handled via assets below

    let val = v;
    if (val && typeof val === 'object' && 'r' in val) {
      val = [val.r / 255, val.g / 255, val.b / 255, 1];
    } else if (typeof val === 'boolean') val = val ? 1 : 0;
    else if (typeof val === 'string') { const f = parseFloat(val); if (!isNaN(f)) val = f; else continue; }
    if (val && typeof val === 'object' && !Array.isArray(val)) continue;   // curve blobs etc.
    if (e.enumOffsetSuspect && typeof val === 'number') val = val + 1;

    // spatial translation: normalized fractions → pixels; park sentinel = inactive
    if (card && (card.type === '2D_SPATIAL' || card.type === '3D_SPATIAL')) {
      if (SENTINEL(val)) continue;
      if (Array.isArray(val)) {
        val = card.type === '2D_SPATIAL'
          ? [val[0] * W, val[1] * H]
          : [val[0] * W, val[1] * H, (val[2] || 0) * H];
      }
    }
    // drop inert-at-default writes (fewer settability landmines on gated params)
    if (card && card.value !== '' && !Array.isArray(val)) {
      const dv = parseFloat(card.value);
      if (!isNaN(dv) && Math.abs(dv - val) < 1e-9) continue;
    }
    params.push([e.target, val, `${k} (${e.via}${e.enumOffsetSuspect ? '+enumOffset' : ''}, ${e.confidence})`]);
  }

  // gradient flatten: ColorMapArb / rg color curve → mean color to 0036, Set Color 0042=1
  const colArb = flat.FXid_ColorMapArb || assets['rg.custom.col.life'];
  const setColor = params.find(p => p[0] === 'tc Form-0042');
  if (colArb?.PosP?.length > 1) {
    const P = colArb.PosP, span = P[P.length - 1] - P[0] || 1;
    const mean = ch => {
      let s = 0;
      for (let i = 0; i < P.length - 1; i++) s += ((ch[i] + ch[i + 1]) / 2) * (P[i + 1] - P[i]);
      return Math.max(0, Math.min(1, s / span));
    };
    const flatCol = [mean(colArb.PosR || []), mean(colArb.PosG || []), mean(colArb.PosB || []), 1];
    const pcol = params.find(p => p[0] === 'tc Form-0036');
    if (pcol) { pcol[1] = flatCol; pcol[2] += ' [flattened ColorMapArb]'; }
    else params.push(['tc Form-0036', flatCol, 'flattened ColorMapArb']);
    // the mode switch MUST land too, or the unscriptable default teal-green gradient
    // keeps rendering over the flat color (the r1 "green bias": red-shard came out green
    // because ColorMapOver had been dropped as inert-at-default upstream)
    if (setColor) { setColor[1] = 1; setColor[2] += ' [forced flat: gradient unscriptable]'; }
    else params.push(['tc Form-0042', 1, 'Set Color -> flat (gradient unscriptable)']);
  }

  // sprite connect: PType >= 6 (post-offset) + shipped texture → footage + 0027
  let footageOut = null, objGated = false;
  const ptype = params.find(p => p[0] === 'tc Form-0024');
  const spriteRef = assets['rg.p.sprite.id'];
  if (ptype && ptype[1] >= 6 && ptype[1] <= 11 && spriteRef?.footage) {
    const resolved = spriteRef.footage
      .replace('${RootAssetPack}', path.join(PACKS, pack))
      .replace('${RootBlocks}', path.join(PACKS, pack, 'Blocks'));
    if (fs.existsSync(resolved)) {
      footageOut = [{ path: resolved, layerName: 'SpriteTex' }];
      params.push(['tc Form-0027', { __layer: 'SpriteTex' }, 'Sprite texture layer (rg.p.sprite.id)']);
      const plTime = flat.FXid_PLayerTime;
      if (typeof plTime === 'number') params.push(['tc Form-0028', plTime + 1, 'FXid_PLayerTime (+enumOffset)']);
    }
  }
  // OBJ presets: model connect is user-master territory — keep the look, mark the gate
  // (rg.bf.obj.id rides along in most presets pointing at a default model; only
  // BaseShape=3 actually renders from it)
  if (flat.FXid_BaseShape === 3) objGated = true;

  // texture opts are sprite-gated (hidden until 0027 connects — Particular r7 lesson):
  // emit them only on actual connected-sprite drafts
  if (!footageOut) {
    const TEXOPTS = new Set(['tc Form-0028', 'tc Form-0029', 'tc Form-0030', 'tc Form-0301']);
    for (let i = params.length - 1; i >= 0; i--) if (TEXOPTS.has(params[i][0])) params.splice(i, 1);
  }
  // OBJ options are hidden without a live model — drop them on non-OBJ drafts
  if (!objGated) {
    for (let i = params.length - 1; i >= 0; i--) {
      const n = parseInt(params[i][0].split('-')[1], 10);
      if ((n >= 459 && n <= 488) || n === 541) params.splice(i, 1);
    }
  }

  // write-order hoists (notes §gating): base form switch, size-mode gate, fluid enable,
  // then particle type before its sprite sub-block
  const HOIST = ['tc Form-0003', 'tc Form-0489', 'tc Form-0553', 'tc Form-0024'];
  params.sort((a, b) => {
    const ia = HOIST.indexOf(a[0]), ib = HOIST.indexOf(b[0]);
    return (ia < 0 ? HOIST.length : ia) - (ib < 0 ? HOIST.length : ib);
  });

  // thumbnail
  let thumb = null;
  if (d.preview?.b64data) {
    thumb = path.join(THUMBS, pack, 'Form', category, base + '.png');
    fs.mkdirSync(path.dirname(thumb), { recursive: true });
    fs.writeFileSync(thumb, Buffer.from(d.preview.b64data, 'base64'));
  }

  let slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if ((baseCount.get(base) || 0) > 1) slug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + slug;

  const draft = {
    _mined_from: file,
    _pack: pack,
    _category: category,
    _effect: 'tc Form',
    _map_coverage: `${params.length} mapped / ${Object.keys(unmapped).length} unmapped / ${curves} curves`,
    _unmapped: Object.keys(unmapped),
    _notes: notes,
    ...(objGated ? { _objGated: true } : {}),
    intent: `Reproduce the vendor Form preset "${base}" (${category}); reference thumbnail: ${thumb || 'none shipped'}`,
    name: slug,
    compName: 'MinedForm_' + base.replace(/[^a-zA-Z0-9]+/g, ''),
    comp: { width: W, height: H, fps: 30, duration: 6 },
    background: [0, 0, 0],
    ...(footageOut ? { footage: footageOut } : {}),
    effects: [{ matchName: 'tc Form', params }],
    renderFrames: [1, 4],
  };
  const outDir = path.join(DRAFTS, pack);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, slug + '.json'), JSON.stringify(draft, null, 1));
  catalog.presets.push({
    slug, pack, category, file, thumb,
    draft: path.join('drafts_form', pack, slug + '.json'),
    params: params.length, unmapped: Object.keys(unmapped).length, objGated,
  });
}

fs.writeFileSync(path.join(__dirname, 'form_catalog.json'), JSON.stringify(catalog, null, 1));
console.log(`mined ${catalog.presets.length} Form drafts -> ${DRAFTS}`);
console.log(`objGated: ${catalog.presets.filter(p => p.objGated).length}`);
const top = [...unmappedFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log('top unmapped FXids:');
for (const [k, n] of top) console.log(`   ${n}× ${k}`);
