// observer.mjs — passive, READ-ONLY session observer for the brownfield-perception dataset.
//
// Periodically snapshots AE state through the bridge and logs STATE DIFFS:
//   - layers / effects added or removed in the active comp
//   - the properties currently selected in the timeline/ECW + their values
//     (≈ "which knobs the artist is turning right now" — the highest-signal trace)
// Raw diffs capture the ACTION side of "(state, intent) → action" triples; attach the
// INTENT side with `--note` while working, or let the agent read the log after a session
// and back-fill labels by asking a few questions.
//
// Guardrails: every ExtendScript sent is strictly read-only (never creates/closes/saves
// anything); a tick is SKIPPED if the bridge is busy; slow ticks auto-double the interval.
// Do NOT run at the same time as the recipe runner / validation batches — one bridge.
//
// usage: node observe/observer.mjs [--interval=90] [--session=name]
//        node observe/observer.mjs --note "调一个烟雾拖尾，想要更绵密"   (append an intent label)
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
const CMD = path.join(BRIDGE, 'ae_command.json');
const RES = path.join(BRIDGE, 'ae_mcp_result.json');
const OBS = path.join(__dirname, 'observations');
fs.mkdirSync(OBS, { recursive: true });

const flag = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] || d;
const session = flag('session', new Date().toISOString().slice(0, 10));
const LOG = path.join(OBS, `session_${session}.jsonl`);
const append = o => fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');

// ---- note mode: label the current stretch of work with intent ----
const noteIdx = process.argv.indexOf('--note');
if (noteIdx > -1) {
  const note = process.argv[noteIdx + 1] || '';
  if (!note) { console.error('usage: node observer.mjs --note "text"'); process.exit(1); }
  append({ type: 'note', note });
  console.log(`noted -> ${LOG}`);
  process.exit(0);
}

let intervalSec = Number(flag('interval', 90));

// READ-ONLY snapshot: active comp structure + selected properties. Other comps: names only.
const SNAP = String.raw`(function () {
  var esc = function (s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\"'); };
  try {
    var comps = [];
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem) comps.push('"' + esc(it.name) + '"');
    }
    var active = 'null', sel = [];
    var ai = app.project.activeItem;
    if (ai instanceof CompItem) {
      var layers = [];
      var maxL = Math.min(ai.numLayers, 80);
      for (var L = 1; L <= maxL; L++) {
        var ly = ai.layer(L), fx = [];
        try {
          var eff = ly.property("ADBE Effect Parade");
          if (eff) for (var e = 1; e <= Math.min(eff.numProperties, 20); e++) fx.push('"' + esc(eff.property(e).matchName) + '"');
        } catch (e1) {}
        layers.push('{"n":"' + esc(ly.name) + '","fx":[' + fx.join(",") + ']' + (ly.selected ? ',"sel":1' : '') + '}');
      }
      // selected properties = the knobs being touched
      try {
        var sp = ai.selectedProperties;
        for (var s = 0; s < Math.min(sp.length, 24); s++) {
          var p = sp[s];
          if (p.propertyType !== PropertyType.PROPERTY) continue;
          var v = "";
          try { v = String(p.value).substring(0, 40); } catch (e2) { v = "<no value>"; }
          sel.push('{"m":"' + esc(p.matchName) + '","name":"' + esc(p.name) + '","v":"' + esc(v) + '"}');
        }
      } catch (e3) {}
      active = '{"name":"' + esc(ai.name) + '","time":' + ai.time.toFixed(2) + ',"layers":[' + layers.join(",") + ']}';
    }
    var pf = "untitled";
    try { if (app.project.file) pf = app.project.file.name; } catch (e4) {}
    return '{"status":"ok","proj":"' + esc(pf) + '","comps":[' + comps.join(",") + '],"active":' + active + ',"selProps":[' + sel.join(",") + ']}';
  } catch (err) {
    return '{"status":"error","message":"' + esc(String(err)) + '"}';
  }
})();`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function bridgeBusy() {
  try {
    const c = JSON.parse(fs.readFileSync(CMD, 'utf8'));
    if (c.status !== 'pending') return false;
    // a command left 'pending' >2min means AE died mid-execution — stale, doesn't block us
    return (Date.now() - new Date(c.timestamp).getTime()) < 120000;
  } catch { return false; }
}

// ---- self-healing across AE crashes / manual restarts ----
const AE_PROC = 'After Effects 2022.app/Contents/MacOS/After Effects';
const PANEL = '/Applications/Adobe After Effects 2022/Scripts/ScriptUI Panels/mcp-bridge-auto.jsx';
const aePid = () => {
  const r = spawnSync('pgrep', ['-f', AE_PROC], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n')[0] : null;
};
const launchPanel = () =>
  spawnSync('osascript', ['-e', `tell application "Adobe After Effects 2022" to DoScriptFile "${PANEL}"`], { timeout: 15000 }).status === 0;

let lastGoodPid = null;

// Distinguish CRASH-RESTART (pid changed -> palette is gone, re-inject it) from a merely
// BUSY AE (same pid -> the palette is alive; injecting again would open a SECOND poller
// that double-executes commands — never do that). Blocks until the bridge answers again.
async function heal() {
  append({ type: 'bridge_down', ae_pid: aePid(), last_good_pid: lastGoodPid });
  console.log(`[${new Date().toLocaleTimeString()}] bridge down — healing (waiting for AE)…`);
  let samePidRetries = 0;
  while (true) {
    const pid = aePid();
    if (!pid) { await sleep(15000); continue; }              // AE gone — wait for manual relaunch
    if (pid !== lastGoodPid) {
      await sleep(20000);                                    // boot grace: plugins loading
      launchPanel();
      await sleep(6000);
    } else if (++samePidRetries >= 6) {
      // same pid but silent for ~2min+ — maybe the user closed the palette; one re-inject
      append({ type: 'heal_reinject_same_pid' });
      launchPanel();
      await sleep(6000);
      samePidRetries = 0;
    }
    const s = await snapshot(20);
    if (s?.status === 'ok') {
      lastGoodPid = pid;
      append({ type: 'bridge_healed', ae_pid: pid });
      console.log(`[${new Date().toLocaleTimeString()}] bridge healed (AE pid ${pid}).`);
      return s;
    }
    await sleep(20000);
  }
}

async function snapshot(timeoutSec = 20) {
  fs.writeFileSync(RES, JSON.stringify({ status: 'waiting' }));
  fs.writeFileSync(CMD, JSON.stringify({ command: 'runScript', args: { script: SNAP }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    await sleep(1000);
    try {
      const c = JSON.parse(fs.readFileSync(CMD, 'utf8'));
      if (c.status === 'completed' || c.status === 'error') return JSON.parse(fs.readFileSync(RES, 'utf8'));
    } catch { /* mid-write */ }
  }
  return null;
}

// ---- diff engine ----
const layerKey = l => `${l.n}::${(l.fx || []).join(',')}`;
function diff(prev, cur) {
  const d = {};
  if (!prev || prev.proj !== cur.proj) d.project = cur.proj;
  const pa = prev?.active, ca = cur.active;
  if ((pa?.name || null) !== (ca?.name || null)) d.activeComp = ca?.name || null;
  if (pa && ca && pa.name === ca.name) {
    const pm = new Map(pa.layers.map(l => [l.n, l])), cm = new Map(ca.layers.map(l => [l.n, l]));
    const added = ca.layers.filter(l => !pm.has(l.n)).map(l => ({ n: l.n, fx: l.fx }));
    const removed = pa.layers.filter(l => !cm.has(l.n)).map(l => l.n);
    const fxChanged = ca.layers.filter(l => pm.has(l.n) && layerKey(pm.get(l.n)) !== layerKey(l))
      .map(l => ({ n: l.n, fx_before: pm.get(l.n).fx, fx_after: l.fx }));
    if (added.length) d.layersAdded = added;
    if (removed.length) d.layersRemoved = removed;
    if (fxChanged.length) d.effectsChanged = fxChanged;
  }
  // selected-property value trace (dedup identical consecutive)
  const ps = JSON.stringify(prev?.selProps || []), cs = JSON.stringify(cur.selProps || []);
  if (cs !== ps && (cur.selProps || []).length) d.selProps = cur.selProps;
  return Object.keys(d).length ? d : null;
}

// ---- main loop ----
console.log(`observer up: interval ${intervalSec}s, log -> ${LOG}`);
console.log('label intent anytime:  node observe/observer.mjs --note "<what you are trying to do>"');
append({ type: 'session_start', interval: intervalSec });
let prev = null, ticks = 0;

const bye = sig => { append({ type: 'session_end', sig }); console.log('\nobserver stopped.'); process.exit(0); };
process.on('SIGINT', () => bye('SIGINT'));
process.on('SIGTERM', () => bye('SIGTERM'));

let failStreak = 0;
while (true) {
  if (bridgeBusy()) { await sleep(5000); continue; }   // someone else is using the bridge — stay out
  const t0 = Date.now();
  let snap = await snapshot();
  const took = Date.now() - t0;
  if (!snap || snap.status !== 'ok') {
    if (++failStreak >= 2) { snap = await heal(); failStreak = 0; }
    else { await sleep(10000); continue; }
  }
  failStreak = 0;
  ticks++;
  lastGoodPid = lastGoodPid || aePid();
  const d = diff(prev, snap);
  if (d) { append({ type: 'diff', ...d }); console.log(`[${new Date().toLocaleTimeString()}] diff:`, Object.keys(d).join(', ')); }
  if (ticks % 10 === 1) append({ type: 'snapshot', snap });   // periodic full state for reconstruction
  prev = snap;
  if (took > 2000 && intervalSec < 600) { intervalSec *= 2; console.log(`slow tick (${took}ms) — backing off to ${intervalSec}s`); }
  await sleep(intervalSec * 1000);
}
