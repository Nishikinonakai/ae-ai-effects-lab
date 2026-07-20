// run_eval.mjs — planner-eval, as a batch job.
//
// Round-1 measured the product loop across 24 NL prompts and took a whole hand-driven session,
// because the planning step was the agent reasoning in-session: one prompt, one exchange, 24 times.
// With plan_recipe.mjs headless, the same measurement is a single command — which is what makes a
// round-2 (the controlled comparison after this session's fixes) actually affordable to run, and
// re-run whenever the planner or the index changes.
//
// Per prompt:  plan_recipe (NL → recipe) → tune_loop (render → score → nudge, up to maxIters)
// Recorded:    one-shot pass (iteration 1 scored a pass) and pass@N (any iteration did)
//
// ⚠ THIS IS NOT A LIKE-FOR-LIKE REMATCH OF ROUND-1. Round-1's planner was the agent reasoning in
// session — a far stronger reasoner than the headless model used here, and one that no shipped
// product could contain. So a lower number here does not mean the stack regressed; it means this
// measures something different and more honest: what the PRODUCT achieves with nobody in the loop.
// Treat these as a new baseline for the headless planner, and compare future runs against it.
//
// RESUMABLE by design. A full run is ~24 planning calls plus up to 24×N renders and vision calls;
// AE can stall, a licence check can time out, a socket can drop. Results append to a JSONL ledger
// and completed prompts are skipped, so an interrupted run is resumed rather than restarted.
//
// usage: node recipe-harness/eval/run_eval.mjs [--only=e01,e07] [--tier=T1] [--max-iters=3]
//        [--model=<provider default>] [--out=<results.jsonl>] [--replan] [--dry]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.resolve(__dirname, '..');
const REPO = path.resolve(HARNESS, '..');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const only = (arg('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const tierFilter = arg('tier', null);
const model = arg('model', null);   // provider's own default; a name baked in here 404s the moment the credential changes
const maxIters = Number(arg('max-iters', 0)) || null;   // 0 → use the prompt-set default
const replan = process.argv.includes('--replan');
const dry = process.argv.includes('--dry');
const ledgerPath = path.resolve(arg('out', path.join(__dirname, 'results_r2.jsonl')));
const planDir = path.join(__dirname, 'plans_r2');
fs.mkdirSync(planDir, { recursive: true });

const set = JSON.parse(fs.readFileSync(path.join(__dirname, 'prompts.json'), 'utf8'));
const defaults = set.defaults || {};
let prompts = set.prompts;
if (only.length) prompts = prompts.filter(p => only.includes(p.id));
if (tierFilter) prompts = prompts.filter(p => p.tier === tierFilter);

// ---- ledger: the resume mechanism --------------------------------------------------------------
const done = new Map();
if (fs.existsSync(ledgerPath)) {
  for (const line of fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean)) {
    try { const r = JSON.parse(line); done.set(r.id, r); } catch { /* a torn last line is fine */ }
  }
}
const append = row => fs.appendFileSync(ledgerPath, JSON.stringify(row) + '\n');

function node(script, args, timeoutMs = 900000) {
  return spawnSync('node', [path.join(REPO, script), ...args], { encoding: 'utf8', cwd: REPO, timeout: timeoutMs });
}

console.log(`planner-eval round-2 — ${prompts.length} prompt(s), ${done.size} already in the ledger`);
console.log(`model=${model || "(provider default)"}  ledger=${path.relative(REPO, ledgerPath)}\n`);

for (const p of prompts) {
  if (done.has(p.id) && !replan) { console.log(`· ${p.id} — already done (${done.get(p.id).outcome})`); continue; }
  const iters = maxIters || defaults.maxIters || 3;
  console.log(`\n=== ${p.id} [${p.tier}/${p.family}/${p.dist}] ${p.prompt.slice(0, 60)} ===`);
  if (dry) { console.log('  (dry run — not executing)'); continue; }

  const row = { id: p.id, tier: p.tier, family: p.family, dist: p.dist, prompt: p.prompt, model, ts: new Date().toISOString() };

  // 1) PLAN
  const planPath = path.join(planDir, `${p.id}.json`);
  const plan = node('recipe-harness/runner/plan_recipe.mjs', [
    `--intent=${p.prompt}`, `--pass=${(p.pass_criteria || []).join('||')}`,
    `--name=eval-${p.id}`, `--out=${planPath}`, ...(model ? [`--model=${model}`] : []),
  ]);
  if (!fs.existsSync(planPath)) {
    row.outcome = 'plan-failed';
    row.error = (plan.stderr || plan.stdout || '').slice(-300);
    console.log(`  ✗ planning failed: ${row.error.split('\n').pop()}`);
    append(row); continue;
  }
  const recipe = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  // Force the loop directory to the prompt id. The planner names its own recipe, and two prompts
  // landing on the same name (entirely plausible — "glow-pulse" is an obvious choice for several)
  // would share loop/<name>/ and silently overwrite each other's iterations. Keying on the id also
  // makes every loop directory traceable back to its ledger row.
  recipe.name = `eval-${p.id}`;
  recipe.compName = `Eval_${p.id}`;
  // the loop scores against the prompt's own criteria, not the planner's restatement of them
  recipe.intent = p.prompt;
  recipe.pass_criteria = p.pass_criteria || [];
  recipe.comp ||= defaults.comp;
  // The PLANNER's sampling choice wins. This line used to read
  //   recipe.renderFrames = defaults.renderFrames || recipe.renderFrames
  // and defaults.renderFrames is [1,4] in prompts.json — always truthy — so the planner's choice was
  // discarded on EVERY round-2 prompt. That matters more than it looks: 23 of 24 prompts phrase a
  // motion criterion against the sampled pair, and t=1 sits inside the emitter fill transient (with
  // particle life 7.5-9s in a 6s comp, t1 holds a fraction of steady-state population). The scorer
  // then correctly reports "t1 is extremely sparse" as a defect that no birth-rate nudge can fix —
  // eval-e02 drove Particles/sec 28→34→48 and the t1:t4 ratio got WORSE (5.54x→6.01x), score 7,7,7.
  recipe.renderFrames ||= defaults.renderFrames;
  fs.writeFileSync(planPath, JSON.stringify(recipe, null, 2));
  row.stack = (recipe.effects || []).map(e => e.matchName);
  row.rationale = recipe._rationale || '';
  row.droppedByValidation = (recipe._validation || []).length;
  console.log(`  planned: ${row.stack.join(' → ') || '(empty)'}`);
  if (!row.stack.length) { row.outcome = 'plan-empty'; console.log('  ✗ no usable effects'); append(row); continue; }

  // 2) RENDER → SCORE → NUDGE
  const tune = node('recipe-harness/runner/tune_loop.mjs', [planPath, `--max-iters=${iters}`, '--backend=api', '--fresh'], 1800000);
  process.stdout.write((tune.stdout || '').split('\n').filter(l => /iter|verdict|score|PASS|FAIL/i.test(l)).map(l => '  ' + l).join('\n') + '\n');

  const summaryPath = path.join(HARNESS, 'loop', `eval-${p.id}`, 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    row.outcome = 'loop-failed';
    row.error = (tune.stderr || tune.stdout || '').slice(-300);
    console.log(`  ✗ loop produced no summary`);
    append(row); continue;
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const scores = (summary.iterations || []).map(i => i.score);
  row.scores = scores;
  row.outcome = summary.outcome;
  row.oneShot = (summary.iterations?.[0]?.verdict === 'pass');
  row.passAtN = summary.outcome === 'pass';
  row.bestScore = scores.length ? Math.max(...scores) : null;
  console.log(`  → ${row.outcome}  scores ${scores.join(' → ')}  (one-shot: ${row.oneShot ? 'yes' : 'no'})`);
  append(row);
}

// ---- rollup ------------------------------------------------------------------------------------
const all = [];
if (fs.existsSync(ledgerPath)) for (const line of fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean)) {
  try { all.push(JSON.parse(line)); } catch { /* torn line */ }
}
const scored = all.filter(r => r.scores);
if (!scored.length) { console.log('\n(no scored results yet)'); process.exit(0); }

const pct = (n, d) => d ? `${Math.round(100 * n / d)}%` : '—';
function group(key) {
  const m = new Map();
  for (const r of scored) {
    const k = r[key];
    if (!m.has(k)) m.set(k, { n: 0, one: 0, at: 0 });
    const g = m.get(k); g.n++; if (r.oneShot) g.one++; if (r.passAtN) g.at++;
  }
  return m;
}
console.log(`\n=== planner-eval round-2 — ${scored.length} scored ===`);
console.log(`one-shot ${pct(scored.filter(r => r.oneShot).length, scored.length)}   pass@N ${pct(scored.filter(r => r.passAtN).length, scored.length)}`);
for (const key of ['tier', 'family', 'dist']) {
  const rows = [...group(key)].sort();
  console.log(`\nby ${key}:`);
  for (const [k, g] of rows) console.log(`  ${String(k).padEnd(12)} n=${String(g.n).padStart(2)}  one-shot ${pct(g.one, g.n).padStart(4)}   pass@N ${pct(g.at, g.n).padStart(4)}`);
}
const failed = all.filter(r => !r.scores);
if (failed.length) console.log(`\n${failed.length} prompt(s) never scored: ${failed.map(r => `${r.id}(${r.outcome})`).join(', ')}`);
console.log(`\nledger → ${path.relative(REPO, ledgerPath)}`);
