// comp_graph.mjs — whole-project NESTING GRAPH for the brownfield edit protocol.
//
// dump_comp.mjs reads ONE comp in detail. This reads the WHOLE project's TOPOLOGY: for every
// composition, which comps/footage it uses as layers — the render tree a deeply-nested project
// lives or dies by. Structure-only (source names + item kinds), NO render, so it's safe on
// projects too heavy to render (the ones that OOM/crash live). Node side then derives:
//   - roots        = comps used by nothing else (the final outputs)
//   - nesting depth = longest root→leaf comp chain
//   - pre-render substitutions = a video footage whose name matches a comp name (a comp the
//     artist rendered out and swapped in to stop the memory explosions)
//
// usage: node brownfield/comp_graph.mjs [--out=<dir>]   (defaults brownfield/dumps)
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
const CMD = path.join(BRIDGE, 'ae_command.json');
const RES = path.join(BRIDGE, 'ae_mcp_result.json');
const outDir = path.resolve((process.argv.find(a => a.startsWith('--out=')) || '').split('=')[1] || path.join(__dirname, 'dumps'));
fs.mkdirSync(outDir, { recursive: true });
const graphPath = path.join(outDir, '__graph.json');

// ExtendScript: walk every CompItem's layers, emit {comp, w, h, layers, uses:[{name,kind,missing}]}
// per line (NDJSON) to a file. kind = "comp" (nesting edge) | "video"|"still"|"audio"|"solid"|"other".
const AEX = String.raw`(function () {
  var OUT = "__GRAPHPATH__";
  function esc(s){ return String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/[\r\n\t]/g,' '); }
  function q(s){ return '"' + esc(s) + '"'; }

  var f = new File(OUT); f.encoding = "UTF-8"; f.open("w");
  var nComp = 0, nEdge = 0;
  try { app.beginSuppressDialogs(); } catch(e){}

  for (var i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i);
    if (!(it instanceof CompItem)) continue;
    nComp++;
    var uses = [];
    for (var k = 1; k <= it.numLayers; k++) {
      var L = it.layer(k);
      var src = null; try { src = L.source; } catch(e){}
      if (!src) continue;                                  // camera/light/null/text/shape — no source
      var kind = "other", missing = false, nm = "";
      try { nm = src.name; } catch(e){}
      if (src instanceof CompItem) { kind = "comp"; }
      else {
        try {
          var ms = src.mainSource;
          if (ms instanceof SolidSource) kind = "solid";
          else {
            try { missing = src.footageMissing; } catch(eM){}
            var hasV = false, hasA = false;
            try { hasV = src.hasVideo; } catch(e){}
            try { hasA = src.hasAudio; } catch(e){}
            var still = false; try { still = (src.duration === 0); } catch(e){}
            kind = hasV ? (still ? "still" : "video") : (hasA ? "audio" : "other");
          }
        } catch(e2){}
      }
      nEdge++;
      uses.push('{"name":'+q(nm)+',"kind":"'+kind+'"'+(missing?',"missing":true':'')+'}');
    }
    var line = '{"comp":'+q(it.name)+',"w":'+it.width+',"h":'+it.height+',"layers":'+it.numLayers+',"uses":['+uses.join(',')+']}';
    f.writeln(line);
  }
  f.close();
  return '{"ok":true,"comps":'+nComp+',"edges":'+nEdge+',"graph":'+q(OUT)+'}';
})();`;

const script = AEX.replace('__GRAPHPATH__', graphPath.replace(/\\/g, '\\\\'));
fs.writeFileSync(RES, JSON.stringify({ status: 'waiting' }));
fs.writeFileSync(CMD, JSON.stringify({ command: 'runScript', args: { script }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));

const deadline = Date.now() + 300000;   // deep projects take a while to walk
let report = null;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1500));
  try { const c = JSON.parse(fs.readFileSync(CMD, 'utf8')); if (c.status === 'completed' || c.status === 'error') { report = JSON.parse(fs.readFileSync(RES, 'utf8')); break; } } catch {}
}
if (!report || report.err) { console.error('bridge:', report ? report.err : 'TIMEOUT'); process.exit(1); }

// ---- derive the tree ----
const comps = fs.readFileSync(graphPath, 'utf8').trim().split(/[\r\n]+/).filter(Boolean).map(l => JSON.parse(l));
const byName = new Map(comps.map(c => [c.comp, c]));
const compNames = new Set(comps.map(c => c.comp));
const usedAsComp = new Set();                 // comp names used as a nested layer somewhere
const preRenderSubs = [];                     // video footage whose name matches a comp name
for (const c of comps) for (const u of c.uses) {
  if (u.kind === 'comp') usedAsComp.add(u.name);
  if (u.kind === 'video' && compNames.has(u.name.replace(/\.(mov|mp4|avi|mkv)$/i, ''))) preRenderSubs.push({ in: c.comp, footage: u.name });
}
const roots = comps.filter(c => !usedAsComp.has(c.comp)).map(c => c.comp);

// nesting depth = longest comp→comp chain (memoized DFS; guard cycles)
const depthCache = new Map(), inStack = new Set();
function depth(name) {
  if (depthCache.has(name)) return depthCache.get(name);
  if (inStack.has(name)) return 0;             // cycle guard
  const c = byName.get(name); if (!c) return 0;
  inStack.add(name);
  let d = 0;
  for (const u of c.uses) if (u.kind === 'comp' && byName.has(u.name)) d = Math.max(d, 1 + depth(u.name));
  inStack.delete(name); depthCache.set(name, d); return d;
}
const deepestRoot = roots.map(r => ({ r, d: depth(r) })).sort((a, b) => b.d - a.d)[0] || { r: '(none)', d: 0 };

// most-reused comps (nesting fan-in)
const fanIn = new Map();
for (const c of comps) for (const u of c.uses) if (u.kind === 'comp') fanIn.set(u.name, (fanIn.get(u.name) || 0) + 1);
const topReused = [...fanIn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

const finalGraph = path.join(outDir, 'project_comp_graph.json');
fs.renameSync(graphPath, finalGraph);

console.log(`${report.comps} comps, ${report.edges} layer-source edges`);
console.log(`roots (final outputs, used by nothing): ${roots.length}${roots.length <= 12 ? ' → ' + roots.join(', ') : ' (first 12: ' + roots.slice(0, 12).join(', ') + ')'}`);
console.log(`deepest render tree: "${deepestRoot.r}" nests ${deepestRoot.d} comp-levels deep`);
console.log(`most-reused sub-comps (fan-in): ${topReused.map(([n, c]) => `${n}×${c}`).join(', ')}`);
console.log(`pre-render substitutions (comp rendered out → swapped as video): ${preRenderSubs.length}` + (preRenderSubs.length ? '\n  ' + preRenderSubs.slice(0, 10).map(p => `${p.footage} ⟵ used in ${p.in}`).join('\n  ') : ''));
console.log(`\ngraph → ${path.relative(REPO, finalGraph)}`);
