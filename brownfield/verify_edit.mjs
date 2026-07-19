// verify_edit.mjs — the VISUAL SELF-CHECK for the brownfield edit protocol (closes F1).
//
// apply_edit.mjs applies an edit and captures BEFORE/AFTER frames, then offers accept/rollback as a
// MANUAL call. But the E2E demo's F1 finding was that the right answer is content-dependent — only
// the render tells you whether an edit achieved the intent (a glow value that reads as "dreamy" on
// one shot blows out on another). So the act must be able to JUDGE its own result.
//
// This reuses the SAME vision seam as the tune loop (recipe-harness/vision/gpt_score.mjs) — one
// scorer, now a third job: not "does this recipe match intent" / "what does this enum do", but
// "did this EDIT move the frame toward the intent without breaking it". It builds a review_request
// from the edit report's two frames, runs the scorer, and maps the score to a decision:
//   score >= accept-bar  → ACCEPT (keep)
//   mid                   → TUNE   (the scorer's suggestions are the next nudges)
//   low                   → ROLLBACK (node apply_edit.mjs --rollback=<report>)
//
// usage: node brownfield/verify_edit.mjs --report=<edit_*_report.json> --intent="..." [--pass="c1||c2"]
//        [--accept=8] [--rollback=4] [--model=gpt-5.6-terra]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { schemaPrompt } from '../recipe-harness/runner/review_schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const GPT_SCORE = path.join(REPO, 'recipe-harness', 'vision', 'gpt_score.mjs');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const reportArg = arg('report', null);
const intent = arg('intent', null);
if (!reportArg || !intent) { console.error('usage: node brownfield/verify_edit.mjs --report=<edit_report.json> --intent="..." [--pass="a||b"] [--accept=8] [--rollback=4]'); process.exit(1); }
const acceptBar = Number(arg('accept', 8));
const rollbackBar = Number(arg('rollback', 4));
const model = arg('model', 'gpt-5.6-terra');

const reportPath = path.resolve(reportArg);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
// report frame paths are repo-relative; resolve to absolute for the scorer (b64 reads them directly)
const beforeAbs = path.resolve(REPO, report.beforePng);
const afterAbs = path.resolve(REPO, report.afterPng);
for (const [lbl, fp] of [['before', beforeAbs], ['after', afterAbs]]) {
  if (!fs.existsSync(fp)) { console.error(`${lbl} frame missing: ${fp}`); process.exit(1); }
}

// A full-res AE frame can be huge (a 4K PNG is ~28MB → ~37MB base64, past the vision API's per-image
// limit — the scorer would reject or choke). Downscale a COPY to maxdim before sending; never touch
// the originals (rollback + the report still point at full-res). Surfaced by the KillKiss E2E
// (finding #4). sips is macOS-native (this is a darwin project); if it fails we fall back to the original.
const maxdim = Number(arg('maxdim', 1600));
function scaledCopy(fp) {
  const out = fp.replace(/\.png$/i, `_verify${maxdim}.png`);
  const r = spawnSync('sips', ['-Z', String(maxdim), fp, '--out', out], { encoding: 'utf8' });
  return (r.status === 0 && fs.existsSync(out)) ? out : fp;
}
const beforeScaled = scaledCopy(beforeAbs);
const afterScaled = scaledCopy(afterAbs);

// Build a review_request the shared scorer understands. Frame ORDER carries the meaning, so the
// instructions pin frame 1 = BEFORE, frame 2 = AFTER, and ask specifically about the DELTA.
const pass_criteria = (arg('pass', '') || '').split('||').map(s => s.trim()).filter(Boolean);
const reviewInstructions = [
  `The FIRST frame (${path.basename(beforeScaled)}) is the comp BEFORE the edit.`,
  `The SECOND frame (${path.basename(afterScaled)}) is the SAME comp+frame AFTER the edit was applied.`,
  'Judge whether the AFTER frame better achieves the INTENT than BEFORE — and did NOT break the composition',
  '(introduce clipping/blowout, hide the subject, or add an unwanted artifact). A no-op (frames identical)',
  'is a FAIL. score = how well AFTER realizes the intent (10 = exactly, would ship; 0 = wrong or broken).',
  'suggestions, when verdict=fail, are the concrete next nudges to improve the edit.',
  '',
  schemaPrompt(),
].join('\n');

const req = {
  intent,
  pass_criteria,
  iteration: 1,
  max_iters: 1,
  plan: report.applied || report.spec || [],
  prior_iterations: [],
  frames: [beforeScaled, afterScaled],
  review_instructions: reviewInstructions,
};
const reqDir = path.dirname(reportPath);
const reqPath = path.join(reqDir, `verify_${report.label || 'edit'}_request.json`);
fs.writeFileSync(reqPath, JSON.stringify(req, null, 2));

// run the shared scorer (writes review.json next to the request)
const r = spawnSync('node', [GPT_SCORE, reqPath, `--model=${model}`], { encoding: 'utf8' });
if (r.status !== 0) { console.error('scorer failed:\n' + (r.stderr || r.stdout)); process.exit(1); }
const reviewPath = path.join(reqDir, 'review.json');
if (!fs.existsSync(reviewPath)) { console.error('scorer produced no review.json'); process.exit(1); }
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));

// map score -> decision
const score = review.score;
let decision, action;
if (score >= acceptBar) { decision = 'ACCEPT'; action = 'keep the edit as-is.'; }
else if (score <= rollbackBar) { decision = 'ROLLBACK'; action = `node brownfield/apply_edit.mjs --rollback=${path.relative(REPO, reportPath)}`; }
else { decision = 'TUNE'; action = 'apply the scorer suggestions below as the next edit, then re-verify.'; }

console.log(`\n=== verify "${report.label}" — intent: ${intent} ===`);
console.log(`scorer: ${review._backend}  verdict=${review.verdict}  score=${score}/10`);
console.log(`critique: ${review.critique}`);
if (review.suggestions?.length) {
  console.log('suggestions:');
  for (const s of review.suggestions) console.log(`  - [${s.type}] ${s.matchName || s.effect || ''} ${s.value !== undefined ? '→ ' + JSON.stringify(s.value) : ''} — ${s.why || ''}`);
}
console.log(`\n▶ DECISION: ${decision} (accept≥${acceptBar}, rollback≤${rollbackBar})`);
console.log(`  ${action}`);
// exit code: 0 accept / 2 tune / 3 rollback — so a harness can branch on it
process.exit(decision === 'ACCEPT' ? 0 : decision === 'TUNE' ? 2 : 3);
