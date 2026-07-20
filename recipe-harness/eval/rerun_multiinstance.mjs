// rerun_multiinstance.mjs — re-establish true scores for the plans the multi-instance bug corrupted.
//
// recipe_runner used to bind every spec of a matchName to the FIRST instance of it, so a plan asking
// for two Trapcode Particular systems silently rendered one. Four things in this repo do that:
// eval e17, e20, e22, and the shipped recipe native-portal-ring. Their recorded scores were produced
// by a comp that was missing half of what the plan asked for, so those numbers describe a render
// nobody intended and cannot be compared against anything.
//
// This re-renders each plan UNCHANGED against the fixed runner and re-scores it. Repeats are not
// optional — the measured within-arm sd of this scorer is 0.27-0.71 with +/-1 swings on identical
// input, so a single draw could not distinguish "the missing system mattered" from scorer variance.
//
// It also asserts the fix actually took, per plan: it counts the live instances of every duplicated
// matchName and refuses to report a score if the comp still has fewer than the plan asked for. A
// green number from a half-built comp is exactly the failure being repaired here.
//
// usage: node recipe-harness/eval/rerun_multiinstance.mjs [--repeats=5] [--model=<provider default>]
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.resolve(__dirname, '..');
const REPO = path.resolve(HARNESS, '..');
const RUNNER = path.join(HARNESS, 'runner', 'recipe_runner.mjs');
const SCORER = path.join(HARNESS, 'vision', 'gemini_score.mjs');
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const repeats = Number(arg('repeats', 5));
const model = arg('model', null);   // provider's own default; a name baked in here 404s the moment the credential changes
const outPath = path.resolve(arg('out', path.join(__dirname, 'rerun_multiinstance.json')));
const WORK = path.join(REPO, 'shell', 'out', 'rerun_mi');
fs.mkdirSync(WORK, { recursive: true });

async function runAE(script, timeoutMs = 60000) {
  fs.writeFileSync(path.join(BRIDGE, 'ae_mcp_result.json'), JSON.stringify({ status: 'waiting' }));
  fs.writeFileSync(path.join(BRIDGE, 'ae_command.json'), JSON.stringify({ command: 'runScript', args: { script }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 700));
    try {
      const c = JSON.parse(fs.readFileSync(path.join(BRIDGE, 'ae_command.json'), 'utf8'));
      if (c.status === 'completed') return fs.readFileSync(path.join(BRIDGE, 'ae_mcp_result.json'), 'utf8');
      if (c.status === 'error') return null;
    } catch { /* mid-write */ }
  }
  return null;
}

// Count live instances of a matchName in the comp the plan targets — the assertion that the fix took.
async function countInstances(compName, matchName) {
  const out = await runAE(`(function(){
    var c=null;
    for(var i=1;i<=app.project.numItems;i++){ var it=app.project.item(i);
      if(it instanceof CompItem && it.name===${JSON.stringify(compName)}){ c=it; break; } }
    if(!c) return "-1";
    var best=0;
    for(var L=1;L<=c.numLayers;L++){
      var g=null; try{ g=c.layer(L).property("ADBE Effect Parade"); }catch(e){}
      var n=0; if(g){ for(var e=1;e<=g.numProperties;e++){ try{ if(g.property(e).matchName===${JSON.stringify(matchName)}) n++; }catch(e2){} } }
      if(n>best) best=n;
    }
    return String(best);
  })()`);
  const n = Number(String(out || '').replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : -1;
}

// The plans, and where their recorded score came from.
const TARGETS = [
  { id: 'e17', plan: path.join(__dirname, 'plans', 'eval-e17.json'), loop: path.join(HARNESS, 'loop', 'eval-e17') },
  { id: 'e20', plan: path.join(__dirname, 'plans', 'eval-e20.json'), loop: path.join(HARNESS, 'loop', 'eval-e20') },
  { id: 'e22', plan: path.join(__dirname, 'plans_r2', 'e22.json'), loop: path.join(HARNESS, 'loop', 'eval-e22') },
  { id: 'portal-ring', plan: path.join(HARNESS, 'recipes', 'native', 'native-portal-ring.json'), loop: null },
];

const rows = [];
for (const t of TARGETS) {
  if (!fs.existsSync(t.plan)) { console.log(`${t.id}: plan missing — skipped`); continue; }
  const plan = JSON.parse(fs.readFileSync(t.plan, 'utf8'));
  const dup = {};
  for (const e of plan.effects || []) dup[e.matchName] = (dup[e.matchName] || 0) + 1;
  const duplicated = Object.entries(dup).filter(([, n]) => n > 1);

  // the score the corpus currently records, from the loop dir if there is one
  let oldBest = null;
  if (t.loop && fs.existsSync(path.join(t.loop, 'summary.json'))) {
    const its = JSON.parse(fs.readFileSync(path.join(t.loop, 'summary.json'), 'utf8')).iterations || [];
    if (its.length) oldBest = its.reduce((a, b) => (b.score > a.score ? b : a)).score;
  }

  const dir = path.join(WORK, t.id);
  fs.mkdirSync(dir, { recursive: true });
  const p2 = JSON.parse(JSON.stringify(plan));
  p2.compName = `MI_${t.id}`;                    // a fresh comp, so nothing stale is reused
  p2.name = `mi_${t.id}`;
  const planP = path.join(dir, 'plan.json');
  fs.writeFileSync(planP, JSON.stringify(p2, null, 2));

  process.stdout.write(`${t.id} (recorded ${oldBest ?? '?'}/10, plan wants ${duplicated.map(([m, n]) => `${n}x ${m}`).join(', ')}) … `);
  const r = spawnSync('node', [RUNNER, planP, '--timeout=300', `--outdir=${dir}`], { encoding: 'utf8', timeout: 480000 });
  const pngs = fs.readdirSync(dir).filter(f => f.endsWith('.png') && !f.includes('_score')).map(f => path.join(dir, f)).sort();
  if (pngs.length < 1) { console.log(`render produced no frames — ${(r.stdout || '').slice(-160)}`); rows.push({ id: t.id, error: 'no frames' }); continue; }

  // assert the fix took before trusting any number that follows
  const instances = {};
  let shortfall = false;
  for (const [mn, want] of duplicated) {
    const got = await countInstances(p2.compName, mn);
    instances[mn] = { want, got };
    if (got < want) shortfall = true;
  }
  if (shortfall) {
    console.log(`STILL SHORT: ${JSON.stringify(instances)} — not scoring a half-built comp`);
    rows.push({ id: t.id, oldBest, instances, error: 'instance shortfall' });
    continue;
  }
  process.stdout.write(`instances ok ${Object.entries(instances).map(([m, v]) => `${v.got}/${v.want}`).join(',')} `);

  // score it, reusing the stored review_request where one exists so intent/criteria are identical
  let req = null;
  if (t.loop) {
    const iters = fs.existsSync(t.loop) ? fs.readdirSync(t.loop).filter(d => /^iter\d+$/.test(d)).sort() : [];
    for (const it of iters) {
      const rp = path.join(t.loop, it, 'review_request.json');
      if (fs.existsSync(rp)) { req = JSON.parse(fs.readFileSync(rp, 'utf8')); break; }
    }
  }
  if (!req) req = { intent: plan.intent || plan.name, pass_criteria: plan.pass_criteria || [], iteration: 1, max_iters: 1, plan: { effects: plan.effects }, prior_iterations: [], review_instructions: '' };
  req.frames = pngs;
  req.prior_iterations = [];
  const reqP = path.join(dir, 'review_request.json');
  fs.writeFileSync(reqP, JSON.stringify(req, null, 2));

  const scores = [];
  for (let k = 0; k < repeats; k++) {
    const s = spawnSync('node', [SCORER, reqP, ...(model ? [`--model=${model}`] : [])], { encoding: 'utf8', timeout: 300000 });
    const revP = path.join(dir, 'review.json');
    if (s.status !== 0 || !fs.existsSync(revP)) continue;
    const rev = JSON.parse(fs.readFileSync(revP, 'utf8'));
    fs.copyFileSync(revP, path.join(dir, `review_${k + 1}.json`));
    scores.push(rev.score);
  }
  if (!scores.length) { console.log('all scoring attempts failed'); rows.push({ id: t.id, oldBest, instances, error: 'scoring failed' }); continue; }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, scores.length - 1));
  const row = { id: t.id, oldBest, instances, scores, mean: +mean.toFixed(2), sd: +sd.toFixed(2), frames: pngs.map(p => path.basename(p)) };
  console.log(` → ${row.mean}±${row.sd} [${scores.join(',')}]`);
  rows.push(row);
  fs.writeFileSync(outPath, JSON.stringify({ _date: new Date().toISOString().slice(0, 10), model, repeats, rows }, null, 2));
}

console.log(`\n=== true scores with both instances present (${repeats} scorings each) ===`);
console.log(`${'id'.padEnd(14)} ${'recorded'.padEnd(9)} ${'now'.padEnd(20)} instances`);
for (const r of rows) {
  if (r.error) { console.log(`${r.id.padEnd(14)} ${String(r.oldBest ?? '?').padEnd(9)} ${r.error}`); continue; }
  const inst = Object.entries(r.instances).map(([m, v]) => `${m.replace('tc ', '')} ${v.got}/${v.want}`).join(', ');
  console.log(`${r.id.padEnd(14)} ${String(r.oldBest ?? '?').padEnd(9)} ${`${r.mean}±${r.sd}`.padEnd(20)} ${inst}`);
}
console.log(`\nreport → ${path.relative(REPO, outPath)}`);
console.log('NOTE: the recorded column came from a comp missing half the plan. It is not a baseline,');
console.log('      it is a record of a render nobody asked for. Do not read the difference as progress.');
