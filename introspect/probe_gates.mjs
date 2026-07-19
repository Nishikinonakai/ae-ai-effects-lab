// probe_gates.mjs — separate CONDITIONALLY GATED params from PERMANENTLY DEAD ones.
//
// The settability survey found that ~20% of sampled params reject every write in an effect's
// DEFAULT state. That number is real but ambiguous, and the ambiguity matters enormously:
//
//   · CONDITIONALLY GATED — hidden now, opens when some parent enum/toggle changes. Trapcode Form
//     showing 2080/2458 shut is almost certainly this: a Form built as a Box does not expose the
//     Sphere's parameters. These are USABLE, and knowing which gate opens them is precisely the
//     "hidden parameter gating" knowledge the causal ontology exists to hold.
//   · PERMANENTLY DEAD — never writable under any combination. Deep Glow's Spread is the candidate:
//     probed against six plausible gates, on fresh instances and after renders, always shut. Those
//     must not be offered as levers, because reaching for one costs a whole tune iteration.
//
// Whether that second category exists at all is still open — see the STATUS warning below.
//
// Calling both "phantom levers" would be wrong in opposite directions — it would write off usable
// params, and it would keep recommending dead ones. So: enumerate the candidate gates (the small
// integer params — enums and checkboxes), flip each to each of its values, and re-measure.
//
// Each flip is its OWN bridge round-trip, and that is not incidental. A plugin recomputes param
// visibility in a UI pass that AE runs after the calling script returns, so flipping a gate and
// re-probing inside one script reads the PREVIOUS visibility state. (Measured while building the
// settability probe: the same instance reported everything settable during creation and 9 params
// hidden on the very next round-trip.)
//
// ⚠ STATUS: NOT A VALIDATED INSTRUMENT. It reported 0 conditionally-gated params across 105 flips
// on three effects, and that is demonstrably wrong: `tc Form-0005` (Base Form Size Y) probes as
// hidden and this tool fails to open it by flipping `tc Form-0489` — yet a live recipe run sets
// exactly that gate and then writes Size Y successfully. A negative result here means NOTHING about
// permanence until that discrepancy is understood. See SETTABILITY.md.
//
// usage: node introspect/probe_gates.mjs "<effect matchName>" [--max-gates=14] [--max-values=4]
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS = path.join(__dirname, 'cards');
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
const CMD = path.join(BRIDGE, 'ae_command.json');
const RES = path.join(BRIDGE, 'ae_mcp_result.json');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const effect = process.argv[2];
if (!effect || effect.startsWith('--')) { console.error('usage: node introspect/probe_gates.mjs "<effect matchName>" [--max-gates=14] [--max-values=4]'); process.exit(1); }
const maxGates = Number(arg('max-gates', 14));
const maxValues = Number(arg('max-values', 4));

async function runAE(script, timeoutMs = 120000) {
  fs.writeFileSync(RES, JSON.stringify({ status: 'waiting' }));
  fs.writeFileSync(CMD, JSON.stringify({ command: 'runScript', args: { script }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 600));
    try {
      const c = JSON.parse(fs.readFileSync(CMD, 'utf8'));
      if (c.status === 'completed') return fs.readFileSync(RES, 'utf8');
      if (c.status === 'error') throw new Error(fs.readFileSync(RES, 'utf8').slice(0, 200));
    } catch (e) { if (String(e).includes('status')) continue; if (String(e).includes('{')) throw e; }
  }
  throw new Error('bridge timeout');
}

const PRE = `
  function fxOf(){
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++){ var it = app.project.item(i);
      if (it instanceof CompItem && it.name === "__Introspect") { comp = it; break; } }
    if (!comp) return null;
    var s = null; for (var L = 1; L <= comp.numLayers; L++) if (comp.layer(L).name === "probe") s = comp.layer(L);
    if (!s || s.Effects.numProperties < 1) return null;
    return s.Effects.property(1);
  }
  function shutSet(fx, list){
    var out = [];
    for (var i = 0; i < list.length; i++){
      try { var p = fx.property(list[i]); p.setValue(p.value); }
      catch(e){ if (String(e).indexOf("hidden") >= 0) out.push(list[i]); }
    }
    return out.join(",");
  }`;

// 1) fresh instance of the effect on the scratch solid
console.log(`applying ${effect} to the __Introspect scratch layer…`);
await runAE(`(function(){
  var comp = null;
  for (var i = 1; i <= app.project.numItems; i++){ var it = app.project.item(i);
    if (it instanceof CompItem && it.name === "__Introspect") { comp = it; break; } }
  if (!comp) comp = app.project.items.addComp("__Introspect", 640, 360, 1, 2, 30);
  var s = null; for (var L = 1; L <= comp.numLayers; L++) if (comp.layer(L).name === "probe") s = comp.layer(L);
  if (!s) s = comp.layers.addSolid([0.5,0.5,0.5], "probe", 640, 360, 1, 2);
  app.beginUndoGroup("probe gates");
  while (s.Effects.numProperties > 0) s.Effects.property(1).remove();
  s.Effects.addProperty(${JSON.stringify(effect)});
  app.endUndoGroup();
  return "applied";
})()`);

// 2) baseline shut-set + candidate gates, read on a SETTLED instance (next round-trip)
const meta = JSON.parse(await runAE(`(function(){${PRE}
  var fx = fxOf(); if (!fx) return '{"error":"no probe effect"}';
  var shut = [], gates = [];
  function walk(g){
    for (var i = 1; i <= g.numProperties; i++){
      var p; try { p = g.property(i); } catch(e){ continue; }
      if (p.propertyType === PropertyType.PROPERTY){
        var mn = ""; try { mn = p.matchName; } catch(e){ continue; }
        var isNum = false; try { isNum = (p.propertyValueType === PropertyValueType.OneD); } catch(e){}
        var open = true;
        try { p.setValue(p.value); } catch(e){ if (String(e).indexOf("hidden") >= 0) { open = false; shut.push('"' + mn + '"'); } }
        // candidate gate = an OPEN small-integer param: enums and checkboxes are what plugins
        // branch their visibility on. A continuous slider does not hide anything.
        if (open && isNum){
          var lo = null, hi = null;
          try { if (p.hasMin) lo = p.minValue; } catch(e){}
          try { if (p.hasMax) hi = p.maxValue; } catch(e){}
          if (lo !== null && hi !== null && hi > lo && hi - lo <= 20 && lo === Math.floor(lo) && hi === Math.floor(hi)){
            gates.push('{"mn":"' + mn + '","name":"' + String(p.name).replace(/"/g,"") + '","lo":' + lo + ',"hi":' + hi + ',"now":' + p.value + '}');
          }
        }
      } else walk(p);
    }
  }
  walk(fx);
  return '{"shut":[' + shut.join(",") + '],"gates":[' + gates.join(",") + ']}';
})()`));

if (meta.error) { console.error(meta.error); process.exit(1); }
const shut0 = meta.shut;
console.log(`baseline: ${shut0.length} param(s) shut, ${meta.gates.length} candidate gate(s)\n`);
if (!shut0.length) { console.log('nothing is gated on a default instance — no gates to hunt.'); process.exit(0); }

// 3) flip each gate to each value, one round-trip per flip, and see what opens
const gates = meta.gates.slice(0, maxGates);
const opened = new Map();      // matchName -> [{gate,name,value}]
for (let gi = 0; gi < gates.length; gi++) {
  const g = gates[gi];
  const values = [];
  for (let v = g.lo; v <= g.hi && values.length < maxValues; v++) if (v !== g.now) values.push(v);
  for (const v of values) {
    process.stdout.write(`[${gi + 1}/${gates.length}] ${g.name} = ${v} … `);
    let stillShut;
    try {
      await runAE(`(function(){${PRE}
        var fx = fxOf(); app.beginUndoGroup("gate"); fx.property(${JSON.stringify(g.mn)}).setValue(${v}); app.endUndoGroup(); return "set";
      })()`);
      stillShut = (await runAE(`(function(){${PRE}
        var fx = fxOf(); return shutSet(fx, ${JSON.stringify(shut0)});
      })()`)).split(',').filter(Boolean);
    } catch (e) { console.log(`skipped (${String(e).slice(0, 40)})`); continue; }

    const nowOpen = shut0.filter(mn => !stillShut.includes(mn));
    if (nowOpen.length) {
      for (const mn of nowOpen) {
        if (!opened.has(mn)) opened.set(mn, []);
        opened.get(mn).push({ gate: g.mn, name: g.name, value: v });
      }
      console.log(`opened ${nowOpen.length}`);
    } else console.log('—');
  }
  // restore this gate before moving on, so gates are measured independently
  try { await runAE(`(function(){${PRE} var fx=fxOf(); app.beginUndoGroup("g"); fx.property(${JSON.stringify(g.mn)}).setValue(${g.now}); app.endUndoGroup(); return "ok"; })()`); } catch {}
}

// ---- report --------------------------------------------------------------------------------------
const conditional = [...opened.keys()];
const dead = shut0.filter(mn => !opened.has(mn));
const out = {
  effect, _date: new Date().toISOString().slice(0, 10),
  _method: 'single-gate flips, one bridge round-trip each (visibility recomputes only between script executions)',
  _caveat: 'UNVALIDATED INSTRUMENT — a negative result proves nothing. Known false negative: tc Form-0489=2 does open tc Form-0005 in a recipe context but not here. Also single-gate only, so a param needing two gates set together reads as dead.',
  shutOnDefault: shut0.length,
  conditionallyGated: conditional.length,
  probablyDead: dead.length,
  gates: Object.fromEntries([...opened].map(([mn, gs]) => [mn, gs])),
  probablyDeadParams: dead,
};
const outPath = path.join(CARDS, `${effect.replace(/[^a-zA-Z0-9]+/g, '_')}_gates.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));

console.log(`\n=== ${effect} ===`);
console.log(`shut on a default instance: ${shut0.length}`);
console.log(`  · conditionally gated (a single gate opens them): ${conditional.length}`);
console.log(`  · still shut after every single-gate flip:        ${dead.length}`);
const byGate = new Map();
for (const [, gs] of opened) for (const g of gs) byGate.set(g.name + ' = ' + g.value, (byGate.get(g.name + ' = ' + g.value) || 0) + 1);
if (byGate.size) {
  console.log('\nwhich gate opens how many:');
  for (const [k, n] of [...byGate].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${k.padEnd(38)} → ${n}`);
}
console.log(`\n⚠ a "still shut" result does NOT mean the param is permanently dead — this probe has a known`);
console.log(`  false negative (tc Form Base Form Size Y). See introspect/SETTABILITY.md before acting on it.`);
console.log(`\nreport → ${path.relative(path.resolve(__dirname, '..'), outPath)}`);
