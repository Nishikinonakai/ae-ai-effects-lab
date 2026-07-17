// validate_drafts.mjs — batch-validate all mined drafts through the bridge, one render each.
//
// For every draft in catalog.json: run it (idempotent comp per draft), record the param
// report + frame paths + timing into validation/results.jsonl. Resume-able (done slugs are
// skipped), robust to a stuck bridge:
//   - on timeout, SETTLE first (poll until AE finishes chewing) before sending the next
//     command — writing a new command while AE is mid-execution corrupts the file queue
//   - if stuck, try dismissing a plugin modal via System Events (best effort), settle again
//   - 3 consecutive stuck drafts → abort with exit 3 (re-run to resume)
//   - every 30 drafts the AE project is closed (comps are regenerable; keeps AE lean)
//
// usage: node mining/validate_drafts.mjs [--timeout=150] [--limit=N] [--only=slug1,slug2] [--drain=90]
//
// --drain=SEC (default 90): after each draft, if async frames are still missing, keep
// polling up to SEC more before starting the next draft. saveFrameToPng renders continue
// AFTER the script returns; starting the next draft on a saturated queue is what produced
// the r6 "render-hang" cascade (13 contiguous false fails). Late arrivals are recorded
// as ready — a slow frame is a slow frame, not a missing one.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { runRecipe } from '../runner/recipe_runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
const CMD = path.join(BRIDGE, 'ae_command.json');
const RES = path.join(BRIDGE, 'ae_mcp_result.json');

const flag = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] || d;
const timeoutSec = Number(flag('timeout', 150));
const drainSec = Number(flag('drain', 90));
const limit = Number(flag('limit', 0)) || Infinity;
const only = flag('only', '') ? new Set(flag('only', '').split(',')) : null;

const VAL = path.join(__dirname, 'validation');
const FRAMES = path.join(VAL, 'frames');
fs.mkdirSync(FRAMES, { recursive: true });
const RESULTS = path.join(VAL, 'results.jsonl');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8'));
const done = new Set(
  fs.existsSync(RESULTS)
    ? fs.readFileSync(RESULTS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).slug)
    : []
);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function settle(extraSec) {
  const deadline = Date.now() + extraSec * 1000;
  while (Date.now() < deadline) {
    await sleep(2000);
    try {
      const c = JSON.parse(fs.readFileSync(CMD, 'utf8'));
      if (c.status === 'completed' || c.status === 'error') return true;
    } catch { /* mid-write */ }
  }
  return false;
}

function tryDismissDialog() {
  const r = spawnSync('osascript', ['-e',
    'tell application "System Events" to tell (first process whose name contains "After Effects") to try\n' +
    'click button 1 of window 1\nend try'], { timeout: 10000 });
  return r.status === 0;
}

async function sendScript(script, sec) {
  fs.writeFileSync(RES, JSON.stringify({ status: 'waiting' }));
  fs.writeFileSync(CMD, JSON.stringify({ command: 'runScript', args: { script }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));
  const ok = await settle(sec);
  return ok ? fs.readFileSync(RES, 'utf8') : null;
}

const closeProject = () => sendScript('(function(){ app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); return "{\\"status\\":\\"done\\"}"; })();', 60);

let ran = 0, stuckStreak = 0;
const todo = catalog.presets.filter(p => {
  const slug = path.basename(p.draft, '.json');
  return !done.has(slug) && (!only || only.has(slug));
});
console.log(`validating ${Math.min(todo.length, limit)} of ${catalog.presets.length} drafts (${done.size} already done)`);

for (const entry of todo) {
  if (ran >= limit) break;
  const slug = path.basename(entry.draft, '.json');
  const draft = JSON.parse(fs.readFileSync(path.join(__dirname, entry.draft), 'utf8'));
  const outDir = path.join(FRAMES, slug);
  // pre-delete this run's target frames: a stale same-name PNG from an earlier round
  // satisfies the ready-poll INSTANTLY and the record/scoring reads old pixels
  for (const t of draft.renderFrames || []) {
    const fp = path.join(outDir, `${draft.name}_t${String(t).replace('.', 'p')}.png`);
    fs.rmSync(fp, { force: true });
  }
  const t0 = Date.now();
  let rec;
  try {
    const { report, frames } = await runRecipe(draft, { outDir, timeoutSec, frameTimeoutMs: 45000 });
    // drain: don't start the next draft while this one's async renders still grind
    const missing = frames.filter(f => !f.ready);
    if (missing.length && drainSec > 0) {
      const dEnd = Date.now() + drainSec * 1000;
      while (missing.some(f => !f.ready) && Date.now() < dEnd) {
        await sleep(2000);
        for (const f of missing) if (!f.ready && fs.existsSync(f.path) && fs.statSync(f.path).size > 0) f.ready = true;
      }
      if (missing.some(f => !f.ready)) console.log(`  ${slug}: frames still pending after +${drainSec}s drain — queue may be saturated`);
    }
    const okP = (report.params || []).filter(p => p.ok).length;
    rec = {
      slug, pack: entry.pack, category: entry.category,
      status: report.status,
      params_ok: okP, params_total: (report.params || []).length,
      failed: (report.params || []).filter(p => !p.ok).map(p => ({ p: p.p, err: (p.err || '').slice(0, 60) })),
      frames: frames.map(f => ({ path: path.relative(VAL, f.path), ready: f.ready })),
      thumb: entry.thumb,
      elapsed_s: Math.round((Date.now() - t0) / 1000),
    };
    stuckStreak = 0;
  } catch (e) {
    const settled = await settle(240);
    if (!settled) {
      tryDismissDialog();
      if (!(await settle(60))) {
        stuckStreak++;
        rec = { slug, pack: entry.pack, category: entry.category, status: 'stuck', elapsed_s: Math.round((Date.now() - t0) / 1000) };
        fs.appendFileSync(RESULTS, JSON.stringify(rec) + '\n');
        console.log(`  ${slug}: BRIDGE STUCK (streak ${stuckStreak})`);
        if (stuckStreak >= 3) { console.error('aborting: bridge stuck 3× — fix AE, then re-run to resume'); process.exit(3); }
        continue;
      }
    }
    stuckStreak = 0;
    rec = { slug, pack: entry.pack, category: entry.category, status: 'timeout_settled', elapsed_s: Math.round((Date.now() - t0) / 1000), thumb: entry.thumb };
  }
  fs.appendFileSync(RESULTS, JSON.stringify(rec) + '\n');
  console.log(`  [${done.size + ++ran}/${catalog.presets.length}] ${slug}: ${rec.status} ${rec.params_ok ?? '-'}/${rec.params_total ?? '-'} params, ${rec.elapsed_s}s`);

  if (ran % 30 === 0) { console.log('  -- closing project to keep AE lean --'); await closeProject(); }
}

console.log('\nbatch complete');
const all = fs.readFileSync(RESULTS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const by = {};
for (const r of all) by[r.status] = (by[r.status] || 0) + 1;
console.log('status counts:', JSON.stringify(by));
