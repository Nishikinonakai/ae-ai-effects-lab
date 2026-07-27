// tune_edit.mjs — the brownfield AUTO-TUNE loop: the self-converging capstone of the edit protocol.
//
// The KillKiss E2E did this BY HAND: apply an edit → verify it → read the scorer's suggestion →
// apply the next edit → re-verify. This automates that cycle for REAL projects, composing the three
// tools built this session:
//   apply_edit (reversible act) → verify_edit (visual self-check vs the ORIGINAL baseline, finding #5)
//   → map the scorer's suggestions to the next edit → repeat, until accept or max-iters.
//
// It is the brownfield analog of recipe-harness/runner/tune_loop.mjs, but STATEFUL: edits accumulate
// on the live comp, and revert-on-decline uses apply_edit's deterministic ROLLBACK to undo a bad step
// and re-tune from the best state. Multi-lever pivoting (finding #6) falls out for free: the scorer
// sees prior_iterations (a plateau on one lever) and pivots to another — and we feed it that history.
//
// usage: node brownfield/tune_edit.mjs --seed=<seed_spec.json> --intent="..." [--layer=N]
//        [--max-iters=4] [--accept=8] [--model=<provider default>] [--out=<dir>]
//   --seed  : the initial edit spec (apply_edit format) — the first move the loop refines.
//   --layer : the target layer for scorer-suggested edits (defaults to the seed's first edit's layer).
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { effectsFromEdits } from '../introspect/essence/lookup.mjs';
import { suggestionsToEdits } from './suggest_spec.mjs';
import { applyReportErrors } from './apply_report.mjs';
import { iterationNumbers } from './tune_policy.mjs';
import { temporalEditCues } from './temporal.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const APPLY = path.join(__dirname, 'apply_edit.mjs');
const VERIFY = path.join(__dirname, 'verify_edit.mjs');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const seedPath = arg('seed', null);
const intent = arg('intent', null);
if (!seedPath || !intent) { console.error('usage: node brownfield/tune_edit.mjs --seed=<spec.json> --intent="..." [--layer=N] [--max-iters=4] [--accept=8]'); process.exit(1); }
const maxIters = Number(arg('max-iters', 4));
const iterations = iterationNumbers(maxIters);
const iterationCount = iterations.length;
const acceptBar = Number(arg('accept', 8));
const model = arg('model', null);   // the scorer picks per provider
const outDir = path.resolve(arg('out', path.join(__dirname, 'dumps', 'tune_edit')));
fs.mkdirSync(outDir, { recursive: true });

const seed = JSON.parse(fs.readFileSync(path.resolve(seedPath), 'utf8'));
const targetLayer = Number(arg('layer', (seed.edits && seed.edits[0] && seed.edits[0].layerIndex) || 1));

// Effects touched so far in this tune — grows as the scorer pivots, and is what the essence index is
// queried with each round (see verifyEdit). Seeded from the seed spec.
const touchedEffects = new Set(effectsFromEdits(seed.edits || []).effects);
const forcedTemporalCues = new Set(temporalEditCues(seed.edits || []));
// Levers this tune has proven unreachable (hidden behind a parent gate, wrong type, …) — never re-offered.
const blockedLevers = new Set();
// The plateau trace handed to the scorer as prior_iterations, rewritten before every verify.
const historyPath = path.join(outDir, 'tune_history.json');
fs.writeFileSync(historyPath, '[]');

function node(script, args) { return spawnSync('node', [script, ...args], { encoding: 'utf8' }); }

// apply an edit spec; returns the parsed report (or null on failure)
function applyEdit(spec, label) {
  const specFile = path.join(outDir, `${label}_spec.json`);
  fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));
  const r = node(APPLY, [`--spec=${specFile}`, `--out=${outDir}`, `--label=${label}`]);
  process.stdout.write(r.stdout || '');
  const reportPath = path.join(outDir, `edit_${label.replace(/[^\w.-]+/g, '_')}_report.json`);
  if (r.status !== 0 || !fs.existsSync(reportPath)) { console.error('apply failed:\n' + (r.stderr || '')); return null; }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const errors = applyReportErrors(report);
  if (errors.length) {
    console.error(`apply was incomplete (${errors.length} operation(s) failed) — compensating the successful operations`);
    if (rollback(reportPath)) {
      // The compensation already consumed this inverse. Clear it so crash/cancel salvage cannot
      // roll the same report back twice or tell the panel that a non-existent change is pending.
      report.inverse = [];
      report.rolledBackAfterFailure = true;
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    } else {
      // Do not continue to a normal summary: it would omit this report from `stack`, hiding the
      // still-applied successful subset. An uncaught failure takes the no-summary kernel path,
      // whose salvage scans reports with live inverses and exposes Roll back.
      throw new Error('compensation failed — kernel recovery must salvage the partial transaction');
    }
    return null;
  }
  return { reportPath, report };
}

// verify a report against the ORIGINAL baseline + intent; returns {score, verdict, suggestions, decision}
//
// Two things beyond the frames make the multi-iteration case work (finding #6):
//   · --history : the prior verdicts, so the scorer can SEE that a lever has stopped paying and
//                 pivot off it. Without this every iteration read as an isolated one-shot review.
//   · --effects : every effect touched SO FAR in this tune, not just the seed's — so the essence
//                 co-lever block keeps covering the whole accumulated edit, not the first move.
function verifyEdit(reportPath, baselineReportPath, iterNo) {
  const args = [`--report=${reportPath}`, `--intent=${intent}`, `--baseline=${baselineReportPath}`,
    `--accept=${acceptBar}`, `--rollback=3`, ...(model ? [`--model=${model}`] : []),
    `--history=${historyPath}`, `--iter=${iterNo + 1}`, `--max-iters=${iterationCount}`];
  if (touchedEffects.size) args.push(`--effects=${[...touchedEffects].join(',')}`);
  // levers that turned out to be gated shut stay blocked for the REST of the tune — otherwise the
  // scorer re-suggests them every round (a wider lever vocabulary makes this more likely, not less)
  if (blockedLevers.size) args.push(`--blocked=${[...blockedLevers].join(',')}`);
  if (forcedTemporalCues.size) args.push(`--temporal-cues=${[...forcedTemporalCues].join('|')}`);
  const r = node(VERIFY, args);
  process.stdout.write(r.stdout || '');
  const reviewPath = path.join(path.dirname(reportPath), 'review.json');
  if (!fs.existsSync(reviewPath)) { console.error('verify produced no review.json:\n' + (r.stderr || '')); return null; }
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  // carry forward what verify_edit measured on this report (it names the request after the report's
  // own label, so re-read the label rather than reconstructing it from the filename)
  let deltaClass = null;
  try {
    const label = JSON.parse(fs.readFileSync(reportPath, 'utf8')).label || 'edit';
    const reqPath = path.join(path.dirname(reportPath), `verify_${label}_request.json`);
    const req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
    for (const b of req.blocked_levers || []) blockedLevers.add(b);
    deltaClass = req.frame_delta?.class ?? null;
  } catch { /* request shape changed — the blocklist just stays as-is */ }
  // exit code: 0 accept / 2 tune / 3 rollback / 4 semantic-pass handoff
  const decision = r.status === 0 ? 'accept' : r.status === 2 ? 'tune' : r.status === 4 ? 'handoff' : 'rollback';
  return { score: review.score, verdict: review.verdict, critique: review.critique, suggestions: review.suggestions || [], decision, deltaClass };
}

function rollback(reportPath) {
  const r = node(APPLY, [`--rollback=${reportPath}`]);
  process.stdout.write(r.stdout || '');
  return r.status === 0;
}

// Instance pins this tune knows about: effect matchName -> parade slot. Seeded from the seed
// spec's effectIndex fields (the planner pins whenever a layer duplicates an effect) and widened
// by suggest_spec as "#N"-suffixed suggestions arrive. The mapping itself lives in
// brownfield/suggest_spec.mjs so the offline tests can pin it.
const pinnedSlot = new Map();
for (const e of (seed.edits || [])) if (e.effectMatchName && e.effectIndex != null) pinnedSlot.set(e.effectMatchName, e.effectIndex);

// map the scorer's typed suggestions -> an apply_edit spec on the target layer
function suggestionsToSpec(suggestions, label) {
  const edits = suggestionsToEdits(suggestions, targetLayer, pinnedSlot);
  return edits.length ? { label, edits } : null;
}

// ---------------- the loop ----------------
console.log(`\n=== tune_edit: "${intent}" (layer ${targetLayer}, accept≥${acceptBar}, max ${iterationCount} scored passes) ===\n`);

// iter 0: apply the seed. Its BEFORE frame is the ORIGINAL baseline for every verify (finding #5).
console.log('— iter 0: seed —');
const seed0 = applyEdit(seed, 'iter0');
if (!seed0) process.exit(1);
const baselineReport = seed0.reportPath;   // seed's before-frame = the untouched original

const trace = [];
let current = seed0;                        // the report of the currently-applied (topmost) edit
let best = { score: -1, verdict: null, reportPath: seed0.reportPath, depth: 0 };
const stack = [seed0];                      // applied reports, for rollback on decline
let accepted = false;

for (const n of iterations) {
  const label = `iter${n}`;
  const v = verifyEdit(current.reportPath, baselineReport, n);
  if (!v) break;
  trace.push({ iter: n, score: v.score, verdict: v.verdict, decision: v.decision, critique: (v.critique || '').slice(0, 120) });
  // hand the NEXT verify what this one concluded, in the prior_iterations shape the scorers read
  fs.writeFileSync(historyPath, JSON.stringify(trace.map(t => ({ iter: t.iter, verdict: t.verdict, score: t.score, critique: t.critique })), null, 2));
  console.log(`  → iter ${n}: ${v.verdict} ${v.score}/10 (${v.decision})`);

  if (v.decision === 'accept') {
    // The accepting iteration IS the final state, so its score is the result. Without this,
    // bestScore reported the last score that beat its predecessor — a run that went 7 then 9-accept
    // told the caller "7", which is what the panel then showed the artist.
    best = { score: v.score, verdict: v.verdict, reportPath: current.reportPath, depth: stack.length };
    console.log(`\n✅ ACCEPTED at iter ${n} (score ${v.score}).`);
    accepted = true;
    break;
  }
  if (v.decision === 'handoff') {
    best = { score: v.score, verdict: v.verdict, reportPath: current.reportPath, depth: stack.length };
    console.log(`\n👤 SEMANTIC PASS at iter ${n} (${v.score}/10 below auto-accept ${acceptBar}) — stopping for artist review.`);
    break;
  }
  if (n === iterationCount - 1) {
    if (v.score > best.score) best = { score: v.score, verdict: v.verdict, reportPath: current.reportPath, depth: stack.length };
    console.log(`\n⏹ max iters reached — best score ${best.score}.`);
    break;
  }

  // revert-on-decline: if this iter is worse than the best so far, undo it and re-tune from best.
  // Revert-on-decline, with one exception: an ENABLING move. Opening a gate (a threshold that was
  // admitting no pixels, a toggle that was off) usually does not raise the score BY ITSELF — it
  // just makes the next lever able to work at all. A strict "keep only if better" rule discards
  // exactly those moves: measured live, the loop rolled back the Threshold fix because it merely
  // TIED, then had to find a longer way round. So a tie survives when the frame actually changed —
  // that edit did something real and may be what unlocks the next one. Ties that changed nothing
  // are still reverted; keeping those would just accumulate dead weight.
  let baseForNext = current;
  const enabling = v.score === best.score && v.deltaClass === 'changed';
  if (v.score > best.score) { best = { score: v.score, verdict: v.verdict, reportPath: current.reportPath, depth: stack.length }; }
  else if (enabling && n > 0) {
    console.log(`  ↦ tie (${v.score}) but the frame changed — keeping as an enabling move`);
    best = { score: v.score, verdict: v.verdict, reportPath: current.reportPath, depth: stack.length };
  }
  else if (n > 0) {
    console.log(`  ↩ decline (${v.score} ${v.score === best.score ? '=' : '<'} best ${best.score}${v.deltaClass === 'inert' ? ', frame unchanged' : ''}) — rolling back this edit, re-tuning from best`);
    rollback(current.reportPath); stack.pop();
    baseForNext = stack[stack.length - 1];
  }

  // derive the next edit from the scorer's suggestions
  const nextSpec = suggestionsToSpec(v.suggestions, `iter${n + 1}`);
  if (!nextSpec) { console.log(`\n⏹ no applicable suggestions at iter ${n} — stopping (best score ${best.score}).`); break; }
  console.log(`  ↳ applying ${nextSpec.edits.length} suggested edit(s): ${nextSpec.edits.map(e => e.op + ' ' + (e.paramMatchName || e.effectMatchName || e.target)).join(', ')}`);
  for (const fx of effectsFromEdits(nextSpec.edits).effects) touchedEffects.add(fx);   // widen the lever context as the tune pivots
  for (const cue of temporalEditCues(nextSpec.edits)) forcedTemporalCues.add(cue);
  const applied = applyEdit(nextSpec, `iter${n + 1}`);
  if (!applied) { console.log('  (apply failed — stopping)'); break; }
  stack.push(applied);
  current = applied;
}

// Leave the comp in its BEST state, not its LAST. A tune that peaks at 7/10 on iteration 2 and then
// tries a worse idea on iteration 3 must not hand back the worse one — but that is exactly what
// running out of iterations used to do, silently: the loop stopped with the losing edit still
// applied. Every applied edit above the best-scoring one is rolled back, newest first, using the
// same deterministic inverses as a manual rollback. (An ACCEPT keeps everything: the accepted edit
// is the result, and its score was never folded into `best`.)
let restored = 0;
if (!accepted) {
  while (stack.length > best.depth && stack.length > 1) {
    const top = stack.pop();
    if (!rollback(top.reportPath)) { console.error('⚠ rollback failed — the comp may hold a worse-than-best edit; check the report.'); break; }
    restored++;
  }
  if (restored) console.log(`↩ restored the best state (rolled back ${restored} edit(s) applied after the best score).`);
}

const summaryPath = path.join(outDir, 'tune_summary.json');
fs.writeFileSync(summaryPath, JSON.stringify({
  intent, targetLayer, acceptBar, trace, bestScore: best.score, bestVerdict: best.verdict,
  semanticPass: best.verdict === 'pass', accepted,
  rolledBackToBest: restored, blockedLevers: [...blockedLevers],
  // What is STILL APPLIED to the comp when this loop exits, oldest first. A caller that wants to
  // undo the whole tune (the panel's Rollback button undoes an entire request, not one iteration)
  // rolls these back newest-first; without it there is no record of what the loop left behind.
  appliedReports: stack.map(s => path.relative(REPO, s.reportPath)),
  finalFrame: path.relative(REPO, path.resolve(REPO, JSON.parse(fs.readFileSync(stack[stack.length - 1].reportPath, 'utf8')).afterPng)),
}, null, 2));
console.log(`\ntrajectory: ${trace.map(t => `${t.score}`).join(' → ')}`);
console.log(`summary → ${path.relative(REPO, summaryPath)}`);
