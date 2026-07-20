// ab_scorers.mjs — score the SAME stored review_requests with different backends and compare.
//
// Swapping the scorer swaps the measuring instrument for every number this repo produces, so it
// cannot be done on vibes. Every prior review_request.json is still on disk next to the answer the
// old backend gave, which makes a genuine paired comparison possible: identical frames, identical
// intent, identical instructions, different scorer.
//
// What actually matters for this loop is NOT agreement with the old scorer. A scorer earns its place
// by (a) catching real defects — a lenient scorer ends the loop early with a bad render, and (b)
// emitting causally useful suggestions — the loop applies them mechanically, so a plausible-sounding
// nudge on the wrong lever is worse than none. Agreement is only interesting where it breaks.
//
// usage: node recipe-harness/vision/ab_scorers.mjs --models=gemini-3.5-flash,gemini-3.1-pro-preview
//        [--n=10] [--out=<report.json>]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.resolve(__dirname, '..');
const REPO = path.resolve(HARNESS, '..');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const models = (arg('models', 'gemini-3.5-flash')).split(',').map(s => s.trim()).filter(Boolean);
const N = Number(arg('n', 10));
const outPath = path.resolve(arg('out', path.join(__dirname, 'ab_report.json')));

// Collect every (request, old answer) pair that still has both halves and real frames on disk.
const cases = [];
for (const dir of fs.readdirSync(path.join(HARNESS, 'loop')).filter(d => d.startsWith('eval-'))) {
  const base = path.join(HARNESS, 'loop', dir);
  for (const it of fs.readdirSync(base).filter(d => /^iter\d+$/.test(d))) {
    const reqP = path.join(base, it, 'review_request.json');
    const revP = path.join(base, it, 'review.json');
    if (!fs.existsSync(reqP) || !fs.existsSync(revP)) continue;
    try {
      const req = JSON.parse(fs.readFileSync(reqP, 'utf8'));
      const rev = JSON.parse(fs.readFileSync(revP, 'utf8'));
      if (!(req.frames || []).every(f => fs.existsSync(f))) continue;
      if (!/gpt/.test(rev._backend || '')) continue;     // only compare against the old GPT answers
      cases.push({ id: `${dir}/${it}`, reqP, old: rev });
    } catch { /* skip malformed */ }
  }
}

// Stratify across the old score range rather than taking the first N — the interesting disagreements
// are at the ends (did it catch the disaster? did it confirm the win?), not in the 7-band bulk.
cases.sort((a, b) => (a.old.score - b.old.score) || a.id.localeCompare(b.id));
const picked = cases.length <= N ? cases
  : Array.from({ length: N }, (_, i) => cases[Math.floor(i * cases.length / N)]);

console.log(`${cases.length} scorable cases on disk; comparing ${picked.length} across models: ${models.join(', ')}\n`);

const rows = [];
for (const c of picked) {
  const row = { id: c.id, gpt: { score: c.old.score, verdict: c.old.verdict, critique: c.old.critique, suggestions: (c.old.suggestions || []).map(s => `${s.type}:${s.matchName || s.effect || ''}`) } };
  process.stdout.write(`${c.id.padEnd(22)} gpt=${String(c.old.score).padStart(2)}`);
  for (const m of models) {
    // score into a scratch dir so the stored review.json is never overwritten
    const tmp = path.join(REPO, 'shell', 'out', 'ab', c.id.replace(/\//g, '_'), m);
    fs.mkdirSync(tmp, { recursive: true });
    fs.copyFileSync(c.reqP, path.join(tmp, 'review_request.json'));
    const r = spawnSync('node', [path.join(__dirname, 'gemini_score.mjs'), path.join(tmp, 'review_request.json'), `--model=${m}`],
      { encoding: 'utf8', timeout: 300000 });
    const outFile = path.join(tmp, 'review.json');
    if (r.status !== 0 || !fs.existsSync(outFile)) {
      row[m] = { error: (r.stderr || r.stdout || 'failed').trim().split('\n').pop()?.slice(0, 80) };
      process.stdout.write(`  ${m}=ERR`);
      continue;
    }
    const rev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    row[m] = {
      score: rev.score, verdict: rev.verdict, critique: rev.critique,
      suggestions: (rev.suggestions || []).map(s => `${s.type}:${s.matchName || s.effect || ''}`),
      inconsistent: (rev.verdict === 'pass' && rev.score < 8) || (rev.verdict === 'fail' && rev.score >= 8),
      degraded: rev._degraded || null,
    };
    process.stdout.write(`  ${m}=${String(rev.score).padStart(2)}${row[m].inconsistent ? '!' : ' '}`);
  }
  console.log('');
  rows.push(row);
}

// ---- rollup ------------------------------------------------------------------------------------
const stat = m => {
  const vals = rows.map(r => r[m]).filter(x => x && !x.error);
  if (!vals.length) return null;
  const scores = vals.map(v => v.score);
  const paired = rows.filter(r => r[m] && !r[m].error);
  const diffs = paired.map(r => r[m].score - r.gpt.score);
  return {
    n: vals.length,
    mean: +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2),
    meanDeltaVsGpt: +(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(2),
    meanAbsDelta: +(diffs.reduce((a, b) => a + Math.abs(b), 0) / diffs.length).toFixed(2),
    passRate: +(100 * vals.filter(v => v.score >= 8).length / vals.length).toFixed(0),
    inconsistentVerdicts: vals.filter(v => v.inconsistent).length,
    emptySuggestionsOnFail: vals.filter(v => v.score < 8 && !v.suggestions.length).length,
    meanSuggestions: +(vals.reduce((a, v) => a + v.suggestions.length, 0) / vals.length).toFixed(2),
    errors: rows.filter(r => r[m]?.error).length,
  };
};
const gptStat = {
  n: rows.length,
  mean: +(rows.reduce((a, r) => a + r.gpt.score, 0) / rows.length).toFixed(2),
  passRate: +(100 * rows.filter(r => r.gpt.score >= 8).length / rows.length).toFixed(0),
  emptySuggestionsOnFail: rows.filter(r => r.gpt.score < 8 && !r.gpt.suggestions.length).length,
  meanSuggestions: +(rows.reduce((a, r) => a + r.gpt.suggestions.length, 0) / rows.length).toFixed(2),
};

const report = { _date: new Date().toISOString().slice(0, 10), models, cases: picked.length, gpt: gptStat, byModel: Object.fromEntries(models.map(m => [m, stat(m)])), rows };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`\n=== paired comparison, n=${rows.length} ===`);
console.log(`${'backend'.padEnd(26)} mean  Δvs gpt  |Δ|   pass%  bad-verdict  no-sugg-on-fail  mean-sugg`);
console.log(`${'gpt-5.6-terra (stored)'.padEnd(26)} ${String(gptStat.mean).padStart(4)}      —      —   ${String(gptStat.passRate).padStart(4)}%            —  ${String(gptStat.emptySuggestionsOnFail).padStart(15)}  ${String(gptStat.meanSuggestions).padStart(9)}`);
for (const m of models) {
  const s = stat(m); if (!s) { console.log(`${m.padEnd(26)} (all failed)`); continue; }
  console.log(`${m.padEnd(26)} ${String(s.mean).padStart(4)}  ${String(s.meanDeltaVsGpt).padStart(6)}  ${String(s.meanAbsDelta).padStart(4)}  ${String(s.passRate).padStart(4)}%  ${String(s.inconsistentVerdicts).padStart(11)}  ${String(s.emptySuggestionsOnFail).padStart(15)}  ${String(s.meanSuggestions).padStart(9)}`);
}
console.log(`\nreport → ${path.relative(REPO, outPath)}`);
