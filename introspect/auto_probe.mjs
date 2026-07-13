// auto_probe.mjs — from an introspect card, auto-plan and render the visual probe sweep.
//
// Reads cards/<effect>.json, picks the params the introspector can describe structurally
// but NOT semantically (enum-like: 1D integer, bounded small range — the dropdown-label gap),
// plans sample values, renders one frame per (param,value) in a single bridge call, and emits
// enrichment/<effect>.manifest.json listing every frame that needs a vision description.
//
// This automates "what to probe". The vision-read + merge steps consume the manifest.
//
// usage: node auto_probe.mjs <cards/effect.json> [--max-targets=6] [--max-values=6]
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMES = path.join(__dirname, 'frames');
const ENRICH = path.join(__dirname, 'enrichment');
fs.mkdirSync(FRAMES, { recursive: true });
fs.mkdirSync(ENRICH, { recursive: true });
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
const CMD = path.join(BRIDGE, 'ae_command.json');
const RES = path.join(BRIDGE, 'ae_mcp_result.json');

const cardPath = process.argv[2];
if (!cardPath) { console.error('usage: node auto_probe.mjs <cards/effect.json>'); process.exit(1); }
const argN = (k, d) => { const a = process.argv.find(s => s.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
const maxTargets = argN('max-targets', 6);
const maxValues = argN('max-values', 6);

const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
const effMatch = card.effect.matchName;
const effSafe = effMatch.replace(/[^a-zA-Z0-9]+/g, '_');

// --- pick enum-like targets: 1D, integer value, bounded small range (the label gap) ---
function isEnumLike(p) {
  if (p.type !== '1D') return false;
  if (p.min === undefined || p.max === undefined) return false;
  const span = p.max - p.min;
  if (span < 1 || span > 24) return false;
  const v = Number(p.value);
  return Number.isFinite(v) && Math.abs(v - Math.round(v)) < 1e-6; // integer-valued
}
function planValues(p) {
  const lo = Math.round(p.min), hi = Math.round(p.max);
  const all = [];
  for (let v = lo; v <= hi; v++) all.push(v);
  if (all.length <= maxValues) return all;
  const step = (all.length - 1) / (maxValues - 1);
  const out = [];
  for (let i = 0; i < maxValues; i++) out.push(all[Math.round(i * step)]);
  return [...new Set(out)];
}

const targets = card.params.filter(isEnumLike).slice(0, maxTargets).map(p => ({
  name: p.name, matchName: p.matchName, min: p.min, max: p.max, values: planValues(p),
}));

if (!targets.length) { console.error('no enum-like targets found in card'); process.exit(1); }
console.log(`planning probe for ${card.effect.name}: ${targets.length} enum-like params`);
for (const t of targets) console.log(`  ${t.name} [${t.min}..${t.max}] -> {${t.values.join(',')}}`);

// --- build one ExtendScript that sweeps every (target,value) from a clean baseline each target ---
const manifest = { effect: card.effect, targets: [] };
let sweeps = '';
for (const t of targets) {
  const tSafe = t.matchName.replace(/[^a-zA-Z0-9]+/g, '_');
  const entry = { name: t.name, matchName: t.matchName, min: t.min, max: t.max, values: [] };
  sweeps += `\n    resetEffect();`;
  for (const v of t.values) {
    const frame = path.join(FRAMES, `${effSafe}__${tSafe}__${v}.png`);
    entry.values.push({ value: v, frame });
    sweeps += `
    try { fx.property("${t.matchName}").setValue(${v}); comp.saveFrameToPng(1, new File("${frame.replace(/\\/g, '\\\\')}")); }
    catch (e) { errs.push("${tSafe}=${v}: " + String(e).substring(0,40)); }`;
  }
  manifest.targets.push(entry);
}

const script = String.raw`(function () {
  var errs = [], fx = null, comp = null, solid = null;
  function resetEffect() {
    while (solid.Effects.numProperties > 0) solid.Effects.property(1).remove();
    fx = solid.Effects.addProperty("${effMatch}");
  }
  try {
    app.beginUndoGroup("AutoProbe");
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.name === "__Probe") { comp = it; break; }
    }
    if (!comp) comp = app.project.items.addComp("__Probe", 640, 360, 1, 2, 30);
    for (var L = 1; L <= comp.numLayers; L++) if (comp.layer(L).name === "probe") solid = comp.layer(L);
    if (!solid) solid = comp.layers.addSolid([0.5,0.5,0.5], "probe", 640, 360, 1, 2);
    ${sweeps}
    app.endUndoGroup();
    return '{"status":"ok","errs":' + errs.length + ',"detail":"' + errs.join(" | ").replace(/"/g,"'") + '"}';
  } catch (e) {
    try { app.endUndoGroup(); } catch (e2) {}
    return '{"status":"error","message":"' + String(e).replace(/"/g,"'") + '"}';
  }
})();`;

fs.writeFileSync(RES, JSON.stringify({ status: 'waiting' }));
fs.writeFileSync(CMD, JSON.stringify({ command: 'runScript', args: { script }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));

const deadline = Date.now() + 180000;
let res = null;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1500));
  try { const cmd = JSON.parse(fs.readFileSync(CMD, 'utf8')); if (cmd.status === 'completed' || cmd.status === 'error') { res = JSON.parse(fs.readFileSync(RES, 'utf8')); break; } } catch {}
}
if (!res || res.status !== 'ok') { console.error('sweep failed: ' + JSON.stringify(res)); process.exit(1); }

// poll async frames
const allFrames = manifest.targets.flatMap(t => t.values.map(v => v.frame));
const fdl = Date.now() + 40000;
const ready = new Set();
while (ready.size < allFrames.length && Date.now() < fdl) {
  await new Promise(r => setTimeout(r, 1000));
  for (const fp of allFrames) if (!ready.has(fp) && fs.existsSync(fp) && fs.statSync(fp).size > 0) ready.add(fp);
}

const manifestPath = path.join(ENRICH, effSafe + '.manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nrendered ${ready.size}/${allFrames.length} frames  (errs=${res.errs})`);
console.log(`manifest -> ${manifestPath}`);
