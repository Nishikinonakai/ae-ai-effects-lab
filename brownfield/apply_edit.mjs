// apply_edit.mjs — brownfield EDIT PROTOCOL: safely apply an edit to the active comp, with
// before/after capture and deterministic rollback. The F2 sequel — perception (dump_comp) reads
// the current state; this ACTS on it, reversibly.
//
// The product must be able to MODIFY a real project, not just author from scratch — but a wrong
// edit on someone's 10,000-layer comp is unacceptable, and AE's own undo stack is fragile under
// headless automation (any intervening user action buries the edit). So every edit here:
//   1) is applied inside a single beginUndoGroup/endUndoGroup (one atomic step),
//   2) records its exact INVERSE as data (old param value / added-effect index), so rollback is
//      deterministic and independent of AE's undo stack,
//   3) captures the rendered frame BEFORE and AFTER at the SAME playhead (uses F2: the frame the
//      model verifies against is the one actually live at comp.time),
//   4) never touches a user's original file — operate on a copy or scratch comp only.
//
// Two proven ops (the create-vs-modify pair the E2E demo exercised):
//   { "op":"param",     "layerIndex":N, "effectMatchName":"BCC Cross Glitch",
//     "paramMatchName":"BCC Cross Glitch-10682374", "value":80 [, "effectIndex":I] }
//   { "op":"addEffect", "layerIndex":N, "effectMatchName":"PEDG" [, "name":"Deep Glow"] }
//
// usage:
//   apply:    node brownfield/apply_edit.mjs --spec=<spec.json> [--out=<dir>] [--label="..."]
//   rollback: node brownfield/apply_edit.mjs --rollback=<report.json>
// output: <out>/edit_<label>_report.json  +  _before.png / _after.png
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
const CMD = path.join(BRIDGE, 'ae_command.json');
const RES = path.join(BRIDGE, 'ae_mcp_result.json');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const outDir = path.resolve(arg('out', path.join(__dirname, 'dumps')));
fs.mkdirSync(outDir, { recursive: true });

// ---- bridge round-trip helper ----
async function runAE(script, timeoutMs = 120000) {
  fs.writeFileSync(RES, JSON.stringify({ status: 'waiting' }));
  fs.writeFileSync(CMD, JSON.stringify({ command: 'runScript', args: { script }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const c = JSON.parse(fs.readFileSync(CMD, 'utf8'));
      if (c.status === 'completed' || c.status === 'error') return JSON.parse(fs.readFileSync(RES, 'utf8'));
    } catch { /* mid-write */ }
  }
  throw new Error('TIMEOUT waiting for AE bridge (panel open + Auto-run on?)');
}

// Shared ExtendScript preamble: manual JSON encode + effect/param locators (ES3-safe, no JSON.stringify).
const PREAMBLE = String.raw`
  function esc(s){ return String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/[\r\n\t]/g,' '); }
  function jstr(s){ return '"' + esc(s) + '"'; }
  function jnum(v){ return (typeof v==='number' && isFinite(v)) ? String(v) : 'null'; }
  function jval(v){
    if (v === null || v === undefined) return 'null';
    if (v instanceof Array){ var a=[]; for (var i=0;i<v.length;i++) a.push(jval(v[i])); return '['+a.join(',')+']'; }
    var t = typeof v;
    if (t === 'number') return jnum(v);
    if (t === 'boolean') return v ? 'true' : 'false';
    return jstr(v);
  }
  function getComp(){ var c = app.project.activeItem; return (c && c instanceof CompItem) ? c : null; }
  // find an effect on a layer: by 1-based parade index if given (>0), else first-by-matchName.
  function findFx(L, matchName, idx){
    var parade = L.property("ADBE Effect Parade");
    if (!parade) return null;
    if (idx && idx > 0){ try { return parade.property(idx); } catch(e){ return null; } }
    for (var e=1; e<=parade.numProperties; e++){ if (parade.property(e).matchName === matchName) return parade.property(e); }
    return null;
  }
  // find a param inside an effect by matchName (deep — effect groups can nest).
  function findParam(fx, matchName){
    for (var p=1; p<=fx.numProperties; p++){
      var pr = fx.property(p);
      if (pr.matchName === matchName) return pr;
      if (pr.numProperties){ var deep = findParam(pr, matchName); if (deep) return deep; }
    }
    return null;
  }`;

function bail(msg) { console.error(msg); process.exit(1); }

// =========================== ROLLBACK MODE ===========================
const rollbackPath = arg('rollback', null);
if (rollbackPath) {
  const report = JSON.parse(fs.readFileSync(path.resolve(rollbackPath), 'utf8'));
  if (!report.inverse || !report.inverse.length) bail('report has no inverse ops — nothing to roll back');
  // apply inverse ops in REVERSE order so effect indices stay valid as removals happen.
  const inv = report.inverse.slice().reverse();
  const AEX = String.raw`(function(){
    ${PREAMBLE}
    var comp = getComp();
    if (!comp) return '{"err":"no active comp"}';
    var INV = ${JSON.stringify(inv)};
    var done = [];
    app.beginUndoGroup(${JSON.stringify('rollback: ' + (report.label || 'edit'))});
    try {
      for (var i=0;i<INV.length;i++){
        var op = INV[i];
        var L = comp.layer(op.layerIndex);
        if (op.op === 'param'){
          var fx = findFx(L, op.effectMatchName, op.effectIndex);
          if (!fx){ done.push('{"skip":"fx gone","'+'i":'+i+'}'); continue; }
          var pr = findParam(fx, op.paramMatchName);
          if (!pr){ done.push('{"skip":"param gone","i":'+i+'}'); continue; }
          pr.setValue(op.value);
          done.push('{"restored":'+jstr(op.paramMatchName)+',"to":'+jval(op.value)+'}');
        } else if (op.op === 'removeEffect'){
          var parade = L.property("ADBE Effect Parade");
          try { parade.property(op.effectIndex).remove(); done.push('{"removed_effect_at":'+op.effectIndex+'}'); }
          catch(e){ done.push('{"skip":"effect gone at '+op.effectIndex+'"}'); }
        }
      }
    } catch(e){ app.endUndoGroup(); return '{"err":'+jstr(String(e))+'}'; }
    app.endUndoGroup();
    return '{"ok":true,"undone":['+done.join(',')+']}';
  })();`;
  const res = await runAE(AEX);
  if (res.err) bail('rollback error: ' + res.err);
  console.log('rolled back:', JSON.stringify(res.undone || res, null, 0));
  console.log('(re-dump the comp to confirm the frame matches the BEFORE state)');
  process.exit(0);
}

// =========================== APPLY MODE ===========================
const specPath = arg('spec', null);
if (!specPath) bail('need --spec=<spec.json> (or --rollback=<report.json>)');
const spec = JSON.parse(fs.readFileSync(path.resolve(specPath), 'utf8'));
if (!spec.edits || !spec.edits.length) bail('spec has no edits[]');
const label = arg('label', spec.label || 'edit');
const safe = String(label).replace(/[^\w.-]+/g, '_');
const beforePng = path.join(outDir, `edit_${safe}_before.png`);
const afterPng = path.join(outDir, `edit_${safe}_after.png`);
const reportPath = path.join(outDir, `edit_${safe}_report.json`);

const AEX = String.raw`(function(){
  ${PREAMBLE}
  var comp = getComp();
  if (!comp) return '{"err":"no active comp (open the comp you want to edit)"}';
  var EDITS = ${JSON.stringify(spec.edits)};
  var BEFORE = new File("${beforePng.replace(/\\/g, '\\\\')}");
  var AFTER  = new File("${afterPng.replace(/\\/g, '\\\\')}");

  // BEFORE frame at the current playhead (F2: the live frame the edit is judged against)
  try { comp.saveFrameToPng(comp.time, BEFORE); } catch(e){}

  var applied = [], inverse = [];
  app.beginUndoGroup(${JSON.stringify('apply: ' + label)});
  try {
    for (var i=0;i<EDITS.length;i++){
      var ed = EDITS[i];
      var L = comp.layer(ed.layerIndex);
      if (ed.op === 'param'){
        var fx = findFx(L, ed.effectMatchName, ed.effectIndex);
        if (!fx){ applied.push('{"error":"effect not found","which":'+jstr(ed.effectMatchName)+'}'); continue; }
        var pr = findParam(fx, ed.paramMatchName);
        if (!pr){ applied.push('{"error":"param not found","which":'+jstr(ed.paramMatchName)+'}'); continue; }
        var oldV; try { oldV = pr.value; } catch(eV){ oldV = null; }
        pr.setValue(ed.value);
        var newV; try { newV = pr.value; } catch(eN){ newV = ed.value; }
        applied.push('{"op":"param","layer":'+ed.layerIndex+',"param":'+jstr(ed.paramMatchName)+',"old":'+jval(oldV)+',"new":'+jval(newV)+'}');
        inverse.push('{"op":"param","layerIndex":'+ed.layerIndex+',"effectMatchName":'+jstr(ed.effectMatchName)+',"effectIndex":'+(ed.effectIndex||0)+',"paramMatchName":'+jstr(ed.paramMatchName)+',"value":'+jval(oldV)+'}');
      } else if (ed.op === 'addEffect'){
        var parade = L.property("ADBE Effect Parade");
        if (!parade || !parade.canAddProperty(ed.effectMatchName)){ applied.push('{"error":"cannot add effect","which":'+jstr(ed.effectMatchName)+'}'); continue; }
        var neweff = parade.addProperty(ed.effectMatchName);
        if (ed.name){ try { neweff.name = ed.name; } catch(eNm){} }
        var newIdx = parade.numProperties;   // added at the end
        applied.push('{"op":"addEffect","layer":'+ed.layerIndex+',"effect":'+jstr(ed.effectMatchName)+',"index":'+newIdx+'}');
        inverse.push('{"op":"removeEffect","layerIndex":'+ed.layerIndex+',"effectIndex":'+newIdx+'}');
      } else {
        applied.push('{"error":"unknown op","op":'+jstr(String(ed.op))+'}');
      }
    }
  } catch(e){ app.endUndoGroup(); return '{"err":'+jstr(String(e))+'}'; }
  app.endUndoGroup();

  // AFTER frame at the same playhead
  try { comp.saveFrameToPng(comp.time, AFTER); } catch(e){}

  return '{"ok":true,"comp":'+jstr(comp.name)+',"time":'+jnum(comp.time)+
         ',"applied":['+applied.join(',')+'],"inverse":['+inverse.join(',')+']}';
})();`;

const res = await runAE(AEX);
if (res.err) bail('apply error: ' + res.err);

const report = {
  label, comp: res.comp, time: res.time,
  spec: spec.edits,
  applied: res.applied,
  inverse: res.inverse,
  beforePng: path.relative(REPO, beforePng),
  afterPng: path.relative(REPO, afterPng),
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

// ---- summary ----
console.log(`edit "${label}" on comp "${res.comp}" @ t=${res.time}s`);
for (const a of res.applied) {
  if (a.error) console.log(`  ✗ ${a.error}: ${a.which || a.op || ''}`);
  else if (a.op === 'param') console.log(`  ~ param ${a.param} on layer ${a.layer}: ${JSON.stringify(a.old)} → ${JSON.stringify(a.new)}`);
  else if (a.op === 'addEffect') console.log(`  + effect ${a.effect} on layer ${a.layer} (parade idx ${a.index})`);
}
const errs = res.applied.filter(a => a.error).length;
console.log(`\nbefore → ${report.beforePng}`);
console.log(`after  → ${report.afterPng}`);
console.log(`report → ${path.relative(REPO, reportPath)}`);
console.log(errs ? `\n⚠ ${errs} edit(s) failed — inspect before accepting.` : `\naccept: keep as-is.  rollback: node brownfield/apply_edit.mjs --rollback=${path.relative(REPO, reportPath)}`);
