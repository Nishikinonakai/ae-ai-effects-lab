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
// Five ops (create-vs-modify pair + expression generation, PRD §八 D; textContent + addLayer added
// 2026-07-21 after the artist's adversarial dogfooding hit both gaps in one evening — log §F):
//   { "op":"param",      "layerIndex":N, "effectMatchName":"BCC Cross Glitch",
//     "paramMatchName":"BCC Cross Glitch-10682374", "value":80 [, "effectIndex":I] }
//       · STATIC param → setValue(value).
//       · KEYFRAMED param (finding #2 — real look-params are animated) → needs a keyframe mode:
//         "keyframeMode":"scale"     → value is a FACTOR; multiplies every keyframe (envelope +
//                                      ease preserved). Default when value is numeric.
//         "keyframeMode":"setAtTime" → value is ABSOLUTE; sets/adds a key at the current playhead.
//         Inverse restores the exact prior keyframe state either way.
//   { "op":"addEffect",  "layerIndex":N, "effectMatchName":"PEDG" [, "name":"Deep Glow"] }
//   { "op":"expression", "layerIndex":N, "target":"position"|"scale"|"rotation"|"opacity"|"anchor"
//     (or "propertyPath":["ADBE Effect Parade","<fx>",...]), "expression":"...AE expr..." }
//     — inverse restores the prior expression text + enabled state (empty text clears it).
//   { "op":"textContent", "layerIndex":N, "text":"replacement string" }
//     — whole-string replacement of a TEXT layer's source text via TextDocument round-trip (the
//       same document object is mutated and set back, so font/size/tracking survive). Keyframed or
//       expression-driven source text is REFUSED, not guessed at. Inverse restores the old string.
//   { "op":"addLayer", "kind":"solid"|"adjustment" [,"name":"..."] [,"color":[r,g,b] 0..1] }
//     — a NEW full-comp layer at the TOP, so a generative ask gets its own canvas instead of
//       painting on whichever existing layer looked least wrong (the snow-on-a-lyric-precomp
//       failure). INDEXING CONVENTION: layers keep their PERCEPTION indices in later edits of the
//       same spec — this tool re-maps them (+1 per layer added so far); the new layer itself is
//       addressed as layerIndex 0. Inverse removes the layer by its stable AE id, plus its solid
//       source item when nothing else uses it (a rollback must not leave orphans in the bin).
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
  // opaque-core registry (shared vocabulary with dump_comp): editing params on these effects may be
  // BLUFFING — the load-bearing state (matte/solve/scene) isn't in params, so a "finishing" edit does
  // nothing until the user has performed the handoff. We don't hard-refuse (pre-staging propagation/
  // analysis settings IS legitimate), but we flag it loudly so the caller verifies the gate.
  function opaqueGate(mn){
    if (mn === "ADBE Samurai") return "Roto Brush: matte lives outside params. A finishing edit is INERT until the user has painted+propagated. Pre-staging propagation settings is OK; verify a matte exists before trusting refine knobs.";
    if (mn === "ADBE 3D Tracker") return "3D Tracker: the solve isn't scriptable. Pre-staging analysis settings is OK; the RESULT is the extracted Camera/Null layers (drive those), not these params.";
    if (mn === "ADBE FreePin3") return "Puppet: pins must be placed by the user first; once they exist their motion is in-params.";
    if (mn === "VIDEOCOPILOT 3DArray") return "Element 3D: all controls are INERT until a scene is built in the modal Scene Setup.";
    return null;
  }
  // scale a keyframe value by a factor — scalar or per-component (position/color/etc.)
  function mulVal(v, f){ if (v instanceof Array){ var a=[]; for (var i=0;i<v.length;i++) a.push(v[i]*f); return a; } return v*f; }
  // A key's full "shape": interpolation TYPE (hold/linear/bezier, in+out) AND temporal ease
  // (speed+influence per dimension). setValueAtTime resets both when it overwrites a key, so we
  // capture the shape and restore it — otherwise a rolled-back HOLD/stepped key silently becomes a
  // smooth bezier ramp (adversarial-review finding #1/#2; HOLD keys are idiomatic in glitch work).
  function interpTok(t){ if (t === KeyframeInterpolationType.HOLD) return "hold"; if (t === KeyframeInterpolationType.LINEAR) return "linear"; return "bezier"; }
  function interpEnum(tok){ if (tok === "hold") return KeyframeInterpolationType.HOLD; if (tok === "linear") return KeyframeInterpolationType.LINEAR; return KeyframeInterpolationType.BEZIER; }
  function grabShape(pr, idx){
    var o = { inI:"bezier", outI:"bezier", inE:null, outE:null };
    try { o.inI = interpTok(pr.keyInInterpolationType(idx)); o.outI = interpTok(pr.keyOutInterpolationType(idx)); } catch(e){}
    try {
      var ie = pr.keyInTemporalEase(idx), oe = pr.keyOutTemporalEase(idx);
      o.inE = []; for (var z=0; z<ie.length; z++) o.inE.push([ie[z].speed, ie[z].influence]);
      o.outE = []; for (var z2=0; z2<oe.length; z2++) o.outE.push([oe[z2].speed, oe[z2].influence]);
    } catch(e){ o.inE = null; o.outE = null; }
    return o;
  }
  function shapeJson(o){
    function arr(a){ if (a == null) return 'null'; var s=[]; for (var i=0;i<a.length;i++) s.push('['+a[i][0]+','+a[i][1]+']'); return '['+s.join(',')+']'; }
    return '{"inI":'+jstr(o.inI)+',"outI":'+jstr(o.outI)+',"inE":'+arr(o.inE)+',"outE":'+arr(o.outE)+'}';
  }
  // restore a key's shape: interp TYPE always; temporal ease ONLY when both ends are bezier (setting
  // ease forces bezier, which would clobber a restored hold/linear). Guarded/no-op on failure.
  function applyShape(pr, idx, s){
    if (!s) return false;
    try { pr.setInterpolationTypeAtKey(idx, interpEnum(s.inI), interpEnum(s.outI)); } catch(e){}
    if (s.inI === "bezier" && s.outI === "bezier" && s.inE && s.outE){
      try {
        var ia=[], oa=[];
        for (var i=0;i<s.inE.length;i++) ia.push(new KeyframeEase(s.inE[i][0], s.inE[i][1]));
        for (var j=0;j<s.outE.length;j++) oa.push(new KeyframeEase(s.outE[j][0], s.outE[j][1]));
        pr.setTemporalEaseAtKey(idx, ia, oa);
      } catch(e){ return false; }
    }
    return true;
  }
  // find an effect on a layer: by 1-based parade index if given (>0), else first-by-matchName.
  // Resolve an effect to a SPECIFIC parade slot, and report which slot it was.
  //
  // The old version returned the first matchName match and told nobody which one that was. On a
  // layer carrying two Glows — routine in a real comp; the KillKiss lyric twins are exactly that —
  // every edit bound to instance 1, and because the inverse recorded the caller's (absent) index as
  // 0, ROLLBACK ALSO bound to instance 1. An edit aimed at the second Glow would therefore be undone
  // by overwriting the first one: a param the product never intended to touch, changed with no
  // record. Rollback correctness is the safety property this whole tool exists to provide.
  //
  // So: ambiguity is now refused rather than guessed, and the resolved index is returned for the
  // inverse to record.
  function findFxAt(L, matchName, idx){
    var parade = L.property("ADBE Effect Parade");
    if (!parade) return { fx: null, at: 0, err: "layer has no effects" };
    if (idx && idx > 0){
      try {
        var pinned = parade.property(idx);
        if (pinned && pinned.matchName !== matchName) return { fx: null, at: 0, err: "effectIndex " + idx + " holds " + pinned.matchName + ", not " + matchName };
        return { fx: pinned, at: idx };
      } catch(e){ return { fx: null, at: 0, err: "no effect at index " + idx }; }
    }
    var hits = [];
    for (var e=1; e<=parade.numProperties; e++){ if (parade.property(e).matchName === matchName) hits.push(e); }
    if (!hits.length) return { fx: null, at: 0, err: "effect not found" };
    if (hits.length > 1) return { fx: null, at: 0, err: "AMBIGUOUS: " + hits.length + " instances of " + matchName + " on this layer (parade slots " + hits.join(",") + ") — pass effectIndex to say which" };
    return { fx: parade.property(hits[0]), at: hits[0] };
  }
  // back-compat shim for call sites that only want the effect
  function findFx(L, matchName, idx){ return findFxAt(L, matchName, idx).fx; }
  // find a param inside an effect by matchName (deep — effect groups can nest).
  function findParam(fx, matchName){
    for (var p=1; p<=fx.numProperties; p++){
      var pr = fx.property(p);
      if (pr.matchName === matchName) return pr;
      if (pr.numProperties){ var deep = findParam(pr, matchName); if (deep) return deep; }
    }
    return null;
  }
  // resolve the property an 'expression' op targets: either a named Transform target or an
  // explicit propertyPath (array of matchNames walked from the layer root).
  var XFORM = {
    position: ["ADBE Transform Group","ADBE Position"], scale: ["ADBE Transform Group","ADBE Scale"],
    rotation: ["ADBE Transform Group","ADBE Rotate Z"], opacity: ["ADBE Transform Group","ADBE Opacity"],
    anchor: ["ADBE Transform Group","ADBE Anchor Point"]
  };
  function resolveProp(L, ed){
    var pathArr = ed.propertyPath;
    if (!pathArr && ed.target && XFORM[ed.target]) pathArr = XFORM[ed.target];
    if (!pathArr) return null;
    var pr = L;
    for (var i=0;i<pathArr.length;i++){ try { pr = pr.property(pathArr[i]); } catch(e){ return null; } if (!pr) return null; }
    return pr;
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
          // guard: if the param gained keyframes since the edit, setValue throws — degrade to a
          // reported skip so ONE un-invertible op doesn't abort the whole rollback loop (finding #5).
          try { pr.setValue(op.value); done.push('{"restored":'+jstr(op.paramMatchName)+',"to":'+jval(op.value)+'}'); }
          catch(eRP){ done.push('{"skip":"setValue threw (now keyframed?)","i":'+i+'}'); }
        } else if (op.op === 'removeEffect'){
          var parade = L.property("ADBE Effect Parade");
          try { parade.property(op.effectIndex).remove(); done.push('{"removed_effect_at":'+op.effectIndex+'}'); }
          catch(e){ done.push('{"skip":"effect gone at '+op.effectIndex+'"}'); }
        } else if (op.op === 'textContent'){
          // inverse of a text replacement: write the recorded old string back the same way.
          var srcTr = null;
          try { srcTr = L.property("ADBE Text Properties").property("ADBE Text Document"); } catch(eTr){}
          if (!srcTr){ done.push('{"skip":"not a text layer","i":'+i+'}'); continue; }
          try {
            var tdr = srcTr.value;
            tdr.text = String(op.text);
            srcTr.setValue(tdr);
            done.push('{"restored_text_on_layer":'+op.layerIndex+'}');
          } catch(eTrs){ done.push('{"skip":"setValue threw","i":'+i+'}'); }
        } else if (op.op === 'removeLayerById'){
          // inverse of addLayer. The id survives every index shift; the solid's own footage item
          // goes too when nothing else uses it — a rollback must not leave orphans in the bin.
          // (comp.layerByID is absent in AE 22.6, so scan for the id by hand.)
          try {
            var Lr = null;
            for (var qr=1;qr<=comp.numLayers;qr++){ try { if (comp.layer(qr).id === op.id){ Lr = comp.layer(qr); break; } } catch(eQr){} }
            if (!Lr){ done.push('{"skip":"layer gone (id '+op.id+')"}'); continue; }
            var srcItem = null; try { srcItem = Lr.source; } catch(eSi){}
            Lr.remove();
            if (op.removeSource && srcItem){
              try { if (srcItem.usedIn.length === 0) srcItem.remove(); } catch(eRs){}
            }
            done.push('{"removed_layer_id":'+op.id+'}');
          } catch(eRL){ done.push('{"skip":"removeLayerById threw","i":'+i+'}'); }
        } else if (op.op === 'setExpression'){
          var xp = resolveProp(L, op);
          if (!xp){ done.push('{"skip":"prop gone","i":'+i+'}'); continue; }
          try {
            xp.expression = op.expression || '';                  // restore prior text (empty clears)
            if (xp.expression === '') { try { xp.expressionEnabled = false; } catch(eD){} }
            else { try { xp.expressionEnabled = op.enabled; } catch(eE2){} }
            done.push('{"restored_expr_on":'+jstr(op.target||String(op.propertyPath))+'}');
          } catch(e){ done.push('{"skip":"setExpr threw","i":'+i+'}'); }
        } else if (op.op === 'restoreKeyValues'){
          // inverse of param-scale: set each key's value back BY INDEX (ease/interp untouched).
          var fxr = findFx(L, op.effectMatchName, op.effectIndex);
          if (!fxr){ done.push('{"skip":"fx gone","i":'+i+'}'); continue; }
          var prr = findParam(fxr, op.paramMatchName);
          if (!prr){ done.push('{"skip":"param gone","i":'+i+'}'); continue; }
          if (prr.numKeys !== op.values.length){ done.push('{"skip":"key count changed ('+prr.numKeys+' vs '+op.values.length+')"}'); continue; }
          try { for (var vi=0; vi<op.values.length; vi++){ prr.setValueAtKey(vi+1, op.values[vi]); } done.push('{"restored_key_values":'+op.values.length+'}'); }
          catch(e){ done.push('{"skip":"restoreKeyValues threw","i":'+i+'}'); }
        } else if (op.op === 'restoreKeyAtTime'){
          // inverse of param-setAtTime: if we ADDED a key, remove it; if we OVERWROTE one, restore its
          // prior value AND full shape (interp type + ease — else a HOLD key returns as a bezier ramp).
          var fxa = findFx(L, op.effectMatchName, op.effectIndex);
          if (!fxa){ done.push('{"skip":"fx gone","i":'+i+'}'); continue; }
          var pra = findParam(fxa, op.paramMatchName);
          if (!pra){ done.push('{"skip":"param gone","i":'+i+'}'); continue; }
          try {
            var ai = pra.nearestKeyIndex(op.time);
            if (ai>=1 && ai<=pra.numKeys && Math.abs(pra.keyTime(ai)-op.time) < 1e-4){
              if (op.added){ pra.removeKey(ai); done.push('{"removed_added_key_at":'+op.time+'}'); }
              else {
                pra.setValueAtKey(ai, op.priorValue);
                if (op.shape){ applyShape(pra, ai, op.shape); }   // restore interp type + ease
                done.push('{"restored_key_at":'+op.time+'}');
              }
            } else { done.push('{"skip":"no key at t='+op.time+'"}'); }
          } catch(e){ done.push('{"skip":"restoreKeyAtTime threw","i":'+i+'}'); }
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

  var applied = [], inverse = [], gateWarns = [];
  // addLayer indexing: every layer added by THIS spec lands at the top and shifts the rest down,
  // so later edits keep using PERCEPTION indices and are re-mapped here (+addedLayers). The new
  // layer itself is layerIndex 0, resolved by its stable AE id — object references can go stale,
  // ids cannot.
  var addedLayers = 0, lastAddedId = 0;
  // comp.layerByID does NOT exist in AE 22.6 (later API) — measured live; layer.id does. A plain
  // scan works on every version that has ids at all, which is the whole point of id-addressing.
  function layerById(id){
    if (!id) return null;
    for (var q=1;q<=comp.numLayers;q++){ try { if (comp.layer(q).id === id) return comp.layer(q); } catch(eQ){} }
    return null;
  }
  function resolveLayer(idx){
    if (idx === 0) return layerById(lastAddedId);
    try { return comp.layer(idx + addedLayers); } catch(eRL2){ return null; }
  }
  app.beginUndoGroup(${JSON.stringify('apply: ' + label)});
  try {
    for (var i=0;i<EDITS.length;i++){
      var ed = EDITS[i];
      // addLayer is the one op that TARGETS no layer — it creates one. Resolving first and
      // bailing on null silently killed the whole branch on the first live run (the resolver got
      // layerIndex undefined); every other op still fails loudly here when its target is gone.
      var L = null;
      if (ed.op !== 'addLayer'){
        L = resolveLayer(ed.layerIndex);
        if (!L){ applied.push('{"error":"layer not found","which":'+jstr(String(ed.layerIndex))+'}'); continue; }
      }
      if (ed.op === 'param'){
        var res = findFxAt(L, ed.effectMatchName, ed.effectIndex);
        var fx = res.fx, fxAt = res.at;
        if (!fx){ applied.push('{"error":'+jstr(res.err || "effect not found")+',"which":'+jstr(ed.effectMatchName)+'}'); continue; }
        // opaque-core gate (spatial/ML): flag that this edit may be inert unless the user handoff is
        // done. Not a refuse — pre-staging is legit — but the caller must verify the gate.
        var gmsg = opaqueGate(fx.matchName);
        if (gmsg && !ed.gateAck){ gateWarns.push('{"layer":'+ed.layerIndex+',"effect":'+jstr(fx.matchName)+',"gate":'+jstr(gmsg)+'}'); }
        var pr = findParam(fx, ed.paramMatchName);
        if (!pr){ applied.push('{"error":"param not found","which":'+jstr(ed.paramMatchName)+'}'); continue; }
        // A value/keyframe edit under a LIVE expression has NO visible effect — the expression drives
        // the rendered output, not the keyframes. Refuse loudly rather than pretend-succeed (finding #6).
        var exprOn = false; try { exprOn = pr.expressionEnabled; } catch(eEx){}
        if (exprOn){ applied.push('{"error":"param is expression-driven - a value/keyframe edit has no visible effect (edit or clear the expression instead)","which":'+jstr(ed.paramMatchName)+'}'); continue; }
        var nk = 0; try { nk = pr.numKeys; } catch(eK){}
        if (nk === 0){
          // STATIC param — plain setValue; inverse restores the old value.
          var oldV; try { oldV = pr.value; } catch(eV){ oldV = null; }
          try { pr.setValue(ed.value); }
          catch(eSV){ applied.push('{"error":"setValue threw","detail":'+jstr(String(eSV))+'}'); continue; }
          var newV; try { newV = pr.value; } catch(eN){ newV = ed.value; }
          applied.push('{"op":"param","layer":'+ed.layerIndex+',"param":'+jstr(ed.paramMatchName)+',"old":'+jval(oldV)+',"new":'+jval(newV)+'}');
          inverse.push('{"op":"param","layerIndex":'+L.index+',"effectMatchName":'+jstr(ed.effectMatchName)+',"effectIndex":'+fxAt+',"paramMatchName":'+jstr(ed.paramMatchName)+',"value":'+jval(oldV)+'}');
        } else {
          // KEYFRAMED param (finding #2) — a plain setValue THROWS. Real look-params are animated,
          // so an edit MUST pick a keyframe-aware mode. NO default: 'value:100' is ambiguous between
          // "set to 100" and "×100 every key" — inferring the wrong one silently multiplies the whole
          // animation by 100 (adversarial-review finding #3). Require an explicit keyframeMode.
          var kmode = ed.keyframeMode || null;
          if (kmode === 'scale'){
            // Multiply EVERY keyframe value by ed.value (a FACTOR). Preserves the animation
            // envelope AND each key's ease/interp — setValueAtKey changes the value only, never
            // timing. Inverse restores the recorded original values BY INDEX (scale never changes
            // key count or order, so index alignment holds).
            var f = ed.value; var origVals = [];
            for (var ki=1; ki<=nk; ki++){ origVals.push(jval(pr.keyValue(ki))); }
            try { for (var kj=1; kj<=nk; kj++){ pr.setValueAtKey(kj, mulVal(pr.keyValue(kj), f)); } }
            catch(eSK){ applied.push('{"error":"scale keys threw","detail":'+jstr(String(eSK))+'}'); continue; }
            var vNow=null; try { vNow = pr.valueAtTime(comp.time, false); } catch(eVN){}
            applied.push('{"op":"param-scale","layer":'+ed.layerIndex+',"param":'+jstr(ed.paramMatchName)+',"factor":'+jnum(f)+',"numKeys":'+nk+',"valNowAfter":'+jval(vNow)+'}');
            inverse.push('{"op":"restoreKeyValues","layerIndex":'+L.index+',"effectMatchName":'+jstr(ed.effectMatchName)+',"effectIndex":'+fxAt+',"paramMatchName":'+jstr(ed.paramMatchName)+',"values":['+origVals.join(',')+']}');
          } else if (kmode === 'setAtTime'){
            // Overwrite (or add) a keyframe at the current playhead with ed.value (ABSOLUTE).
            // add-vs-overwrite is decided by the KEY COUNT before/after setValueAtTime — definitive,
            // vs a time-tolerance pre-check that a near-but-not-at key could fool (finding #4).
            // On overwrite, setValueAtTime resets the key's shape (interp type + ease), so capture the
            // prior SHAPE and re-apply it (accept keeps the envelope; only the value changed). Inverse:
            // overwrote → restore prior value + shape; added → remove the key.
            var t = comp.time;
            var nBefore = 0; try { nBefore = pr.numKeys; } catch(eNB){}
            // capture the shape of a pre-existing key AT ~t (only meaningful if we end up overwriting it)
            var prior=null, priorShape=null, ppre=0;
            try { ppre = pr.nearestKeyIndex(t); if (ppre>=1 && ppre<=nBefore && Math.abs(pr.keyTime(ppre)-t) < 1e-4){ prior = pr.keyValue(ppre); priorShape = grabShape(pr, ppre); } } catch(ePP){}
            try { pr.setValueAtTime(t, ed.value); }
            catch(eST){ applied.push('{"error":"setValueAtTime threw","detail":'+jstr(String(eST))+'}'); continue; }
            var nAfter = 0; try { nAfter = pr.numKeys; } catch(eNA){}
            var added = (nAfter > nBefore);            // count grew ⇒ a NEW key was created
            var ri = 0; try { ri = pr.nearestKeyIndex(t); } catch(eRI){}
            var keyAtT = (ri>=1 && Math.abs(pr.keyTime(ri)-t) < 1e-4);
            if (!added && keyAtT && priorShape){ try { applyShape(pr, ri, priorShape); } catch(eRA){} }   // restore overwritten key's shape
            applied.push('{"op":"param-setAtTime","layer":'+ed.layerIndex+',"param":'+jstr(ed.paramMatchName)+',"time":'+jnum(t)+',"added":'+(added?'true':'false')+'}');
            inverse.push('{"op":"restoreKeyAtTime","layerIndex":'+L.index+',"effectMatchName":'+jstr(ed.effectMatchName)+',"effectIndex":'+fxAt+',"paramMatchName":'+jstr(ed.paramMatchName)+',"time":'+jnum(t)+',"added":'+(added?'true':'false')+((!added && priorShape!==null)?',"priorValue":'+jval(prior)+',"shape":'+shapeJson(priorShape):'')+'}');
          } else {
            applied.push('{"error":"param is keyframed ('+nk+' keys) - set keyframeMode: scale|setAtTime","which":'+jstr(ed.paramMatchName)+'}');
          }
        }
      } else if (ed.op === 'addEffect'){
        var parade = L.property("ADBE Effect Parade");
        if (!parade || !parade.canAddProperty(ed.effectMatchName)){ applied.push('{"error":"cannot add effect","which":'+jstr(ed.effectMatchName)+'}'); continue; }
        var neweff = parade.addProperty(ed.effectMatchName);
        if (ed.name){ try { neweff.name = ed.name; } catch(eNm){} }
        var newIdx = parade.numProperties;   // added at the end
        applied.push('{"op":"addEffect","layer":'+ed.layerIndex+',"effect":'+jstr(ed.effectMatchName)+',"index":'+newIdx+'}');
        inverse.push('{"op":"removeEffect","layerIndex":'+L.index+',"effectIndex":'+newIdx+'}');
      } else if (ed.op === 'expression'){
        // GENERATE + APPLY an expression (PRD §八 D). Target = a Transform prop or an explicit
        // propertyPath. Record the prior expression + enabled state so rollback restores it exactly.
        var xp = resolveProp(L, ed);
        if (!xp){ applied.push('{"error":"property not found","which":'+jstr(ed.target||String(ed.propertyPath))+'}'); continue; }
        if (!xp.canSetExpression){ applied.push('{"error":"property takes no expression","which":'+jstr(ed.target||String(ed.propertyPath))+'}'); continue; }
        var oldExpr = ''; var oldEn = false;
        try { oldExpr = xp.expression; } catch(eX){}
        try { oldEn = xp.expressionEnabled; } catch(eEn){}
        try { xp.expression = ed.expression; }
        catch(eSet){ applied.push('{"error":"setExpression threw","detail":'+jstr(String(eSet))+'}'); continue; }
        applied.push('{"op":"expression","layer":'+ed.layerIndex+',"target":'+jstr(ed.target||String(ed.propertyPath))+',"had_expr":'+(oldEn?'true':'false')+'}');
        inverse.push('{"op":"setExpression","layerIndex":'+L.index+
          (ed.target?',"target":'+jstr(ed.target):',"propertyPath":'+jval(ed.propertyPath))+
          ',"expression":'+jstr(oldExpr)+',"enabled":'+(oldEn?'true':'false')+'}');
      } else if (ed.op === 'textContent'){
        // Whole-string replacement on a text layer. The TextDocument is mutated and set back, so
        // character styling rides along. Keyframed source text (per-key lyric switches are idiomatic
        // in this genre) and expression-driven text are REFUSED — a silent wrong guess on either
        // would rewrite an animation, not a string.
        var srcT = null;
        try { srcT = L.property("ADBE Text Properties").property("ADBE Text Document"); } catch(eT){}
        if (!srcT){ applied.push('{"error":"not a text layer","which":"layer '+ed.layerIndex+'"}'); continue; }
        var nkT = 0; try { nkT = srcT.numKeys; } catch(eTK){}
        if (nkT > 0){ applied.push('{"error":"sourceText is keyframed ('+nkT+' keys) - per-key text editing is not supported yet","which":"sourceText"}'); continue; }
        var exprT = false; try { exprT = srcT.expressionEnabled; } catch(eTE){}
        if (exprT){ applied.push('{"error":"sourceText is expression-driven - a text edit has no visible effect (edit or clear the expression instead)","which":"sourceText"}'); continue; }
        var oldTxt = "";
        try { oldTxt = String(srcT.value.text); } catch(eTV){}
        try {
          var td = srcT.value;
          td.text = String(ed.text);
          srcT.setValue(td);
        } catch(eTS){ applied.push('{"error":"setValue threw","detail":'+jstr(String(eTS))+'}'); continue; }
        applied.push('{"op":"textContent","layer":'+ed.layerIndex+',"old":'+jstr(oldTxt)+',"new":'+jstr(String(ed.text))+'}');
        inverse.push('{"op":"textContent","layerIndex":'+L.index+',"text":'+jstr(oldTxt)+'}');
      } else if (ed.op === 'addLayer'){
        var kind = (ed.kind === 'adjustment') ? 'adjustment' : 'solid';
        var col = (ed.color instanceof Array && ed.color.length >= 3) ? ed.color : (kind === 'adjustment' ? [1,1,1] : [0,0,0]);
        var lname = ed.name || (kind === 'adjustment' ? 'AI adjustment' : 'AI solid');
        var nl = null;
        try { nl = comp.layers.addSolid([col[0],col[1],col[2]], lname, comp.width, comp.height, 1, comp.duration); }
        catch(eAL){ applied.push('{"error":"addSolid threw","detail":'+jstr(String(eAL))+'}'); continue; }
        if (kind === 'adjustment'){ try { nl.adjustmentLayer = true; } catch(eAdj){} }
        addedLayers++;
        var lid = 0; try { lid = nl.id; } catch(eId){}
        lastAddedId = lid;
        applied.push('{"op":"addLayer","kind":'+jstr(kind)+',"name":'+jstr(lname)+',"index":'+nl.index+',"id":'+lid+'}');
        // removeSource: the solid's footage item was created FOR this layer; a rollback that leaves
        // it orphaned in the project bin is pollution, but an item something else also uses stays.
        inverse.push('{"op":"removeLayerById","id":'+lid+',"removeSource":true}');
      } else {
        applied.push('{"error":"unknown op","op":'+jstr(String(ed.op))+'}');
      }
    }
  } catch(e){ app.endUndoGroup(); return '{"err":'+jstr(String(e))+'}'; }
  app.endUndoGroup();

  // AFTER frame at the same playhead
  try { comp.saveFrameToPng(comp.time, AFTER); } catch(e){}

  return '{"ok":true,"comp":'+jstr(comp.name)+',"time":'+jnum(comp.time)+
         ',"applied":['+applied.join(',')+'],"inverse":['+inverse.join(',')+'],"gateWarns":['+gateWarns.join(',')+']}';
})();`;

const res = await runAE(AEX);
if (res.err) bail('apply error: ' + res.err);

// saveFrameToPng is ASYNC — the ExtendScript returns before the PNG finishes writing (a 4K frame
// takes ~12s). If we build the report / hand the frame to the scorer too early, it reads a
// half-written frame (bottom rows black) and the visual self-check FALSE-fails. So wait until each
// frame's size is STABLE across two reads before trusting it (resolution-agnostic — no fixed
// threshold works for 640x360 vs 4K). Surfaced by the KillKiss E2E (finding #3).
async function waitForFrameSettle(fp, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let prev = -1, stable = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 800));
    let sz = 0; try { sz = fs.statSync(fp).size; } catch { sz = 0; }
    if (sz > 0 && sz === prev) { if (++stable >= 2) return sz; }
    else stable = 0;
    prev = sz;
  }
  return -1;   // never settled — caller still gets a report, but the frame may be partial
}
const beforeSz = await waitForFrameSettle(beforePng);
const afterSz = await waitForFrameSettle(afterPng);
if (beforeSz < 0 || afterSz < 0) console.error('⚠ a frame did not finish writing in time — it may be partial; re-render before scoring.');

const report = {
  label, comp: res.comp, time: res.time,
  spec: spec.edits,
  applied: res.applied,
  inverse: res.inverse,
  gateWarns: res.gateWarns || [],
  beforePng: path.relative(REPO, beforePng),
  afterPng: path.relative(REPO, afterPng),
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

// ---- summary ----
console.log(`edit "${label}" on comp "${res.comp}" @ t=${res.time}s`);
for (const a of res.applied) {
  if (a.error) console.log(`  ✗ ${a.error}: ${a.which || a.op || ''}`);
  else if (a.op === 'param') console.log(`  ~ param ${a.param} on layer ${a.layer}: ${JSON.stringify(a.old)} → ${JSON.stringify(a.new)}`);
  else if (a.op === 'param-scale') console.log(`  ×${a.factor} scaled ${a.numKeys} keyframes of ${a.param} on layer ${a.layer} (value@now → ${JSON.stringify(a.valNowAfter)})`);
  else if (a.op === 'param-setAtTime') console.log(`  ⏱ keyframe on ${a.param} @ t=${a.time} layer ${a.layer}${a.added ? ' (added key)' : ' (overwrote existing key)'}`);
  else if (a.op === 'addEffect') console.log(`  + effect ${a.effect} on layer ${a.layer} (parade idx ${a.index})`);
  else if (a.op === 'expression') console.log(`  ƒ expression on layer ${a.layer} ${a.target}${a.had_expr ? ' (replaced prior)' : ''}`);
}
for (const g of (res.gateWarns || [])) console.log(`  ⟨GATE⟩ layer ${g.layer} ${g.effect}: ${g.gate}`);
const errs = res.applied.filter(a => a.error).length;
console.log(`\nbefore → ${report.beforePng}`);
console.log(`after  → ${report.afterPng}`);
console.log(`report → ${path.relative(REPO, reportPath)}`);
console.log(errs ? `\n⚠ ${errs} edit(s) failed — inspect before accepting.` : `\naccept: keep as-is.  rollback: node brownfield/apply_edit.mjs --rollback=${path.relative(REPO, reportPath)}`);
