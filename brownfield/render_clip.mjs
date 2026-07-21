// render_clip.mjs — render a short segment of the ACTIVE comp to a .mov, for the temporal judge.
//
// Tier C of the temporal fix (#13): frames can't show rhythm, a clip can. This renders through the
// render queue with STRICT HYGIENE, because the user's own queue is not ours to touch: every
// pre-existing item's render flag is snapshotted and disabled first, restored after, and our item
// is removed — measured on the artist's real project, whose queue held their 218s master render
// with willRender=true; a naive rq.render() would have started IT.
//
// Codec reality (measured 2026-07-21): scripting cannot choose a codec (om.getSettings STRING_
// SETTABLE exposes no format field), so this ships whatever "Lossless" is — Animation/qtrle, which
// modern AVFoundation cannot even DECODE (avconvert refuses). That is fine: the clip goes to
// Gemini via the Files API, whose decoder handles qtrle, so no local transcode exists at all.
// Resolution is dropped to Quarter when the render-settings dictionary allows it (best effort —
// smaller upload), and restored... not needed: settings are per-item and the item is removed.
//
// usage: node brownfield/render_clip.mjs --start=<sec> --dur=<sec> [--out=<dir>] [--label=x]
// output: <out>/clip_<label>.mov ; prints {"ok":true,"mov":...,"bytes":N} on stdout.
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
const start = Number(arg('start', 0));
// (the stale-cache twin of the overwrite fix below: a re-rendered clip must not be judged through
// the PREVIOUS clip's cached upload uri)
const dur = Math.max(0.2, Number(arg('dur', 1.6)));
const outDir = path.resolve(arg('out', path.join(__dirname, 'dumps')));
const label = String(arg('label', 'clip')).replace(/[^\w.-]+/g, '_');
fs.mkdirSync(outDir, { recursive: true });
const movPath = path.join(outDir, `clip_${label}.mov`);

async function runAE(script, timeoutMs = 180000) {
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

const AEX = `(function(){
  var step = "start";
  try {
    var proj = app.project, rq = proj.renderQueue;
    var comp = proj.activeItem;
    if (!comp || !(comp instanceof CompItem)) return '{"err":"no active comp"}';
    if (rq.rendering) return '{"err":"the render queue is already rendering - not touching it"}';
    step = "snapshot";
    var prior = [];
    for (var i=1;i<=rq.numItems;i++){ var it=rq.item(i); prior.push(it.render?1:0); try{ if(it.render) it.render=false; }catch(eD){} }
    step = "item";
    var rqi = rq.items.add(comp);
    var t0 = ${start}, td = ${dur};
    if (t0 < 0) t0 = comp.time;   // --start=-1 means "from the current playhead"
    if (t0 >= comp.duration) t0 = Math.max(0, comp.duration - td);
    if (t0 + td > comp.duration) td = Math.max(0.2, comp.duration - t0);
    rqi.timeSpanStart = t0;
    rqi.timeSpanDuration = td;
    // Quarter res when the settings dictionary permits — best effort, full res is only slower.
    try { rqi.setSettings({ "Resolution": "Quarter" }); } catch(eRS){}
    var om = rqi.outputModule(1);
    try { om.applyTemplate("Lossless"); } catch(eT){}
    // A pre-existing output file makes AE raise a MODAL overwrite confirmation at render time,
    // which wedges the whole bridge (measured live — the dialog sat over the artist's session).
    // Delete first; there is no dialog for a file that does not exist.
    try { var old = new File(${JSON.stringify(movPath)}); if (old.exists) old.remove(); } catch(eO){}
    om.file = new File(${JSON.stringify(movPath)});
    step = "render";
    rq.render();
    step = "restore";
    try { rqi.remove(); } catch(eR){}
    for (var j=1;j<=Math.min(rq.numItems, prior.length);j++){ try { rq.item(j).render = prior[j-1] === 1; } catch(eP){} }
    var f = new File(${JSON.stringify(movPath)});
    return '{"ok":true,"bytes":'+(f.exists?f.length:-1)+',"start":'+t0+',"dur":'+td+'}';
  } catch(e){
    try {
      for (var k=1;k<=rq.numItems;k++){ try { rq.item(k).render = prior && prior[k-1] === 1; } catch(eP2){} }
    } catch(e2){}
    return '{"err":"'+String(e).replace(/"/g,"'")+'","step":"'+step+'"}';
  }
})();`;

// stale-cache twin of the in-AE overwrite delete: a fresh render invalidates the uploaded copy
try { fs.unlinkSync(movPath + '.uri.json'); } catch { /* no cache — nothing to invalidate */ }
const res = await runAE(AEX);
if (res.err) { console.error('render_clip error: ' + res.err + (res.step ? ` (step ${res.step})` : '')); process.exit(1); }
if (!(res.bytes > 0)) { console.error('render produced no file'); process.exit(1); }
console.log(JSON.stringify({ ok: true, mov: path.relative(REPO, movPath), bytes: res.bytes, start: res.start, dur: res.dur }));
