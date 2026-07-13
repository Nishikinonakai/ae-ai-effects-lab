// probe_param.mjs — visual causal probe for a single effect parameter.
//
// The introspector reads a param's TYPE and RANGE but not its perceptual MEANING
// (and AE can't read enum dropdown labels at all). This closes that gap empirically:
// sweep the param across given values, render one frame per value, and let a vision
// model read the deltas. Recovers enum semantics + causal param->look mapping with
// zero documentation — the automatic ontology-enrichment step.
//
// usage: node probe_param.mjs "<effectMatch>" "<paramMatch>" "v1,v2,v3,..."
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMES = path.join(__dirname, 'frames');
fs.mkdirSync(FRAMES, { recursive: true });
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
const CMD = path.join(BRIDGE, 'ae_command.json');
const RES = path.join(BRIDGE, 'ae_mcp_result.json');

const [effect, param, valuesArg] = process.argv.slice(2);
if (!effect || !param || !valuesArg) {
  console.error('usage: node probe_param.mjs "<effectMatch>" "<paramMatch>" "v1,v2,v3"');
  process.exit(1);
}
const values = valuesArg.split(',').map(s => s.trim());
const safe = (effect + '_' + param).replace(/[^a-zA-Z0-9]+/g, '_');

const setStmts = values.map((v, i) => {
  const fp = path.join(FRAMES, `${safe}__${String(v).replace(/[^a-zA-Z0-9-]/g, '')}.png`).replace(/\\/g, '\\\\');
  return `
    try {
      fx.property("${param}").setValue(${v});
      comp.saveFrameToPng(1, new File("${fp}"));
      out.push('{"v":"${v}","frame":"${fp}","ok":true}');
    } catch (e) { out.push('{"v":"${v}","ok":false,"err":"' + esc(String(e).substring(0,50)) + '"}'); }`;
}).join('');

const script = String.raw`(function () {
  var esc = function (s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\"'); };
  var out = [];
  try {
    app.beginUndoGroup("Probe");
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.name === "__Probe") { comp = it; break; }
    }
    if (!comp) comp = app.project.items.addComp("__Probe", 640, 360, 1, 2, 30);
    var solid = null;
    for (var L = 1; L <= comp.numLayers; L++) if (comp.layer(L).name === "probe") solid = comp.layer(L);
    if (!solid) solid = comp.layers.addSolid([0.5,0.5,0.5], "probe", 640, 360, 1, 2);
    while (solid.Effects.numProperties > 0) solid.Effects.property(1).remove();
    var fx = solid.Effects.addProperty("${effect}");
    app.endUndoGroup();
    ${setStmts}
    return '{"status":"ok","frames":[' + out.join(",") + ']}';
  } catch (e) {
    try { app.endUndoGroup(); } catch (e2) {}
    return '{"status":"error","message":"' + esc(String(e)) + '"}';
  }
})();`;

fs.writeFileSync(RES, JSON.stringify({ status: 'waiting' }));
fs.writeFileSync(CMD, JSON.stringify({ command: 'runScript', args: { script }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));

const deadline = Date.now() + 120000;
let res = null;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1200));
  try {
    const cmd = JSON.parse(fs.readFileSync(CMD, 'utf8'));
    if (cmd.status === 'completed' || cmd.status === 'error') { res = JSON.parse(fs.readFileSync(RES, 'utf8')); break; }
  } catch {}
}
if (!res || res.status !== 'ok') { console.error('probe failed: ' + JSON.stringify(res)); process.exit(1); }

// poll async frames
const wanted = res.frames.filter(f => f.ok).map(f => f.frame);
const fdl = Date.now() + 30000;
const ready = new Set();
while (ready.size < wanted.length && Date.now() < fdl) {
  await new Promise(r => setTimeout(r, 1000));
  for (const fp of wanted) if (!ready.has(fp) && fs.existsSync(fp) && fs.statSync(fp).size > 0) ready.add(fp);
}
console.log(`probe: ${effect} / ${param}`);
for (const f of res.frames) {
  if (f.ok) console.log(`  ${ready.has(f.frame) ? '✓' : '✗'}  value=${f.v}  ${f.frame}`);
  else console.log(`  ✗  value=${f.v}  — ${f.err}`);
}
