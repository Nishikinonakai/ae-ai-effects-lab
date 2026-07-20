// seams.mjs — a lint for the bug that cost the most this session: HALF AN ABSTRACTION.
//
// PRD §十三 documents five instances in one day. Each was the same shape — a seam established in one
// place and bypassed in another — and each was found by a human grepping AFTER something broke:
//
//   1. planners inlined an OpenAI call while the scorer had a provider seam → swapping the key left
//      the product unable to plan at all, reporting "OPENAI_API_KEY missing" as if misconfigured
//   2. the kernel hardcoded gpt-5.6-terra → every call 404'd after the swap
//   3. apply_edit still did first-match-wins after the runner was fixed → ROLLBACK RESTORED THE
//      WRONG EFFECT, on the product path
//   4. two scorers self-loaded .env.api, and two files chose their BACKEND by grepping that file →
//      a key that worked, stored elsewhere, silently reverted them to OpenAI
//   5. make_shallow_card self-loaded .env.api with an inline OpenAI call — it had not failed yet,
//      because nobody had run it since the swap
//
// Why unit tests never caught any of them: HALF A SEAM WORKS FINE UNDER THE CURRENT CONFIG. The 39
// offline assertions were green throughout. Only changing the config separates the halves, and by
// then the symptom looks like something else.
//
// So this does not test behaviour — it tests STRUCTURE, which is the thing that stays wrong while
// everything passes. Every rule below is a pattern that has actually bitten, not a style preference.
// A rule that has never caught a real bug does not belong here; it would only train people to ignore
// the output.
//
// usage: node test/seams.mjs        (also run by test/smoke.mjs)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dumps', 'loop', 'output', 'out', 'frames', 'drafts', 'real_test', 'survey', 'observations', 'build', 'assets']);

function sources(dir = REPO, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) sources(p, acc);
    else if (/\.(mjs|js)$/.test(name)) acc.push(p);
  }
  return acc;
}

// Comments are where these patterns are DESCRIBED — every fix above left a comment naming the thing
// it fixed. Scanning them would flag the documentation of the bug as the bug.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
}

const rules = [
  {
    id: 'provider-model-hardcoded',
    // #2. A provider-specific model name outside the seam is a landmine that only goes off when the
    // credential changes — and then it reports 404, which reads like the model was retired.
    why: 'hardcodes a provider-specific model name; ask shell/llm.mjs defaultModel() instead',
    // A provider-DEDICATED backend may name its own models — that is what it is for. Everything else
    // must ask the seam.
    allow: [/shell\/llm\.mjs$/, /shell\/keys\.mjs$/, /recipe-harness\/vision\/(gpt|claude|gemini)_score\.mjs$/,
            /introspect\/vision\/(claude|gpt|gemini)_describe\.mjs$/,
            /recipe-harness\/vision\/ab_scorers\.mjs$/, /test\/seams\.mjs$/],
    test: src => src.match(/['"`](?:gpt-[\w.-]+|claude-[\w.-]+|gemini-[\w.-]+)['"`]/g) || [],
  },
  {
    id: 'credential-read-direct',
    // #4, #5. Reading the key yourself means you also decide where keys live — and that decision
    // then disagrees with everyone else's the moment storage changes.
    why: 'reads an API key directly; go through shell/keys.mjs loadCredentials()',
    allow: [/shell\/keys\.mjs$/, /shell\/llm\.mjs$/, /recipe-harness\/vision\/(gpt|claude|gemini)_score\.mjs$/,
            /test\/seams\.mjs$/],
    test: src => src.match(/process\.env\.[A-Z_]*API_KEY/g) || [],
  },
  {
    id: 'env-file-read',
    // #4, #5. The plaintext file is a legacy fallback that exactly one module is allowed to know about.
    // Only a real path construction or read counts. Naming the file in an error message is helpful,
    // not a violation — flagging that would have made three of the first four hits noise, and a lint
    // people learn to skim is worse than none.
    why: 'reads recipe-harness/.env.api itself; that file is shell/keys.mjs\'s business',
    allow: [/shell\/keys\.mjs$/, /test\/seams\.mjs$/],
    test: src => src.match(/(?:path\.join|readFileSync|existsSync)\([^)]*['"`]\.env\.api['"`]|['"`][^'"`]*\/\.env\.api['"`]\s*\)/g) || [],
  },
  {
    id: 'backend-chosen-by-file-contents',
    // #4, and the nastiest of them: the key still worked, so nothing failed — the wrong backend was
    // simply selected, silently.
    why: 'picks a backend by grepping a config file; ask provider() so there is one answer',
    allow: [/test\/seams\.mjs$/],
    test: src => src.match(/readFileSync\([^)]*env\.api[^)]*\)[\s\S]{0,120}?(GEMINI|OPENAI|ANTHROPIC)_API_KEY/g) || [],
  },
  {
    id: 'llm-endpoint-inline',
    // #1. The seam exists precisely so a swap moves everything at once.
    why: 'calls an LLM endpoint directly; go through shell/llm.mjs askJSON()',
    allow: [/shell\/llm\.mjs$/, /recipe-harness\/vision\/(gpt|claude|gemini)_score\.mjs$/, /test\/seams\.mjs$/],
    test: src => src.match(/fetch\(\s*[`'"][^`'"]*(?:generativelanguage|api\.openai|api\.anthropic|chat\/completions|generateContent)/g) || [],
  },
  {
    id: 'first-match-wins',
    // #3. Duplicate matchNames on one layer are normal in a real comp; taking "the first one" is a
    // guess that also poisons the recorded inverse, so ROLLBACK aims at the wrong effect.
    why: 'binds to the first matchName match without counting instances; two of the same effect on a layer is normal',
    allow: [/test\/seams\.mjs$/],
    test: src => {
      const hits = [];
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!/matchName\s*===/.test(lines[i])) continue;
        // Find the enclosing loop first — everything else is judged relative to it.
        let start = i;
        while (start > 0 && !/\bfor\s*\(/.test(lines[start])) start--;

        // Scope: the collection being iterated must be an EFFECT PARADE. Params within one effect
        // and levers within one card are unique by construction, so first-match there is correct.
        // Judged from the loop header and the matching line only — a wider window picked up the word
        // "parade" from a neighbouring function and flagged findParam, which searches params.
        const scope = (lines[start] || '') + '\n' + lines[i];
        if (!/(Effect Parade|\.Effects\b|parade)/.test(scope)) continue;

        const terminates = /\b(break|return)\b/.test(lines[i]) || /\b(break|return)\b/.test(lines[i + 1] || '');
        if (!terminates) continue;

        // Does this loop COUNT occurrences? Judged from the loop plus the few lines above it, where
        // the counter is normally set up (`var wantNth = seenOfMatch[...]`). Too wide and correct
        // code masks the bug — a 9-line window missed a re-introduced apply_edit defect because an
        // unrelated `idx &&` guard matched. Too narrow and the counter's declaration falls outside.
        const body = lines.slice(Math.max(0, start - 5), i + 2).join('\n');
        const counts = /(\+\+\s*\w|nSeen|wantNth|sSeen|sWant|wantIdx|seen\s*===|paradeIndex|hits\.push)/.test(body);
        if (!counts) hits.push(lines[i].trim().slice(0, 90));
      }
      return hits;
    },
  },
];

let violations = 0;
const files = sources();
for (const rule of rules) {
  const bad = [];
  for (const f of files) {
    const rel = path.relative(REPO, f);
    if (rule.allow.some(r => r.test(f))) continue;
    const hits = rule.test(stripComments(fs.readFileSync(f, 'utf8')));
    if (hits.length) bad.push({ rel, hits: [...new Set(hits)].slice(0, 3) });
  }
  if (!bad.length) { console.log(`  ✓ ${rule.id}`); continue; }
  violations += bad.length;
  console.log(`  ✗ ${rule.id} — ${rule.why}`);
  for (const b of bad) console.log(`      ${b.rel}: ${b.hits.join('  ')}`);
}

console.log(`\n${files.length} files scanned, ${violations} violation(s)`);
if (violations) {
  console.log('\nThis is the "half an abstraction" pattern — see PRD §十三. It passes every unit test');
  console.log('until the config changes, and then it fails as something else.');
}
export default violations;
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(violations ? 1 : 0);
}
