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
//        [--accept=8] [--rollback=4] [--model=<provider default>] [--baseline=<first_report.json|orig.png>]
//        [--maxdim=1600] [--levers=off] [--effects=A,B] [--history=<trace.json>] [--iter=N] [--max-iters=M]
//   --baseline: for a MULTI-STEP tune, compare AFTER against the ORIGINAL baseline (not the prior
//               iteration's before), so cumulative convergence is visible (finding #5).
//   --levers  : co-lever injection from the essence index (finding #6, default ON — see below).
//   --history : prior iterations' verdicts, so the scorer can SEE a plateau and pivot off it.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { schemaPrompt } from '../recipe-harness/runner/review_schema.mjs';
import { leverContext, effectsFromEdits } from '../introspect/essence/lookup.mjs';
import { frameDelta, classifyDelta } from './frame_delta.mjs';
import { provider } from '../shell/llm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
// Pick the backend from the credential that is actually RESOLVABLE, not from what a file happens to
// contain. This used to grep recipe-harness/.env.api for "GEMINI_API_KEY" — so moving the key into
// the Keychain (where it still works fine) silently reverted this to the OpenAI scorer. Asking
// llm.mjs means one answer everywhere.
const SCORER_FOR = { gemini: 'gemini_score.mjs', anthropic: 'claude_score.mjs', openai: 'gpt_score.mjs' };
const GPT_SCORE = path.join(REPO, 'recipe-harness', 'vision', SCORER_FOR[provider()] || 'gpt_score.mjs');
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');

// Read-only bridge round-trip (same file protocol as apply_edit). Used only to read live param
// values for the lever block — this tool must never mutate the comp it is judging.
async function runAE(script, timeoutMs = 30000) {
  fs.writeFileSync(path.join(BRIDGE, 'ae_mcp_result.json'), JSON.stringify({ status: 'waiting' }));
  fs.writeFileSync(path.join(BRIDGE, 'ae_command.json'), JSON.stringify({ command: 'runScript', args: { script }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 600));
    try {
      const c = JSON.parse(fs.readFileSync(path.join(BRIDGE, 'ae_command.json'), 'utf8'));
      if (c.status === 'completed') return fs.readFileSync(path.join(BRIDGE, 'ae_mcp_result.json'), 'utf8');
      if (c.status === 'error') throw new Error('bridge reported an error');
    } catch (e) { if (String(e).includes('bridge reported')) throw e; /* else mid-write */ }
  }
  throw new Error('bridge timeout');
}

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const reportArg = arg('report', null);
const intent = arg('intent', null);
if (!reportArg || !intent) { console.error('usage: node brownfield/verify_edit.mjs --report=<edit_report.json> --intent="..." [--pass="a||b"] [--accept=8] [--rollback=4]'); process.exit(1); }
const acceptBar = Number(arg('accept', 8));
const rollbackBar = Number(arg('rollback', 4));
const model = arg('model', null);   // the scorer picks per provider

const reportPath = path.resolve(reportArg);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
// report frame paths are repo-relative; resolve to absolute for the scorer (b64 reads them directly)
const afterAbs = path.resolve(REPO, report.afterPng);
// --baseline (finding #5): in a MULTI-STEP tune, each iteration's own "before" is the PRIOR iteration's
// state, so a small incremental nudge reads as "no change" and convergence is invisible. Point the
// "before" at the ORIGINAL baseline (the first edit's before-frame, or an explicit PNG) so the scorer
// judges the CUMULATIVE delta against where the tune started. Accepts a report.json or a .png.
let beforeAbs;
const baselineArg = arg('baseline', null);
if (baselineArg) {
  const bp = path.resolve(baselineArg);
  if (bp.endsWith('.json')) { const br = JSON.parse(fs.readFileSync(bp, 'utf8')); beforeAbs = path.resolve(REPO, br.beforePng); }
  else beforeAbs = bp;
} else {
  beforeAbs = path.resolve(REPO, report.beforePng);
}
for (const [lbl, fp] of [['before/baseline', beforeAbs], ['after', afterAbs]]) {
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

// --- co-lever injection (finding #6) ---------------------------------------------------------
// review_schema tells the scorer "only reference param matchNames visible in the plan" — necessary
// so it can't invent matchNames the applier would fail on, but it also caps the tune at the levers
// the SEED happened to use. A seed that moves Exposure can only ever be told "more/less Exposure";
// when that plateaus (the single-lever high-plateau this loop kept hitting), the scorer has no way
// to say "widen Radius instead" even though the essence card knows Radius exists and what it does.
// So: look up the cards for the effects in play and hand the scorer their VERIFIED levers +
// config recipes. The anti-hallucination guard survives (matchNames still come from ground truth,
// now from the index instead of only the plan) while the pivot vocabulary widens.
const { effects: specEffects, params: specParams } = effectsFromEdits(report.spec || report.applied || []);
const extraEffects = (arg('effects', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const leversOn = arg('levers', 'on') !== 'off';
const lc = leversOn ? leverContext([...specEffects, ...extraEffects], specParams) : { block: '', cards: [], levers: [] };
if (lc.block) console.log(`essence: ${lc.cards.length} card(s) hit — ${lc.levers.length} lever(s) offered to the scorer`);

// --- current values of the offered levers -----------------------------------------------------
// The plan shows only what THIS edit touched, so every other lever reaches the scorer as a name and
// a range with no idea where it currently sits. That makes causal diagnosis guesswork: with Deep
// Glow's Threshold parked at 260% (admitting no pixels at all), the frame cannot change no matter
// what else moves — and the scorer, unable to see that 260, spent whole tunes cycling magnitude
// levers. Reading the live values costs one bridge round-trip and turns "which lever is the gate?"
// from inference into observation.
const layerIdx = (report.spec || []).find(e => e.layerIndex)?.layerIndex;
let leverValues = {};
if (lc.levers.length && layerIdx) {
  const wanted = lc.levers.map(l => ({ effect: l.effect, mn: l.matchName }));
  const script = `(function(){
    var c = app.project.activeItem; if (!(c instanceof CompItem)) return "{}";
    var L = c.layer(${layerIdx}); if (!L) return "{}";
    var W = ${JSON.stringify(wanted)}; var out = [];
    for (var i = 0; i < W.length; i++) {
      try {
        var fx = L.Effects.property(W[i].effect); if (!fx) continue;
        var p = fx.property(W[i].mn); if (!p) continue;
        var v = String(p.value); var nk = 0; try { nk = p.numKeys; } catch (e) {}
        out.push('"' + W[i].mn + '":"' + v.replace(/"/g, "") + (nk ? ' (' + nk + ' keys)' : '') + '"');
      } catch (e) {}
    }
    return '{' + out.join(',') + '}';
  })()`;
  try { leverValues = JSON.parse(await runAE(script, 30000)); }
  catch (e) { console.log(`(could not read live lever values: ${String(e).slice(0, 80)} — proceeding without them)`); }
}
if (Object.keys(leverValues).length) {
  // Annotate the FIRST bracketed matchName on each lever line. Non-greedy so a gated lever's
  // trailing "set <gate> [mn] = v" reference is not mistaken for the lever's own id, and loose
  // enough on the prefix to cover plain, "(in play)" and "⟨gated⟩" lines alike.
  lc.block = lc.block.replace(/^(\s*·.*?\[)([^\]]+)(\])/gm,
    (m, pre, mn, post) => leverValues[mn] !== undefined ? `${pre}${mn}${post} NOW=${leverValues[mn]}` : m);
  console.log(`essence: read ${Object.keys(leverValues).length} live lever value(s) from layer ${layerIdx}`);
}

// --- unreachable levers ------------------------------------------------------------------------
// Widening the scorer's vocabulary (above) has a cost: a lever the card lists may still be shut on
// THIS instance — either behind a gate the card does not know about, or with no reachable gate at
// all (Deep Glow's Spread resists all 19 of the effect's gates). Either way setValue throws.
// apply_edit records that as a failed edit, but nothing told the scorer, so it would keep spending
// suggestions on a lever that cannot move. Feed the failures back: this iteration's, plus --blocked
// for the ones earlier iterations already discovered (the tune loop accumulates them).
const failedHere = (report.applied || []).filter(a => a && a.error);
const blockedPrior = (arg('blocked', '') || '').split(',').map(s => s.trim()).filter(Boolean);
// pair each failure with the param it was trying to move (applied[] is index-aligned with spec[])
const specArr = report.spec || [];
const failedDetail = failedHere.map(a => {
  const idx = (report.applied || []).indexOf(a);
  const target = a.which || specArr[idx]?.paramMatchName || specArr[idx]?.effectMatchName || '(unknown)';
  return { target, reason: a.error === 'setValue threw' ? String(a.detail || '').replace(/^Error:\s*/, '') : a.error };
});
const blockedAll = [...new Set([...blockedPrior, ...failedDetail.map(f => f.target)])];
let blockedBlock = '';
if (failedDetail.length || blockedPrior.length) {
  blockedBlock = [
    'UNREACHABLE LEVERS — these could NOT be set on this instance. Do not suggest them again;',
    'they are listed in the lever table but are gated shut on this particular effect instance.',
    ...failedDetail.map(f => `  ✗ ${f.target} — ${f.reason}`),
    ...blockedPrior.filter(b => !failedDetail.some(f => f.target === b)).map(b => `  ✗ ${b} — rejected in an earlier iteration of this tune`),
    'If a lever is hidden behind a parent gate, you may suggest the GATE (the toggle/mode that opens it)',
    'instead — but never the hidden lever itself. Levers marked ⟨gated⟩ in the list above already name',
    'their gate: suggest the gate and the lever together, gate first, and both will apply.',
  ].join('\n');
}

// --- plateau history -------------------------------------------------------------------------
// The scorer can only recognise "this lever is exhausted" if it sees the prior verdicts. tune_edit
// keeps that trace; pass it through so a multi-iteration tune reads as a trajectory, not as N
// independent one-shot reviews (which is what an empty prior_iterations made it).
let priorIterations = [];
const historyArg = arg('history', null);
if (historyArg && fs.existsSync(path.resolve(historyArg))) {
  try { priorIterations = JSON.parse(fs.readFileSync(path.resolve(historyArg), 'utf8')); } catch { priorIterations = []; }
  if (!Array.isArray(priorIterations)) priorIterations = [];
}
const iteration = Number(arg('iter', priorIterations.length + 1));
const maxItersReq = Number(arg('max-iters', Math.max(iteration, 1)));

// --- inert-vs-weak measurement --------------------------------------------------------------
// The scorer cannot reliably tell "this edit did very little" from "this edit did NOTHING", and
// those demand opposite responses: the first means push harder, the second means the lever is
// INERT and pushing it (or any sibling magnitude lever) is guaranteed to waste every remaining
// iteration. On the co-lever fixture this cost a whole 4-iteration tune: Deep Glow's Threshold at
// 260% admitted no pixels, so Radius 60→1300 moved exactly zero pixels, and the loop kept trading
// magnitude suggestions while the frame never once changed. A pixel diff answers this exactly and
// for free, so we measure it and TELL the scorer rather than asking it to perceive it.
const editDelta = frameDelta(path.resolve(REPO, report.beforePng), afterAbs);   // did THIS edit do anything?
const cumulativeDelta = frameDelta(beforeAbs, afterAbs);                        // has the tune moved at all?
const editClass = classifyDelta(editDelta);
// An inert frame has two very different causes, and the report says which. If the param never
// actually moved, the edit did not take. If the param DID move and the frame still did not, the
// lever is real but has no visible consequence in this state — masked, occluded, or saturated by
// something else. Telling the scorer "the effect is gated" in that second case sends it hunting a
// gate that isn't there: measured live, it re-suggested Threshold→0 when Threshold was ALREADY 0,
// and the score fell from 7 to 0.
const valueMoved = (report.applied || []).some(a => a && !a.error &&
  (a.op === 'param' ? JSON.stringify(a.old) !== JSON.stringify(a.new) : true));
let deltaBlock = '';
if (editClass === 'inert') {
  deltaBlock = [
    'MEASURED PIXEL DELTA: this edit changed ZERO pixels. The two frames are bit-identical.',
    'This is a MEASUREMENT, not an impression — the edit is INERT, not merely too weak.',
    'Do NOT respond by increasing the magnitude of this lever; magnitude is not what is wrong.',
    ...(valueMoved ? [
      'The parameter DID take its new value — the lever exists and is writable, but has no visible',
      'consequence in the CURRENT state. Work through these in order:',
      '  1. A GATE ON THE SAME EFFECT is shutting the whole effect down, so nothing inside it can matter.',
      '     Read the NOW= values in the lever list against what each lever DOES: a luminance threshold set',
      '     above anything in the frame admits no pixels; an enable/render toggle may be off; a view or',
      '     output mode may be showing the wrong pass. This is the most common cause — check it first.',
      '  2. The change is ABSORBED downstream: the region it affects is already saturated/clipped, hidden',
      '     behind another effect, or off-frame.',
      'Suggest the gate (case 1) or a lever acting elsewhere (case 2). Never re-suggest a value a param',
      'already holds — the NOW= values tell you what each one is.',
    ] : [
      'The parameter did NOT take its new value, so the edit never landed. Something is GATING it.',
      'Identify the GATE and suggest changing THAT. Typical gates, in the order worth checking: a',
      'threshold / luminance gate set so high that no pixel qualifies; an enable or "render" toggle that',
      'is off; a view or output mode showing the wrong pass; an effect whose load-bearing state (a matte,',
      'a solve, a 3D scene) does not exist yet — in which case NO param edit can help and you should say so.',
    ]),
    'Re-read the lever list above and the CURRENT PLAN before choosing; check what each param already holds.',
  ].join('\n');
} else if (editClass === 'negligible') {
  // The third class existed in frame_delta.mjs from the start and nothing ever asked for it — every
  // near-inert edit fell through to the generic numbers block below, which reports "0.04% of pixels
  // changed" and leaves the scorer to decide whether that is a little or nothing. That is exactly
  // the judgement the pixel diff was added to take off it. `negligible` means the lever IS live —
  // unlike inert, it is not gated — but its effect is confined to a sliver of the frame, so the
  // answer is a DIFFERENT lever or a much larger step, not one more nudge of this one.
  deltaBlock = [
    `MEASURED PIXEL DELTA: this edit moved only ${(editDelta.movedFraction * 100).toFixed(3)}% of pixels, max |Δ| ${editDelta.maxDelta.toFixed(0)}/255.`,
    'This is NEGLIGIBLE but not inert: the lever is live and did take effect — it simply has almost no',
    'reach at this setting. A small further nudge will not be visible either. Either take a MUCH larger',
    'step on this lever, or accept it is the wrong lever for what the intent asks and choose another.',
  ].join('\n');
} else if (editDelta.ok) {
  deltaBlock = `MEASURED PIXEL DELTA for this edit: ${(editDelta.movedFraction * 100).toFixed(2)}% of pixels changed, mean |Δ| ${editDelta.meanDelta.toFixed(2)}/255, max |Δ| ${editDelta.maxDelta.toFixed(0)}/255`
    + (cumulativeDelta.ok && baselineArg ? ` · cumulatively vs the ORIGINAL baseline: ${(cumulativeDelta.movedFraction * 100).toFixed(2)}% of pixels, mean |Δ| ${cumulativeDelta.meanDelta.toFixed(2)}/255.` : '.')
    + ' Use this to calibrate how much the edit actually moved the image; judge the LOOK from the frames.';
}
if (editClass) console.log(`frame delta: ${editClass}${editDelta.ok ? ` (moved ${(editDelta.movedFraction * 100).toFixed(2)}%, mean ${editDelta.meanDelta.toFixed(2)}/255)` : ''}`);
else if (!editDelta.ok) console.log(`frame delta: unavailable — ${editDelta.why} (skipping the inert check)`);

const reviewInstructions = [
  `The FIRST frame (${path.basename(beforeScaled)}) is the comp BEFORE the edit.`,
  `The SECOND frame (${path.basename(afterScaled)}) is the SAME comp+frame AFTER the edit was applied.`,
  'Judge whether the AFTER frame better achieves the INTENT than BEFORE — and did NOT break the composition',
  '(introduce clipping/blowout, hide the subject, or add an unwanted artifact). A no-op (frames identical)',
  'is a FAIL. score = how well AFTER realizes the intent (10 = exactly, would ship; 0 = wrong or broken).',
  'suggestions, when verdict=fail, are the concrete next nudges to improve the edit.',
  '',
  ...(lc.block ? [lc.block, ''] : []),
  ...(blockedBlock ? [blockedBlock, ''] : []),
  ...(deltaBlock ? [deltaBlock, ''] : []),
  schemaPrompt(),
].join('\n');

const req = {
  intent,
  pass_criteria,
  iteration,
  max_iters: maxItersReq,
  plan: report.applied || report.spec || [],
  prior_iterations: priorIterations,
  available_levers: lc.levers,     // machine-readable twin of the block above (for post-hoc analysis)
  frame_delta: { edit: editDelta, cumulative: cumulativeDelta, class: editClass },
  blocked_levers: blockedAll,      // the loop reads this back to carry the blocklist forward
  frames: [beforeScaled, afterScaled],
  review_instructions: reviewInstructions,
};
const reqDir = path.dirname(reportPath);
const reqPath = path.join(reqDir, `verify_${report.label || 'edit'}_request.json`);
fs.writeFileSync(reqPath, JSON.stringify(req, null, 2));

// run the shared scorer (writes review.json next to the request)
const r = spawnSync('node', [GPT_SCORE, reqPath, ...(model ? [`--model=${model}`] : [])], { encoding: 'utf8' });
if (r.status !== 0) { console.error('scorer failed:\n' + (r.stderr || r.stdout)); process.exit(1); }
const reviewPath = path.join(reqDir, 'review.json');
if (!fs.existsSync(reviewPath)) { console.error('scorer produced no review.json'); process.exit(1); }
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));

// CONFIRM A PASS BEFORE BELIEVING IT. The measured within-arm sd of this scorer is 0.27-0.71, with
// +/-1 swings on pixel-identical input — so a single draw landing exactly on the bar is a coin flip,
// not a result. A judge that "usually says 7" has roughly a 1-in-8 chance of saying 8, and the panel
// would then tell the artist the job is done on the strength of one lucky sample.
//
// This confirmation existed in tune_loop.mjs (the greenfield eval path) from the moment the defect
// was found, and PRD §11.3 recorded it as fixed. It was not fixed HERE — on the path the product
// actually runs when someone types into the panel. That is the sixth instance of §十三: the same
// abstraction built in one place and absent in the other, invisible because each half works alone.
//
// Re-scoring only fires at the boundary, so it costs two extra calls per RUN, not per iteration.
// Median of three turns a 1-in-8 fluke into about 1 in 50.
if (review.score >= acceptBar && !review._confirmed) {
  const draws = [review.score];
  for (let k = 0; k < 2; k++) {
    const again = spawnSync('node', [GPT_SCORE, reqPath, ...(model ? [`--model=${model}`] : [])], { encoding: 'utf8' });
    if (again.status !== 0 || !fs.existsSync(reviewPath)) continue;
    draws.push(JSON.parse(fs.readFileSync(reviewPath, 'utf8')).score);
  }
  const median = [...draws].sort((a, b) => a - b)[Math.floor(draws.length / 2)];
  console.log(`confirming pass: draws [${draws.join(',')}] median ${median} vs bar ${acceptBar}`);
  review._confirmed = draws;
  review._median = median;
  if (median < acceptBar) {
    console.log(`  → NOT confirmed (${median} < ${acceptBar}) — the single ${review.score} was a draw, not a result. Keep tuning.`);
    review.score = median;
    review.verdict = 'fail';
  }
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));
}

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
