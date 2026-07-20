// exp_levers.mjs — does giving the scorer the essence lever list change WHICH LEVER it reaches for?
//
// The plateau diagnosis found the loop applying reasonable values to the wrong parameter, repeatedly:
// e07's blown particle cores answered with Deep Glow's Exposure (driven to zero, defect unmoved)
// while the blowout came from Particular's own additive Glow Sphere; e02's per-particle sway
// answered with Wind X, which translates the whole field uniformly and cannot produce individual
// arcs. The scorer was reasoning inside the box it was handed — review_schema restricts it to
// matchNames visible in the plan.
//
// THE METRIC IS THE LEVER, NOT THE SCORE. This is not fastidiousness: the sampling experiment
// measured within-arm score sd of 0.27-0.71 with +/-1 swings on byte-identical input, so any score
// difference this intervention could plausibly produce is buried under the noise floor. Which
// parameter gets named is discrete, and it is also the thing that actually matters — the loop
// applies suggestions mechanically, so a nudge on the wrong lever is a wasted iteration whatever the
// score says.
//
// Frames are FIXED. Both arms score the identical stored frames, so nothing about the render varies.
// The only difference is whether the review_request carries the essence lever block.
//
// Scoring key (--key) is PRE-REGISTERED by an independent analysis before this runs, so the
// experiment is not graded by the same reasoning that designed it.
//
// usage: node recipe-harness/eval/exp_levers.mjs [--ids=e02,e06,e07] [--repeats=5]
//        [--key=lever_key.json] [--model=gemini-3-flash-preview]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { leverContext } from '../../introspect/essence/lookup.mjs';
import { schemaPrompt } from '../runner/review_schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.resolve(__dirname, '..');
const REPO = path.resolve(HARNESS, '..');
const SCORER = path.join(HARNESS, 'vision', 'gemini_score.mjs');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const ids = (arg('ids', 'e02,e06,e07')).split(',').map(s => s.trim()).filter(Boolean);
const repeats = Number(arg('repeats', 5));
const model = arg('model', 'gemini-3-flash-preview');
const keyPath = arg('key', path.join(__dirname, 'lever_key.json'));
const outPath = path.resolve(arg('out', path.join(__dirname, 'exp_levers.json')));
const WORK = path.join(REPO, 'shell', 'out', 'exp_levers');
fs.mkdirSync(WORK, { recursive: true });

const KEY = fs.existsSync(keyPath) ? JSON.parse(fs.readFileSync(keyPath, 'utf8')) : null;
if (!KEY) console.log(`(no scoring key at ${path.relative(REPO, keyPath)} — reporting lever CHANGE only, not correctness)\n`);

function bestIterOf(id) {
  const dir = path.join(HARNESS, 'loop', `eval-${id}`);
  const sum = path.join(dir, 'summary.json');
  if (!fs.existsSync(sum)) return null;
  const its = JSON.parse(fs.readFileSync(sum, 'utf8')).iterations || [];
  if (!its.length) return null;
  const best = its.reduce((a, b) => (b.score > a.score ? b : a));
  const reqP = path.join(dir, `iter${best.iter}`, 'review_request.json');
  if (!fs.existsSync(reqP)) return null;
  const req = JSON.parse(fs.readFileSync(reqP, 'utf8'));
  if (!(req.frames || []).every(f => fs.existsSync(f))) return null;
  return { id, iter: best.iter, oldScore: best.score, req };
}

// Build the two request variants from the SAME stored request.
function variant(c, withLevers) {
  const req = JSON.parse(JSON.stringify(c.req));
  req.prior_iterations = [];                          // both arms judge the frame, not the history
  const effects = req.plan?.effects || [];
  if (withLevers) {
    const inPlay = effects.flatMap(e => (e.params || []).map(pr => (Array.isArray(pr) ? pr[0] : pr)));
    const lc = leverContext(effects.map(e => e.matchName), inPlay);
    if (!lc.block) return null;                       // no card for these effects — nothing to test
    req.available_levers = lc.levers;
    req.review_instructions = [schemaPrompt(), '', lc.block, '',
      'NAME THE LEVER THAT PHYSICALLY PRODUCES THE DEFECT YOU DESCRIBED. A parameter that acts on',
      'the whole field cannot fix a per-element complaint, and a downstream effect cannot fix a',
      'defect created upstream of it. If the lever you need is in the list above but not yet in the',
      'plan, suggest it — that is what the list is for.'].join('\n');
  } else {
    req.review_instructions = schemaPrompt();
    delete req.available_levers;
  }
  return req;
}

function scoreN(req, dir, label) {
  fs.mkdirSync(dir, { recursive: true });
  const reqP = path.join(dir, 'review_request.json');
  fs.writeFileSync(reqP, JSON.stringify(req, null, 2));
  const revP = path.join(dir, 'review.json');
  const runs = [];
  for (let k = 0; k < repeats; k++) {
    const s = spawnSync('node', [SCORER, reqP, `--model=${model}`], { encoding: 'utf8', timeout: 300000 });
    if (s.status !== 0 || !fs.existsSync(revP)) continue;
    const rev = JSON.parse(fs.readFileSync(revP, 'utf8'));
    fs.copyFileSync(revP, path.join(dir, `review_${k + 1}.json`));
    runs.push({
      score: rev.score,
      levers: (rev.suggestions || []).map(x => x.matchName).filter(Boolean),
      types: (rev.suggestions || []).map(x => x.type),
    });
  }
  return { label, runs };
}

const rows = [];
for (const id of ids) {
  const c = bestIterOf(id);
  if (!c) { console.log(`${id}: no usable stored request — skipped`); continue; }
  const planLevers = new Set((c.req.plan?.effects || []).flatMap(e => (e.params || []).map(pr => (Array.isArray(pr) ? pr[0] : pr))));

  const reqOff = variant(c, false), reqOn = variant(c, true);
  if (!reqOn) { console.log(`${id}: no essence card covers this stack — skipped`); continue; }

  process.stdout.write(`${id} (iter${c.iter}, was ${c.oldScore}/10) … `);
  const off = scoreN(reqOff, path.join(WORK, id, 'levers_off'), 'off');
  process.stdout.write(`off(${off.runs.length}) `);
  const on = scoreN(reqOn, path.join(WORK, id, 'levers_on'), 'on');
  process.stdout.write(`on(${on.runs.length})`);

  const summarise = a => {
    const all = a.runs.flatMap(r => r.levers);
    const distinct = [...new Set(all)];
    const offPlan = distinct.filter(l => !planLevers.has(l));
    const k = KEY?.[id];
    const correct = k ? distinct.filter(l => (k.correct || []).includes(l)) : null;
    const wrong = k ? distinct.filter(l => (k.wrong || []).includes(l)) : null;
    // how often ACROSS RUNS a correct lever showed up at all — a lever named once in five is not
    // the same as one named every time
    const hitRate = k ? +(a.runs.filter(r => r.levers.some(l => (k.correct || []).includes(l))).length / Math.max(1, a.runs.length)).toFixed(2) : null;
    return {
      n: a.runs.length,
      meanScore: a.runs.length ? +(a.runs.reduce((s, r) => s + r.score, 0) / a.runs.length).toFixed(2) : null,
      distinctLevers: distinct, offPlanLevers: offPlan,
      meanSuggestions: a.runs.length ? +(all.length / a.runs.length).toFixed(2) : 0,
      correctHit: correct, wrongHit: wrong, correctHitRate: hitRate,
    };
  };
  const row = { id, iter: c.iter, oldScore: c.oldScore, planLevers: [...planLevers], off: summarise(off), on: summarise(on) };
  console.log(`  off-plan levers: ${row.off.offPlanLevers.length} → ${row.on.offPlanLevers.length}` +
    (KEY?.[id] ? `  correct-lever hit rate: ${row.off.correctHitRate} → ${row.on.correctHitRate}` : ''));
  rows.push(row);
  fs.writeFileSync(outPath, JSON.stringify({ _date: new Date().toISOString().slice(0, 10), model, repeats, keyUsed: !!KEY, rows }, null, 2));
}

console.log(`\n=== lever-context experiment (frames FIXED, ${repeats} scorings per arm) ===`);
for (const r of rows) {
  console.log(`\n${r.id}  (plan already moves ${r.planLevers.length} param(s))`);
  console.log(`  levers OFF : ${r.off.distinctLevers.join(', ') || '(none)'}`);
  console.log(`  levers ON  : ${r.on.distinctLevers.join(', ') || '(none)'}`);
  console.log(`  off-plan levers reached for: ${r.off.offPlanLevers.length} → ${r.on.offPlanLevers.length}`);
  if (r.off.correctHitRate !== null) {
    console.log(`  PRE-REGISTERED correct lever named in: ${(r.off.correctHitRate * 100).toFixed(0)}% of runs → ${(r.on.correctHitRate * 100).toFixed(0)}%`);
    if (r.on.correctHit?.length) console.log(`    hits: ${r.on.correctHit.join(', ')}`);
    if (r.on.wrongHit?.length) console.log(`    still naming known-wrong levers: ${r.on.wrongHit.join(', ')}`);
  }
  console.log(`  mean score ${r.off.meanScore} → ${r.on.meanScore}  (expected to be flat — the noise floor is ~0.5)`);
}
if (KEY && rows.length) {
  const o = rows.reduce((a, r) => a + (r.off.correctHitRate ?? 0), 0) / rows.length;
  const n = rows.reduce((a, r) => a + (r.on.correctHitRate ?? 0), 0) / rows.length;
  console.log(`\nmean correct-lever hit rate: ${(o * 100).toFixed(0)}% → ${(n * 100).toFixed(0)}%`);
  console.log(n > o + 0.2
    ? '→ the lever list changes WHICH parameter the scorer reaches for. Worth landing in the loop.'
    : '→ no clear shift in lever choice. The scorer was not merely constrained by vocabulary.');
}
console.log(`\nreport → ${path.relative(REPO, outPath)}`);
