// promote_matches.mjs — promote match-verdict mined drafts into the recipe library.
//
// For every scores.json entry with verdict "match": copy its draft to
// recipes/mined/<slug>.json, stripped of mining debug fields (_unmapped/_curves/
// _map_coverage/_dropped_inert) and stamped with provenance (_mined_from, _validated).
// Existing promoted files are overwritten (scores are the source of truth).
//
// usage: node mining/promote_matches.mjs [--dry]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const OUT = path.join(REPO, 'recipes', 'mined');
const dry = process.argv.includes('--dry');
const flag = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] || d;
const valDir = flag('val', 'validation');
const catName = flag('catalog', 'catalog.json');

const scores = JSON.parse(fs.readFileSync(path.join(__dirname, valDir, 'scores.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, catName), 'utf8'));
const draftBySlug = new Map(catalog.presets.map(p => [path.basename(p.draft, '.json'), p.draft]));

fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const [slug, s] of Object.entries(scores.scores)) {
  if (s.verdict !== 'match') continue;
  const rel = draftBySlug.get(slug);
  if (!rel) { console.warn(`  no draft for ${slug}`); continue; }
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, rel), 'utf8'));
  const recipe = { ...d };
  for (const k of ['_unmapped', '_curves', '_map_coverage', '_dropped_inert', '_pack', '_category']) delete recipe[k];
  recipe._validated = { round: s.round, verdict: s.verdict, backend: scores.backend };
  if (!dry) fs.writeFileSync(path.join(OUT, slug + '.json'), JSON.stringify(recipe, null, 2));
  n++;
}
console.log(`${dry ? '[dry] ' : ''}promoted ${n} match drafts -> ${OUT}`);
