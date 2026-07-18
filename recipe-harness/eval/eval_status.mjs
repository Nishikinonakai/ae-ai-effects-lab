// eval_status.mjs — the planner-eval ledger. Scans loop/eval-*/iter*/review.json
// against eval/prompts.json, writes eval/results.json, prints the summary table +
// per-axis breakdowns (one-shot rate, pass@3, iters-to-pass, library leverage).
//
// usage: node eval/eval_status.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const readJ = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const promptSet = readJ(path.join(__dirname, 'prompts.json'));
const loopRoot = path.join(REPO, 'loop');

const rows = [];
for (const p of promptSet.prompts) {
  const name = `eval-${p.id}`;
  const dir = path.join(loopRoot, name);
  const row = {
    id: p.id, tier: p.tier, family: p.family, dist: p.dist,
    status: 'not_run', iters: 0, scores: [], verdicts: [],
    passIter: null, sources: null,
  };
  const planPath = path.join(__dirname, 'plans', `${name}.json`);
  if (fs.existsSync(planPath)) {
    row.status = 'planned';
    const plan = readJ(planPath);
    row.sources = (plan._planner_sources || []).length;
  }
  if (fs.existsSync(dir)) {
    const iters = fs.readdirSync(dir).filter(d => /^iter\d+$/.test(d))
      .map(d => Number(d.slice(4))).sort((a, b) => a - b);
    for (const n of iters) {
      const rp = path.join(dir, 'iter' + n, 'review.json');
      if (!fs.existsSync(rp)) { row.status = 'awaiting_review'; break; }
      const r = readJ(rp);
      row.iters = n;
      row.scores.push(r.score);
      row.verdicts.push(r.verdict);
      if (r.verdict === 'pass' && row.passIter === null) row.passIter = n;
    }
    if (row.status !== 'awaiting_review' && row.iters > 0)
      row.status = row.passIter !== null ? 'pass' : 'fail';
  }
  rows.push(row);
}

const done = rows.filter(r => r.status === 'pass' || r.status === 'fail');
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '-';

function breakdown(key) {
  const groups = {};
  for (const r of done) (groups[r[key]] ||= []).push(r);
  const out = [];
  for (const [k, g] of Object.entries(groups)) {
    const oneShot = g.filter(r => r.passIter === 1).length;
    const pass3 = g.filter(r => r.passIter !== null && r.passIter <= 3).length;
    out.push(`  ${k.padEnd(10)} n=${g.length}  one-shot ${pct(oneShot, g.length)}  pass@3 ${pct(pass3, g.length)}`);
  }
  return out.join('\n');
}

const pad = (s, n) => String(s ?? '').padEnd(n);
console.log(pad('id', 5) + pad('tier', 5) + pad('family', 11) + pad('dist', 7) +
  pad('status', 16) + pad('scores', 12) + pad('passIter', 9) + 'sources');
for (const r of rows)
  console.log(pad(r.id, 5) + pad(r.tier, 5) + pad(r.family, 11) + pad(r.dist, 7) +
    pad(r.status, 16) + pad(r.scores.join(','), 12) + pad(r.passIter ?? '-', 9) + (r.sources ?? '-'));

if (done.length) {
  const oneShot = done.filter(r => r.passIter === 1).length;
  const pass3 = done.filter(r => r.passIter !== null).length;
  const itersToPass = done.filter(r => r.passIter !== null).map(r => r.passIter);
  console.log(`\nscored ${done.length}/${rows.length}: one-shot ${pct(oneShot, done.length)}, pass@3 ${pct(pass3, done.length)}` +
    (itersToPass.length ? `, mean iters-to-pass ${(itersToPass.reduce((a, b) => a + b, 0) / itersToPass.length).toFixed(1)}` : ''));
  console.log('\nby tier:\n' + breakdown('tier'));
  console.log('by dist:\n' + breakdown('dist'));
  console.log('by family:\n' + breakdown('family'));
}

fs.writeFileSync(path.join(__dirname, 'results.json'),
  JSON.stringify({ generated: null, rows }, null, 2));
console.log('\nwrote eval/results.json');
