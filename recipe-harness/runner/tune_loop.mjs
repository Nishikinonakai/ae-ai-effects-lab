// tune_loop.mjs — the auto visual-tune loop: run plan → render → vision-score vs intent →
// apply nudges → re-run, until pass or --max-iters. This closes the third moat layer
// (visual loop): the gap test showed the loop is what lands the last 20% of param tuning.
//
// The scorer is the SAME vision seam the ontology enricher uses — two backends, one
// review schema (runner/review_schema.mjs):
//   --backend=agent (default): after each render it writes iterN/review_request.json and
//     EXITS(2); the in-session agent reads the frames, writes iterN/review.json, and
//     re-runs this exact command to continue. Every invocation advances as far as it can.
//   --backend=api: scores inline via vision/claude_score.mjs (needs ANTHROPIC_API_KEY +
//     @anthropic-ai/sdk) and loops to completion headlessly.
//
// State machine over loop/<plan name>/iterN/ (plan.json, report.json, frames, review_request.json,
// review.json). The comp is find-or-create by compName, so every iteration updates the SAME
// comp in place — the loop literally turns knobs on a live comp.
//
// Plan JSON additions over the recipe schema: "intent" (required — the NL request the scorer
// judges against) and "pass_criteria" (optional list of concrete checks).
//
// Exit codes: 0 = pass, 1 = failed (max-iters / recipe error / dead-end), 2 = awaiting review.
//
// usage: node runner/tune_loop.mjs <plan.json> [--max-iters=4] [--backend=agent|api]
//        [--timeout=180] [--fresh]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { runRecipe, fmtParams } from './recipe_runner.mjs';
import { schemaPrompt, validateReview } from './review_schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

function die(msg, code = 1) { console.error('ERROR: ' + msg); process.exit(code); }
const readJ = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJ = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2));

// ---- args ----
const planPath = process.argv[2];
if (!planPath) die('usage: node runner/tune_loop.mjs <plan.json> [--max-iters=4] [--backend=agent|api] [--timeout=180] [--fresh]');
const flag = (name, dflt) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;
const maxIters = Number(flag('max-iters', 4));
const backend = flag('backend', 'agent');
const timeoutSec = Number(flag('timeout', 180));
const fresh = process.argv.includes('--fresh');

const src = readJ(planPath);
if (!src.name) die('plan needs a "name"');
if (!src.intent) die('plan needs an "intent" field (the NL request the scorer judges against)');
const base = src.name;
const loopDir = path.join(REPO, 'loop', base);
if (fresh) fs.rmSync(loopDir, { recursive: true, force: true });
fs.mkdirSync(loopDir, { recursive: true });

const iterDir = n => path.join(loopDir, 'iter' + n);
const listIters = () => fs.readdirSync(loopDir)
  .filter(d => /^iter\d+$/.test(d)).map(d => Number(d.slice(4))).sort((a, b) => a - b);

function trajectory(upto) {
  const t = [];
  for (const n of listIters()) {
    if (n >= upto) continue;
    const rp = path.join(iterDir(n), 'review.json');
    if (fs.existsSync(rp)) {
      const r = readJ(rp);
      t.push({ iter: n, score: r.score, verdict: r.verdict, critique: r.critique });
    }
  }
  return t;
}

// ---- render one iteration and stage its review request ----
async function renderIter(n, plan) {
  const dir = iterDir(n);
  fs.mkdirSync(dir, { recursive: true });
  const iterPlan = { ...plan, name: `${base}_i${n}` };
  writeJ(path.join(dir, 'plan.json'), iterPlan);

  console.log(`\n--- iter ${n}/${maxIters}: rendering ---`);
  const { report, frames } = await runRecipe(iterPlan, { outDir: dir, timeoutSec });
  writeJ(path.join(dir, 'report.json'), report);
  if (report.status === 'error') {
    console.error('RECIPE ERROR: ' + report.message);
    if (report.params) console.error(fmtParams(report.params));
    process.exit(1);
  }
  console.log(fmtParams(report.params));
  const ok = report.params.filter(p => p.ok).length;
  console.log(`params ${ok}/${report.params.length} ok`);
  for (const f of frames) console.log(`  ${f.ready ? '✓' : '✗ (not written)'} ${f.path}`);

  const effects = iterPlan.effects
    || [{ matchName: iterPlan.effect, params: iterPlan.params || [], expressions: iterPlan.expressions || [] }];
  writeJ(path.join(dir, 'review_request.json'), {
    intent: src.intent,
    pass_criteria: src.pass_criteria || [],
    iteration: n,
    max_iters: maxIters,
    plan: { effects, camera: iterPlan.camera ?? null, background: iterPlan.background ?? null, renderFrames: iterPlan.renderFrames },
    frames: frames.map(f => f.path),
    prior_iterations: trajectory(n),
    review_instructions: schemaPrompt(),
  });
}

// ---- apply scorer suggestions mechanically -> next plan ----
function applySuggestions(plan, sugs, forIter) {
  const p = JSON.parse(JSON.stringify(plan));
  if (!p.effects) {
    p.effects = [{ matchName: p.effect, params: p.params || [], expressions: p.expressions || [] }];
    delete p.effect; delete p.params; delete p.expressions;
  }
  const applied = [], skipped = [];
  let effectAdds = 0;
  for (const s of (sugs || [])) {
    try {
      if (s.type === 'param' || s.type === 'expression') {
        const eff = p.effects.find(e => e.matchName === s.effect);
        if (!eff) { skipped.push({ s, why: 'effect not in stack' }); continue; }
        const list = s.type === 'param' ? (eff.params = eff.params || []) : (eff.expressions = eff.expressions || []);
        const val = s.type === 'param' ? s.value : s.expression;
        const row = list.find(r => r[0] === s.matchName);
        if (row) row[1] = val;
        else list.push([s.matchName, val, `${(s.why || 'added').slice(0, 40)} [i${forIter}]`]);
        applied.push(s);
      } else if (s.type === 'effect') {
        if (effectAdds >= 1) { skipped.push({ s, why: 'max one new effect per iteration' }); continue; }
        if (p.effects.find(e => e.matchName === s.matchName)) { skipped.push({ s, why: 'already in stack' }); continue; }
        p.effects.push({ matchName: s.matchName, params: s.params || [], expressions: s.expressions || [] });
        effectAdds++; applied.push(s);
      } else if (s.type === 'camera') { p.camera = s.value; applied.push(s); }
      else if (s.type === 'background') { p.background = s.value; applied.push(s); }
      else skipped.push({ s, why: 'unknown suggestion type' });
    } catch (e) { skipped.push({ s, why: String(e) }); }
  }
  p._loop_history = (plan._loop_history || []).concat([{ for_iter: forIter, applied, skipped }]);
  return { plan: p, applied, skipped };
}

function scoreViaApi(n) {
  const req = path.join(iterDir(n), 'review_request.json');
  // scorer pick: Anthropic if its key is present; else the OpenAI-compatible twin
  // (key from env or the gitignored .env.api that gpt_score.mjs self-loads).
  const useClaude = !!process.env.ANTHROPIC_API_KEY;
  const scorer = path.join(REPO, 'vision', useClaude ? 'claude_score.mjs' : 'gpt_score.mjs');
  console.log(`scoring iter ${n} via ${path.basename(scorer)} ...`);
  const r = spawnSync('node', [scorer, req], { stdio: 'inherit' });
  if (r.status !== 0 || !fs.existsSync(path.join(iterDir(n), 'review.json'))) {
    die('api scorer failed to produce review.json (see scorer output above)');
  }
}

function finalize(outcome) {
  const iterations = trajectory(Infinity);
  const best = iterations.reduce((a, b) => (b.score > (a?.score ?? -1) ? b : a), null);
  const summary = { intent: src.intent, backend, outcome, best_iter: best?.iter ?? null, iterations };
  writeJ(path.join(loopDir, 'summary.json'), summary);
  console.log(`\n== LOOP ${outcome.toUpperCase()} ==`);
  for (const it of iterations) console.log(`  iter ${it.iter}: ${it.verdict} (${it.score}/10) — ${it.critique.slice(0, 90)}`);
  if (best) console.log(`best: iter ${best.iter} — plan at ${path.join(iterDir(best.iter), 'plan.json')}`);
  console.log(`summary: ${path.join(loopDir, 'summary.json')}`);
}

// ---- state machine: advance as far as possible on each invocation ----
while (true) {
  let iters = listIters();
  if (iters.length === 0) {
    await renderIter(1, src);
    iters = [1];
  }
  const n = iters[iters.length - 1];
  const revPath = path.join(iterDir(n), 'review.json');

  if (!fs.existsSync(revPath)) {
    if (!fs.existsSync(path.join(iterDir(n), 'review_request.json'))) {
      // crashed mid-iteration: re-render this iter from its saved plan
      const pp = path.join(iterDir(n), 'plan.json');
      if (!fs.existsSync(pp)) die(`iter ${n} has no plan.json — re-run with --fresh`);
      await renderIter(n, readJ(pp));
    }
    if (backend === 'api') { scoreViaApi(n); continue; }
    console.log(`\n== AWAITING REVIEW (iter ${n}/${maxIters}) ==`);
    console.log(`1. read the frames + review_request.json in ${iterDir(n)}`);
    console.log(`2. write ${revPath}  (schema: review_instructions in the request)`);
    console.log(`3. re-run this exact command to continue the loop`);
    process.exit(2);
  }

  const review = readJ(revPath);
  const errs = validateReview(review);
  if (errs.length) die(`iter ${n} review.json invalid: ${errs.join('; ')}`);

  if (review.verdict === 'pass') { finalize('pass'); process.exit(0); }
  if (n >= maxIters) { finalize('fail_max_iters'); process.exit(1); }

  const { plan: nextPlan, applied, skipped } = applySuggestions(readJ(path.join(iterDir(n), 'plan.json')), review.suggestions, n + 1);
  if (skipped.length) for (const sk of skipped) console.log(`  skipped suggestion: ${JSON.stringify(sk.s).slice(0, 80)} — ${sk.why}`);
  if (applied.length === 0) { finalize('fail_no_applicable_suggestions'); process.exit(1); }
  console.log(`\niter ${n} → ${n + 1}: applying ${applied.length} suggestion(s)`);
  for (const a of applied) console.log(`  • [${a.type}] ${a.matchName || ''} ${a.type === 'param' ? '= ' + JSON.stringify(a.value) : ''} — ${a.why || ''}`);
  await renderIter(n + 1, nextPlan);
}
