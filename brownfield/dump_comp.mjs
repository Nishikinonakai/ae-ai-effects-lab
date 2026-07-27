// dump_comp.mjs — live-comp PERCEPTION primitive for the brownfield edit protocol.
//
// Reads the ACTIVE composition through the AE file bridge and emits a structured snapshot of
// its current state — the input the agent reasons over to decide CREATE-vs-MODIFY, which layer,
// and where in the stack. Captures three things at once, per the product's brownfield thesis:
//   1) structure  — every layer: name, type, inferred ROLE, enabled, 3D, blend, matte, parent
//   2) config     — each effect's matchName + name + ACTUAL param values (+ expressions/curves)
//   3) visual     — the rendered current frame (saveFrameToPng)
// so the model sees WHAT is there, HOW it's configured, and what it LOOKS like — together.
//
// usage: node brownfield/dump_comp.mjs [--out=<dir>] [--maxparams=400]
// output: <out>/<comp>_state.json  +  <out>/<comp>_frame.png   (out defaults to brownfield/dumps)
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { waitForFrameSettle } from './frame_settle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
const CMD = path.join(BRIDGE, 'ae_command.json');
const RES = path.join(BRIDGE, 'ae_mcp_result.json');

const arg = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] || d;
const outDir = path.resolve(arg('out', path.join(__dirname, 'dumps')));
const maxParams = Number(arg('maxparams', 400));
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, '__state.json');   // final name set from comp name below
const framePath = path.join(outDir, '__frame.png');

// ---- ExtendScript: walk the active comp, write the JSON dump to a file, render the frame ----
// Manual JSON encoding (AE 2022 ExtendScript has no guaranteed JSON.stringify). CUSTOM_VALUE
// curves (over-life gradients) are noted, not serialized — they're not readable as scalars.
const AEX = String.raw`(function () {
  var MAXP = __MAXP__, OUTJSON = "__JSONPATH__", OUTPNG = "__PNGPATH__";
  function esc(s){ return String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/[\r\n\t]/g,' '); }
  function jstr(s){ return '"' + esc(s) + '"'; }
  function jval(v){
    if (v === null || v === undefined) return 'null';
    if (v instanceof Array){ var a=[]; for (var i=0;i<v.length;i++) a.push(jval(v[i])); return '['+a.join(',')+']'; }
    var t = typeof v;
    if (t === 'number') return (isFinite(v)? String(v) : 'null');
    if (t === 'boolean') return v ? 'true' : 'false';
    return jstr(v);
  }

  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) return '{"err":"no active composition (open a comp first)"}';

  // --- role inference: what IS this layer, for create-vs-modify reasoning ---
  function roleOf(L, isBottomEnabled, fxCount){
    try { if (L instanceof CameraLayer) return "camera"; } catch(e){}
    try { if (L instanceof LightLayer) return "light"; } catch(e){}
    try { if (L.nullLayer) return "null"; } catch(e){}
    try { if (L.adjustmentLayer) return "adjustment"; } catch(e){}   // grade/look layer — MODIFY target for "moodier"
    try { if (L instanceof TextLayer) return "text"; } catch(e){}
    try { if (L instanceof ShapeLayer) return "shape"; } catch(e){}
    try { if (L.trackMatteType && L.trackMatteType !== TrackMatteType.NO_TRACK_MATTE) return "matte-user"; } catch(e){}
    try {
      var src = L.source;
      if (src && src.mainSource && (src.mainSource.toString().indexOf("Solid") > -1)) {
        // a full-comp solid that CARRIES generative effects is producing the look = "generator",
        // not a passive backing. Only an effect-less bottom full-comp solid is a true "background".
        var full = (L.width >= comp.width && L.height >= comp.height);
        if (fxCount > 0) return full ? "generator" : "solid-fx";
        if (isBottomEnabled && full) return "background";
        return "solid";
      }
    } catch(e){}
    return fxCount > 0 ? "element-fx" : "element";   // has footage; effects on it = a treated element
  }

  // --- spatial/ML opaque-core registry: effects whose LOAD-BEARING state (matte/solve/mesh/scene)
  // is NOT in scriptable params, so the product must GATE (verify the state exists) before acting and
  // hand the create-step back to the user. See introspect/essence/ (spatial-ml cards). Only the
  // opaque-core classes are listed — Bezier Warp / Chroma Key are state-in-params, no gate needed.
  function spatialML(mn){
    if (mn === "ADBE Samurai") return '{"class":"ml-segmentation","opaque":"matte (strokes+ML propagation)","gate":"matte is not readable/writable via params — do NOT trust finishing knobs until the user has painted+propagated; then own the refine surface"}';
    if (mn === "ADBE 3D Tracker") return '{"class":"camera-solve","opaque":"solved camera + 3D point cloud","gate":"solve is not scriptable — ask the user to Analyze then Create Camera/Null; then drive the EXTRACTED layers"}';
    if (mn === "ADBE FreePin3") return '{"class":"mesh-deform","opaque":"ARAP mesh + pin instantiation","gate":"defer pin creation (place pins on the artwork); once pins exist their motion is fully in-params"}';
    if (mn === "VIDEOCOPILOT 3DArray") return '{"class":"3d-scene","opaque":"3D scene (models+materials)","gate":"all group/material controls are INERT until the user builds a scene in the modal Scene Setup + links model files"}';
    return null;
  }

  // --- one effect: matchName + name + enabled + ACTUAL leaf param values ---
  function dumpEffect(fx, fxIdx){
    var params = [], count = { n: 0 };
    function walk(prop){
      for (var i=1; i<=prop.numProperties; i++){
        if (count.n >= MAXP) return;
        var p = prop.property(i);
        var isGroup = false;
        try { isGroup = (p.numProperties && p.numProperties > 0 && p.propertyType === PropertyType.INDEXED_GROUP) || (p.numProperties > 0 && p.propertyValueType === undefined); } catch(e){}
        try { if (p.numProperties > 0) { walk(p); continue; } } catch(e){}
        // leaf property
        count.n++;
        var val = null, note = "";
        try {
          if (p.propertyValueType === PropertyValueType.NO_VALUE) { note = "novalue"; }
          else if (p.propertyValueType === PropertyValueType.CUSTOM_VALUE) { note = "curve"; }
          else { val = p.value; }
        } catch(e){ note = "unreadable"; }
        var expr = "";
        try { if (p.canSetExpression && p.expressionEnabled) expr = p.expression; } catch(e){}
        var mn = ""; try { mn = p.matchName; } catch(e){}
        var nm = ""; try { nm = p.name; } catch(e){}
        // numKeys: a param with keyframes is ANIMATED — the value above is only its value at
        // comp.time. The act layer needs this to route: a plain setValue THROWS on a keyframed
        // property, so an edit must use a keyframe-aware mode (scale keys / setValueAtTime). See
        // apply_edit.mjs (finding #2). Only emitted when >0 to keep the dump lean.
        var nk = 0; try { nk = p.numKeys; } catch(e){}
        params.push('{"matchName":'+jstr(mn)+',"name":'+jstr(nm)+',"value":'+jval(val)+
                    (nk>0?(',"numKeys":'+nk):'')+
                    (note?(',"note":'+jstr(note)):'')+(expr?(',"expr":'+jstr(expr)):'')+'}');
      }
    }
    walk(fx);
    var truncated = (count.n >= MAXP);
    var en = true; try { en = fx.enabled; } catch(e){}
    var sml = null; try { sml = spatialML(fx.matchName); } catch(eSm){}
    // paradeIndex: WHICH instance this is. Two Glows on one layer are routine in a real comp (the
    // lyric-twin structure in KillKiss is exactly that), and without this the planner cannot address
    // the second one even in principle — every edit, and every ROLLBACK, silently binds to the first.
    return '{"matchName":'+jstr(fx.matchName)+',"paradeIndex":'+fxIdx+',"name":'+jstr(fx.name)+',"enabled":'+(en?'true':'false')+
           (sml?',"opaqueCore":'+sml:'')+
           ',"paramCount":'+count.n+(truncated?',"truncated":true':'')+',"params":['+params.join(',')+']}';
  }

  var layers = [];
  var activeCount = 0;
  var missingLive = 0;
  var bottomEnabledIdx = -1;
  for (var b=comp.numLayers; b>=1; b--){ try { if (comp.layer(b).enabled) { bottomEnabledIdx = b; break; } } catch(e){} }

  for (var k=1; k<=comp.numLayers; k++){
    var L = comp.layer(k);
    var fxArr = [];
    try {
      var g = L.property("ADBE Effect Parade");
      if (g) for (var e=1; e<=g.numProperties; e++) fxArr.push(dumpEffect(g.property(e), e));
    } catch(eF){}
    var role = roleOf(L, k === bottomEnabledIdx, fxArr.length);
    var parent = null; try { if (L.parent) parent = L.parent.index; } catch(eP){}
    var bm = null; try { bm = L.blendingMode; } catch(eB){}
    var tm = null; try { tm = L.trackMatteType; } catch(eT){}
    var threeD = false; try { threeD = L.threeDLayer; } catch(e3){}
    var enabled = true; try { enabled = L.enabled; } catch(eE){}
    var inP = 0, outP = 0; try { inP = L.inPoint; outP = L.outPoint; } catch(eIO){}
    // activeNow = live at THIS frame: enabled + comp playhead inside the layer's in/out span.
    // The F2 fix — an edit must be verified against what's actually visible at comp.time, not
    // just what exists somewhere on the timeline (a layer trimmed out of the current frame is
    // "present" in the layer list but contributes nothing to the rendered result the model reasons over).
    var activeNow = false; try { activeNow = enabled && (comp.time >= inP - 1e-6) && (comp.time <= outP + 1e-6); } catch(eA){}
    if (activeNow) activeCount++;
    // sourceMissing = this layer's footage is OFFLINE — AE renders it as color-bar placeholder, so
    // any visual reasoning about this frame is UNRELIABLE (E2E finding #1: a copied .aep with broken
    // relative links rendered color bars). Flag it so the product warns instead of trusting the render.
    var sourceMissing = false;
    try { if (L.source && L.source.footageMissing) sourceMissing = true; } catch(eSM){}
    if (activeNow && sourceMissing) missingLive++;
    // text = a TEXT layer's current source string (truncated) — what makes "replace every X" and
    // "fix the typo in the chorus line" plannable at all: the planner must SEE which layer says
    // what. A [KEYFRAMED] tag warns it off layers whose text is animated per-key (apply_edit
    // refuses those rather than rewrite an animation).
    var txt = null;
    try {
      if (L instanceof TextLayer){
        var tdoc = L.property("ADBE Text Properties").property("ADBE Text Document");
        var ts = String(tdoc.value.text);
        txt = ts.length > 60 ? ts.substring(0,60) + "…" : ts;
        var tk = 0; try { tk = tdoc.numKeys; } catch(eTk){}
        if (tk > 0) txt += " [KEYFRAMED×" + tk + "]";
      }
    } catch(eTx){}
    layers.push('{"index":'+k+',"name":'+jstr(L.name)+',"role":'+jstr(role)+',"enabled":'+(enabled?'true':'false')+
                (txt!==null?',"text":'+jstr(txt):'')+
                ',"activeNow":'+(activeNow?'true':'false')+(sourceMissing?',"sourceMissing":true':'')+
                ',"threeD":'+(threeD?'true':'false')+',"blendMode":'+jval(bm)+',"trackMatte":'+jval(tm)+
                ',"parent":'+jval(parent)+',"in":'+jval(inP)+',"out":'+jval(outP)+
                ',"effectCount":'+fxArr.length+',"effects":['+fxArr.join(',')+']}');
  }

  var meta = '{"comp":'+jstr(comp.name)+',"width":'+comp.width+',"height":'+comp.height+
             ',"fps":'+comp.frameRate+',"duration":'+comp.duration+',"time":'+comp.time+
             ',"numLayers":'+comp.numLayers+',"activeCount":'+activeCount+',"missingLive":'+missingLive+',"layers":['+layers.join(',')+']}';

  try {
    var f = new File(OUTJSON);
    f.encoding = "UTF-8";
    f.open("w"); f.write(meta); f.close();
  } catch(eW){ return '{"err":"write failed: '+esc(String(eW))+'"}'; }

  try { comp.saveFrameToPng(comp.time, new File(OUTPNG)); } catch(eR){}

  return '{"ok":true,"comp":'+jstr(comp.name)+',"numLayers":'+comp.numLayers+',"json":'+jstr(OUTJSON)+',"png":'+jstr(OUTPNG)+'}';
})();`;

const script = AEX
  .replace('__MAXP__', String(maxParams))
  .replace('__JSONPATH__', jsonPath.replace(/\\/g, '\\\\'))
  .replace('__PNGPATH__', framePath.replace(/\\/g, '\\\\'));

fs.writeFileSync(RES, JSON.stringify({ status: 'waiting' }));
fs.writeFileSync(CMD, JSON.stringify({ command: 'runScript', args: { script }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));

const deadline = Date.now() + 120000;
let report = null;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1200));
  try { const c = JSON.parse(fs.readFileSync(CMD, 'utf8')); if (c.status === 'completed' || c.status === 'error') { report = JSON.parse(fs.readFileSync(RES, 'utf8')); break; } } catch { /* mid-write */ }
}
if (!report) { console.error('TIMEOUT waiting for AE bridge (panel open + Auto-run on?)'); process.exit(1); }
if (report.err) { console.error('AE error:', report.err); process.exit(1); }

// rename the generic files to comp-specific names
const safe = String(report.comp || 'comp').replace(/[^\w.-]+/g, '_');
const finalJson = path.join(outDir, `${safe}_state.json`);
const finalPng = path.join(outDir, `${safe}_frame.png`);
try { if (fs.existsSync(jsonPath)) fs.renameSync(jsonPath, finalJson); } catch {}
// saveFrameToPng is asynchronous. Existence is not readiness: a partially-written frame was
// observed with a changing hash and then failed zlib with "unexpected end of file". Use the same
// stable-size + terminal-IEND rule as apply_edit/temporal sampling before the planner or panel can
// see the file.
const frameSize = await waitForFrameSettle(framePath);
if (frameSize < 0) {
  console.error('FRAME TIMEOUT: AE did not finish writing the perception PNG; refusing a partial visual.');
  process.exit(1);
}
try { if (fs.existsSync(framePath)) fs.renameSync(framePath, finalPng); } catch {}

// print a compact summary the agent (or user) can read at a glance
try {
  const state = JSON.parse(fs.readFileSync(finalJson, 'utf8'));
  const live = state.activeCount != null ? state.activeCount : state.layers.filter(L => L.activeNow).length;
  console.log(`comp "${state.comp}"  ${state.width}x${state.height} @${state.fps}fps  t=${state.time}s  ${state.numLayers} layers (${live} live at this frame)`);
  if (state.missingLive > 0) console.log(`  ⚠ ${state.missingLive} LIVE layer(s) have MISSING footage → the rendered frame is a color-bar placeholder; do NOT trust visual reasoning about it.`);
  const gated = [];
  for (const L of state.layers) {
    const fx = L.effects.map(e => e.name + (e.enabled ? '' : ':off') + (e.opaqueCore ? ` ⟨opaque-core:${e.opaqueCore.class}⟩` : '')).join(', ');
    for (const e of L.effects) if (e.opaqueCore) gated.push({ layer: L.index, name: e.name, gate: e.opaqueCore.gate });
    // mark layers that exist but are trimmed out of / disabled at the current frame — the reasoning
    // layer should not attribute anything in the rendered frame to a non-live layer.
    const dead = L.activeNow === false ? (L.enabled ? ' ·trimmed-out' : ' (disabled)') : '';
    const miss = L.sourceMissing ? ' ⚠MISSING-FOOTAGE' : '';
    console.log(`  [${L.index}] ${L.name}  <${L.role}>${dead}${miss}${L.threeD ? ' 3D' : ''}${fx ? '  fx: ' + fx : ''}`);
  }
  if (gated.length) {
    console.log(`\n⟨GATE THE CORE⟩ ${gated.length} opaque-core effect(s) — verify state exists before acting; don't bluff it:`);
    for (const g of gated) console.log(`  layer ${g.layer} ${g.name}: ${g.gate}`);
  }
  console.log(`\nstate → ${path.relative(REPO, finalJson)}`);
  console.log(`frame → ${fs.existsSync(finalPng) ? path.relative(REPO, finalPng) : '(frame not ready)'}`);
} catch (e) {
  console.log('dump written:', finalJson, '| frame:', fs.existsSync(finalPng) ? finalPng : 'pending', '\n(summary parse skipped:', e.message + ')');
}
