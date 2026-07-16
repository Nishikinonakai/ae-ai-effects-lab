// merge_scores.mjs — merge a verdicts JSON (from the agent-vision scoring pass) into
// validation/scores.json, preserving untouched entries and stamping the round.
//
// usage: node mining/merge_scores.mjs <verdicts.json> <round-tag>
//   verdicts.json: { "<slug>": {"verdict":"match|partial|fail","class":"<cluster>"}, ... }
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCORES = path.join(__dirname, 'validation', 'scores.json');

const [vPath, round] = process.argv.slice(2);
if (!vPath || !round) { console.error('usage: node merge_scores.mjs <verdicts.json> <round>'); process.exit(1); }

const verdicts = JSON.parse(fs.readFileSync(vPath, 'utf8'));
const doc = fs.existsSync(SCORES)
  ? JSON.parse(fs.readFileSync(SCORES, 'utf8'))
  : { backend: 'agent-vision', scores: {} };

let n = 0;
for (const [slug, v] of Object.entries(verdicts)) {
  doc.scores[slug] = { verdict: v.verdict, class: v.class, round };
  n++;
}
doc.backend = 'agent-vision';
doc.date = new Date().toISOString().slice(0, 10);
fs.writeFileSync(SCORES, JSON.stringify(doc, null, 1));

const tally = {};
for (const s of Object.values(doc.scores)) tally[s.verdict] = (tally[s.verdict] || 0) + 1;
console.log(`merged ${n} verdicts (round ${round}); tally now:`, JSON.stringify(tally));
