// usage: node shell/calibrate_decisions.mjs [decisions.jsonl]
import fs from 'fs';
import os from 'os';
import path from 'path';
import { summarizeDecisions } from './calibration.mjs';

const file = path.resolve(process.argv[2] || path.join(os.homedir(), 'Documents', 'ae-ai-shell', 'decisions.jsonl'));
if (!fs.existsSync(file)) {
  console.error(`no decisions file: ${file}`);
  process.exit(1);
}

const rows = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try { rows.push(JSON.parse(line)); } catch { /* a corrupt line cannot erase the usable labels */ }
}
const s = summarizeDecisions(rows);
console.log(`labels ${s.labels}: ${s.keeps} Keep / ${s.rollbacks} Roll back · scored ${s.scored} · unscored ${s.unscored}`);
console.log('score  Keep  Roll back');
for (const score of Object.keys(s.byScore).map(Number).sort((a, b) => a - b)) {
  const b = s.byScore[String(score)];
  console.log(`${String(score).padStart(5)}  ${String(b.keep).padStart(4)}  ${String(b.rollback).padStart(9)}`);
}
console.log('\nbar  auto  false-accept  keep-coverage');
for (const c of s.candidates.filter(c => c.autoAccepts > 0)) {
  console.log(`${String(c.bar).padStart(3)}  ${String(c.autoAccepts).padStart(4)}  ${String(c.falseAccepts).padStart(12)}  ${c.keepCoverage === null ? '—' : `${(c.keepCoverage * 100).toFixed(1)}%`.padStart(13)}`);
}
console.log(`\nlowest observed zero-false-accept bar: ${s.lowestObservedZeroFalseAcceptBar ?? 'none'}`);
