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
//        [--max-iters=4] [--accept=8] [--model=gpt-5.6-terra] [--out=<dir>]
//   --seed  : the initial edit spec (apply_edit format) — the first move the loop refines.
//   --layer : the target layer for scorer-suggested edits (defaults to the seed's first edit's layer).
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const APPLY = path.join(__dirname, 'apply_edit.mjs');
const VERIFY = path.join(__dirname, 'verify_edit.mjs');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const seedPath = arg('seed', null);
const intent = arg('intent', null);
if (!seedPath || !intent) { console.error('usage: node brownfield/tune_edit.mjs --seed=<spec.json> --intent="..." [--layer=N] [--max-iters=4] [--accept=8]'); process.exit(1); }
const maxIters = Number(arg('max-iters', 4));
const acceptBar = Number(arg('accept', 8));
const model = arg('model', 'gpt-5.6-terra');
const outDir = path.resolve(arg('out', path.join(__dirname, 'dumps', 'tune_edit')));
fs.mkdirSync(outDir, { recursive: true });

const seed = JSON.parse(fs.readFileSync(path.resolve(seedPath), 'utf8'));
const targetLayer = Number(arg('layer', (seed.edits && seed.edits[0] && seed.edits[0].layerIndex) || 1));

function node(script, args) { return spawnSync('node', [script, ...args], { encoding: 'utf8' }); }

// apply an edit spec; returns the parsed report (or null on failure)
function applyEdit(spec, label) {
  const specFile = path.join(outDir, `${label}_spec.json`);
  fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));
  const r = node(APPLY, [`--spec=${specFile}`, `--out=${outDir}`, `--label=${label}`]);
  process.stdout.write(r.stdout || '');
  const reportPath = path.join(outDir, `edit_${label.replace(/[^\w.-]+/g, '_')}_report.json`);
  if (r.status !== 0 || !fs.existsSync(reportPath)) { console.error('apply failed:\n' + (r.stderr || '')); return null; }
  return { reportPath, report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) };
}

// verify a report against the ORIGINAL baseline + intent; returns {score, verdict, suggestions, decision}
function verifyEdit(reportPath, baselineReportPath) {
  const r = node(VERIFY, [`--report=${reportPath}`, `--intent=${intent}`, `--baseline=${baselineReportPath}`, `--accept=${acceptBar}`, `--rollback=3`, `--model=${model}`]);
  process.stdout.write(r.stdout || '');
  const reviewPath = path.join(path.dirname(reportPath), 'review.json');
  if (!fs.existsSync(reviewPath)) { console.error('verify produced no review.json:\n' + (r.stderr || '')); return null; }
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  // exit code: 0 accept / 2 tune / 3 rollback
  const decision = r.status === 0 ? 'accept' : r.status === 2 ? 'tune' : 'rollback';
  return { score: review.score, verdict: review.verdict, critique: review.critique, suggestions: review.suggestions || [], decision };
}

function rollback(reportPath) {
  const r = node(APPLY, [`--rollback=${reportPath}`]);
  process.stdout.write(r.stdout || '');
  return r.status === 0;
}

// map the scorer's typed suggestions -> an apply_edit spec on the target layer
function suggestionsToSpec(suggestions, label) {
  const edits = [];
  for (const s of suggestions) {
    if (s.type === 'param' && s.matchName && s.value !== undefined) {
      edits.push({ op: 'param', layerIndex: targetLayer, effectMatchName: s.effect, paramMatchName: s.matchName, value: s.value });
    } else if (s.type === 'effect' && s.matchName) {
      edits.push({ op: 'addEffect', layerIndex: targetLayer, effectMatchName: s.matchName });
    } else if (s.type === 'expression' && s.matchName && s.expression) {
      edits.push({ op: 'expression', layerIndex: targetLayer, propertyPath: ['ADBE Effect Parade', s.effect, s.matchName], expression: s.expression });
    }
  }
  return edits.length ? { label, edits } : null;
}

// ---------------- the loop ----------------
console.log(`\n=== tune_edit: "${intent}" (layer ${targetLayer}, accept≥${acceptBar}, max ${maxIters} iters) ===\n`);

// iter 0: apply the seed. Its BEFORE frame is the ORIGINAL baseline for every verify (finding #5).
console.log('— iter 0: seed —');
const seed0 = applyEdit(seed, 'iter0');
if (!seed0) process.exit(1);
const baselineReport = seed0.reportPath;   // seed's before-frame = the untouched original

const trace = [];
let current = seed0;                        // the report of the currently-applied (topmost) edit
let best = { score: -1, reportPath: seed0.reportPath, depth: 0 };
const stack = [seed0];                      // applied reports, for rollback on decline

for (let n = 0; n <= maxIters; n++) {
  const label = `iter${n}`;
  const v = verifyEdit(current.reportPath, baselineReport);
  if (!v) break;
  trace.push({ iter: n, score: v.score, verdict: v.verdict, decision: v.decision, critique: (v.critique || '').slice(0, 120) });
  console.log(`  → iter ${n}: ${v.verdict} ${v.score}/10 (${v.decision})`);

  if (v.decision === 'accept') { console.log(`\n✅ ACCEPTED at iter ${n} (score ${v.score}).`); break; }
  if (n === maxIters) { console.log(`\n⏹ max iters reached — best was iter ${best.depth === 0 ? 0 : '?'} score ${Math.max(best.score, v.score)}.`); break; }

  // revert-on-decline: if this iter is worse than the best so far, undo it and re-tune from best.
  let baseForNext = current;
  if (v.score > best.score) { best = { score: v.score, reportPath: current.reportPath, depth: stack.length }; }
  else if (n > 0) {
    console.log(`  ↩ decline (${v.score} < best ${best.score}) — rolling back this edit, re-tuning from best`);
    rollback(current.reportPath); stack.pop();
    baseForNext = stack[stack.length - 1];
  }

  // derive the next edit from the scorer's suggestions
  const nextSpec = suggestionsToSpec(v.suggestions, `iter${n + 1}`);
  if (!nextSpec) { console.log(`\n⏹ no applicable suggestions at iter ${n} — stopping (best score ${best.score}).`); break; }
  console.log(`  ↳ applying ${nextSpec.edits.length} suggested edit(s): ${nextSpec.edits.map(e => e.op + ' ' + (e.paramMatchName || e.effectMatchName || e.target)).join(', ')}`);
  const applied = applyEdit(nextSpec, `iter${n + 1}`);
  if (!applied) { console.log('  (apply failed — stopping)'); break; }
  stack.push(applied);
  current = applied;
}

const summaryPath = path.join(outDir, 'tune_summary.json');
fs.writeFileSync(summaryPath, JSON.stringify({ intent, targetLayer, acceptBar, trace, bestScore: best.score }, null, 2));
console.log(`\ntrajectory: ${trace.map(t => `${t.score}`).join(' → ')}`);
console.log(`summary → ${path.relative(REPO, summaryPath)}`);
