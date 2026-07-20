// exp_sampling.mjs — the decisive experiment: is the SAMPLING PROTOCOL the binding constraint on
// the 5-7 plateau, or is the residual genuinely about the render?
//
// The plateau diagnosis argued that the loop's two scored stills are not a valid measurement of what
// the prompts ask. 23 of 24 phrase a motion criterion against the sampled pair, and the pair is
// fixed at t=1 and t=4 of a 6s comp — while particle life is 7.5-9s in the worst cases, so the FIRST
// sample holds roughly a ninth of the population the render eventually reaches. The scorer then
// reports "t1 is extremely sparse" as a defect, correctly, and no birth-rate nudge can remove it:
// raising the rate scales both frames and leaves the ratio invariant (e02 drove Particles/sec
// 28→34→48 and the ratio got WORSE, 5.54x→6.01x, scoring 7,7,7 throughout).
//
// That argument rested on n=1 — the single run whose score moved when its ratio collapsed. This
// tests it properly, and the design is deliberately narrow so the answer means something:
//
//   THE PLAN DOES NOT CHANGE. Not one parameter. The only difference between the two arms is WHEN
//   the frames are sampled. Anything that moves is attributable to the protocol and nothing else.
//
//   control   renderFrames [1,4]  — the original, ~1s of fill at the first sample, 3s gap
//   treatment renderFrames [4,5]  — both samples late (maximum fill inside a 6s comp) and a 1s gap,
//                                   which is far shorter than particle life, so the SAME cohort is
//                                   visible in both frames and a trajectory can actually be inferred
//
// Both arms are scored by the same backend in the same run, so the scorer swap (OpenAI → Gemini)
// cannot leak into the comparison either.
//
// If the treatment arm moves the stalled cases off 7, sampling is the binding constraint and the fix
// is in the harness. If they hold at 7, the residual is causal mis-attribution and the missing
// structural vocabulary, and effort belongs there instead. Either answer redirects the roadmap.
//
// usage: node recipe-harness/eval/exp_sampling.mjs [--ids=e01,e02,e07] [--treatment=4,5]
//        [--model=<provider default>] [--out=<report.json>]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.resolve(__dirname, '..');
const REPO = path.resolve(HARNESS, '..');
const SCORER = path.join(HARNESS, 'vision', 'gemini_score.mjs');
const RUNNER = path.join(HARNESS, 'runner', 'recipe_runner.mjs');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const ids = (arg('ids', 'e01,e02,e07,e19,e24')).split(',').map(s => s.trim()).filter(Boolean);
const treatment = (arg('treatment', '4,5')).split(',').map(Number);
const model = arg('model', null);   // provider's own default; a name baked in here 404s the moment the credential changes
// REPEATED MEASURES, and this is not optional rigour — it is the difference between a result and an
// artefact. The first run of this experiment reported "3 of 3 improved by +1, one cleared the bar"
// on single draws. Re-scoring ONE unchanged frame pair eight times then produced 7 7 7 7 7 7 8 7 —
// the scorer emits an 8 about one time in eight all by itself. Both arms of the "winning" case had
// identical distributions. The entire headline was noise. Any comparison at this effect size needs
// the spread, not a sample.
const repeats = Number(arg('repeats', 5));
const outPath = path.resolve(arg('out', path.join(__dirname, 'exp_sampling.json')));
const WORK = path.join(REPO, 'shell', 'out', 'exp_sampling');
fs.mkdirSync(WORK, { recursive: true });

// The plan under test is the BEST iteration's — the state the loop actually converged to and then
// could not improve. That is the plateau; testing the first iteration would test something else.
function bestPlanOf(id) {
  const dir = path.join(HARNESS, 'loop', `eval-${id}`);
  const sum = path.join(dir, 'summary.json');
  if (!fs.existsSync(sum)) return null;
  const its = JSON.parse(fs.readFileSync(sum, 'utf8')).iterations || [];
  if (!its.length) return null;
  const best = its.reduce((a, b) => (b.score > a.score ? b : a));
  const planP = path.join(dir, `iter${best.iter}`, 'plan.json');
  const reqP = path.join(dir, `iter${best.iter}`, 'review_request.json');
  if (!fs.existsSync(planP) || !fs.existsSync(reqP)) return null;
  return { id, dir, iter: best.iter, oldScore: best.score, plan: JSON.parse(fs.readFileSync(planP, 'utf8')), req: JSON.parse(fs.readFileSync(reqP, 'utf8')) };
}

function renderAndScore(c, frames, label) {
  const outDir = path.join(WORK, c.id, label);
  fs.mkdirSync(outDir, { recursive: true });

  // Same plan object, one field replaced. Written to disk so the run is reproducible by hand.
  const plan = JSON.parse(JSON.stringify(c.plan));
  plan.renderFrames = frames;
  plan.name = `${plan.name || c.id}_${label}`;      // frame filenames only; compName is untouched
  const planP = path.join(outDir, 'plan.json');
  fs.writeFileSync(planP, JSON.stringify(plan, null, 2));

  const r = spawnSync('node', [RUNNER, planP, '--timeout=300', `--outdir=${outDir}`], { encoding: 'utf8', timeout: 420000 });
  const rendered = (r.stdout || '').split('\n').filter(l => l.includes('✓ ') && l.includes('.png')).map(l => l.trim().replace(/^✓\s*/, ''));
  const pngs = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter(f => f.endsWith('.png') && !f.includes('_score')).map(f => path.join(outDir, f)) : [];
  if (pngs.length < 2) return { error: `only ${pngs.length} frame(s) rendered`, stdout: (r.stdout || '').slice(-300) };

  // Reuse the ORIGINAL review_request verbatim — same intent, same pass criteria, same instructions,
  // same plan text. Only the frames differ, which is the whole point.
  const req = JSON.parse(JSON.stringify(c.req));
  req.frames = pngs.sort();
  req.prior_iterations = [];
  const reqP = path.join(outDir, 'review_request.json');
  fs.writeFileSync(reqP, JSON.stringify(req, null, 2));

  const revP = path.join(outDir, 'review.json');
  const scores = [];
  let last = null, errs = 0;
  for (let k = 0; k < repeats; k++) {
    const s = spawnSync('node', [SCORER, reqP, ...(model ? [`--model=${model}`] : [])], { encoding: 'utf8', timeout: 300000 });
    if (s.status !== 0 || !fs.existsSync(revP)) { errs++; continue; }
    last = JSON.parse(fs.readFileSync(revP, 'utf8'));
    scores.push(last.score);
    fs.copyFileSync(revP, path.join(outDir, `review_${k + 1}.json`));
  }
  if (!scores.length) return { error: `all ${repeats} scoring attempts failed` };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, scores.length - 1));
  return {
    scores, mean: +mean.toFixed(2), sd: +sd.toFixed(2), n: scores.length, errors: errs,
    min: Math.min(...scores), max: Math.max(...scores),
    passFraction: +(scores.filter(x => x >= 8).length / scores.length).toFixed(2),
    verdict: last.verdict, critique: last.critique,
    suggestions: (last.suggestions || []).length, frames: pngs.map(p => path.basename(p)),
    degraded: last._degraded || null,
  };
}

// The mechanism this experiment claims: t1 is under-filled relative to t4. Measure it directly
// rather than inferring it from the critique — a pixel ratio is not a matter of opinion.
function litRatio(dir) {
  const pngs = fs.readdirSync(dir).filter(f => f.endsWith('.png') && !f.includes('_score')).sort();
  if (pngs.length < 2) return null;
  const r = spawnSync('node', [path.join(REPO, 'brownfield', 'frame_delta.mjs'), path.join(dir, pngs[0]), path.join(dir, pngs[1])], { encoding: 'utf8' });
  const m = (r.stdout || '').match(/mean=([\d.]+)/);
  return m ? Number(m[1]) : null;
}

console.log(`sampling experiment — plan UNCHANGED, only renderFrames differ`);
console.log(`  control   [1,4]      (the original protocol)`);
console.log(`  treatment [${treatment.join(',')}]  (late samples, short gap)`);
console.log(`  scorer    ${model} for BOTH arms\n`);

const rows = [];
for (const id of ids) {
  const c = bestPlanOf(id);
  if (!c) { console.log(`${id}: no usable plan on disk — skipped`); continue; }
  process.stdout.write(`${id} (was ${c.oldScore}/10 at iter${c.iter}) … `);

  const control = renderAndScore(c, [1, 4], 'control');
  process.stdout.write(`control=${control.error ? 'ERR' : `${control.mean}±${control.sd}`} `);
  const treat = renderAndScore(c, treatment, 'treatment');
  process.stdout.write(`treatment=${treat.error ? 'ERR' : `${treat.mean}±${treat.sd}`}`);

  const cDir = path.join(WORK, id, 'control'), tDir = path.join(WORK, id, 'treatment');
  const row = {
    id, oldGptScore: c.oldScore, iter: c.iter, control, treatment: treat,
    frameDeltaControl: fs.existsSync(cDir) ? litRatio(cDir) : null,
    frameDeltaTreatment: fs.existsSync(tDir) ? litRatio(tDir) : null,
  };
  if (!control.error && !treat.error) {
    row.delta = +(treat.mean - control.mean).toFixed(2);
    // Separation in units of the pooled spread. Below ~1 the arms are not distinguishable by this
    // many samples, whatever the means happen to be.
    const pooled = Math.sqrt((control.sd ** 2 + treat.sd ** 2) / 2) || 0;
    row.separation = pooled ? +(Math.abs(row.delta) / pooled).toFixed(2) : null;
    process.stdout.write(`  (${row.delta >= 0 ? '+' : ''}${row.delta}, sep ${row.separation ?? 'n/a'})`);
  }
  console.log('');
  rows.push(row);
  fs.writeFileSync(outPath, JSON.stringify({ _date: new Date().toISOString().slice(0, 10), model, treatment, rows }, null, 2));
}

const paired = rows.filter(r => typeof r.delta === 'number');
console.log(`\n=== sampling experiment, n=${paired.length} ===`);
console.log(`${'id'.padEnd(6)} ${'control'.padEnd(20)} ${'treatment'.padEnd(20)} delta   sep`);
for (const r of rows) {
  const fmt = a => a.error ? 'ERR' : `${a.mean}±${a.sd} [${a.scores.join(',')}]`;
  if (r.delta === undefined) { console.log(`${r.id.padEnd(6)} ${fmt(r.control).padEnd(20)} ${fmt(r.treatment).padEnd(20)}`); continue; }
  console.log(`${r.id.padEnd(6)} ${fmt(r.control).padEnd(20)} ${fmt(r.treatment).padEnd(20)} ${r.delta >= 0 ? '+' : ''}${String(r.delta).padEnd(6)} ${r.separation ?? 'n/a'}`);
}
if (paired.length) {
  const mean = paired.reduce((a, r) => a + r.delta, 0) / paired.length;
  const noise = paired.reduce((a, r) => a + (r.control.sd + r.treatment.sd) / 2, 0) / paired.length;
  const separated = paired.filter(r => (r.separation ?? 0) >= 1).length;
  console.log(`\nmean delta ${mean >= 0 ? '+' : ''}${mean.toFixed(2)}  ·  mean within-arm sd ${noise.toFixed(2)}  ·  ${separated}/${paired.length} arms separated by >= 1 sd`);
  // The bar is on a SINGLE score in the real loop, so "would it pass" is a probability, not a fact.
  for (const r of paired) {
    if (r.treatment.passFraction > r.control.passFraction) {
      console.log(`  ${r.id}: P(score>=8) ${r.control.passFraction} → ${r.treatment.passFraction}`);
    }
  }
  console.log(Math.abs(mean) > noise
    ? '\n→ the shift exceeds within-arm noise. Sampling is doing something real; widen n before acting.'
    : '\n→ the shift is WITHIN within-arm noise. This experiment does NOT show sampling to be the binding constraint.');
}
console.log(`\nreport → ${path.relative(REPO, outPath)}`);
