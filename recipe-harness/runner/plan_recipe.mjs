// plan_recipe.mjs — the GREENFIELD headless planner: intent → a runnable recipe, no session needed.
//
// `shell/plan_edit.mjs` closed the brownfield half of this (modify what already exists). This is the
// other half: author a stack from nothing. Both existed only as the agent reasoning in-session,
// which is why planner-eval round-1 had to be driven prompt-by-prompt by hand — 24 prompts, one
// session. With this, round-2 is a batch job.
//
// The 2026-07-17 generalization decision shapes the design: **recipes are priors the model reasons
// FROM, not a table it looks up.** So the context handed over is deliberately a catalogue, not a
// match — every library recipe as one line (intent + the effect stack it used), plus the essence
// cards, plus the installed-effect list. The model picks its own structure; the library is there to
// show what has worked, not to be copied.
//
// Two mechanical guards, the same ones that make the brownfield planner safe:
//   1. every effect matchName must exist in installed_effects.json  — else the runner fails at apply
//   2. every param matchName must belong to that effect (prefix rule) — else it fails per-param
// A plan that names a param that cannot exist is rejected before it costs a render.
//
// usage: node recipe-harness/runner/plan_recipe.mjs --intent="..." [--out=<recipe.json>]
//        [--name=<slug>] [--model=gpt-5.6-terra] [--pass="a||b"] [--families=native|particular|form|any]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadCards, leverContext } from '../../introspect/essence/lookup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.resolve(__dirname, '..');
const REPO = path.resolve(HARNESS, '..');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const intent = arg('intent', null);
if (!intent) { console.error('usage: node recipe-harness/runner/plan_recipe.mjs --intent="..." [--out=<recipe.json>] [--name=slug]'); process.exit(1); }
const model = arg('model', 'gpt-5.6-terra');
const families = arg('families', 'any');
const slug = arg('name', 'planned-' + Date.now().toString(36));
const outPath = path.resolve(arg('out', path.join(HARNESS, 'plans', `${slug}.json`)));
const passCriteria = (arg('pass', '') || '').split('||').map(s => s.trim()).filter(Boolean);

// ---- env (.env.api fallback), same seam as the scorer ----
const envFile = path.join(HARNESS, '.env.api');
if ((!process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL) && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const API_KEY = process.env.OPENAI_API_KEY;
const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
if (!API_KEY) { console.error('OPENAI_API_KEY missing (env or recipe-harness/.env.api)'); process.exit(1); }

// ---- what exists on THIS machine (the generalization anchor) -----------------------------------
const installed = JSON.parse(fs.readFileSync(path.join(REPO, 'introspect', 'installed_effects.json'), 'utf8')).effects;
const installedByMatch = new Map(installed.map(e => [e.match, e]));

// ---- the library as a CATALOGUE, one line per recipe --------------------------------------------
// Full recipes would swamp the context (golden-dust alone is 20 params). One line each — what it was
// for, and which effects it reached for — is enough to convey "this is the shape of a solution".
function catalogue() {
  const dirs = [path.join(HARNESS, 'recipes'), path.join(HARNESS, 'recipes', 'native'), path.join(HARNESS, 'recipes', 'mined')];
  const rows = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (!r.effects) continue;
        const stack = r.effects.map(e => e.matchName).join(' → ');
        rows.push(`${(r.name || f).padEnd(28)} ${stack}\n${' '.repeat(29)}intent: ${String(r.intent || '').slice(0, 150)}`);
      } catch { /* a malformed draft should not sink the planner */ }
    }
  }
  return rows;
}

// ---- effect palette --------------------------------------------------------------------------
// 1522 installed effects will not fit, and dumping them would drown the signal anyway. Give the
// model the effects it has CAUSAL knowledge about (essence cards) in full, plus a name-only roster
// of the native + Trapcode sets, which are the families the library actually draws on.
const cards = loadCards();
const cardBlock = leverContext(cards.map(c => c.matchName || c.primaryMatchName).filter(Boolean)).block;
const roster = installed
  .filter(e => !/obsolete/i.test(e.category))
  .filter(e => /^(ADBE|CC|tc )/.test(e.match))
  .map(e => `${e.name} [${e.match}]`);

const CONTRACT = `Return STRICT JSON only — a recipe the runner can execute:
{"name":"<slug>",
 "compName":"<CompName>",
 "intent":"<restate the artist's intent, in their language>",
 "comp":{"width":1280,"height":720,"fps":30,"duration":6},
 "background":[r,g,b],                    // 0..1
 "hostName":"Artwork",
 "effects":[{"matchName":"<effect matchName>",
             "params":[["<param matchName>", <value>, "<label saying WHY>"], ...],
             "expressions":[["<param matchName>","<AE expression>","<label>"], ...]}],
 "renderFrames":[1,4],
 "_rationale":"<why this stack, in two sentences>"}

Rules:
  · Effects are applied to ONE host layer in the order listed — that order IS the compositing order.
  · Use only matchNames from the palette below. A matchName that does not exist fails at apply time
    and costs a whole render cycle, so do not guess: if you are unsure an effect exists, pick one you
    can see. Param matchNames are "<effect matchName>-<digits>" — they must belong to the effect they
    are listed under.
  · Params are applied IN ORDER and order matters: a param hidden behind a gate must come AFTER the
    param that opens it, or the write throws.
  · Prefer the smallest stack that could read as the intent. Two well-chosen effects beat six.
  · Motion: render frames are ${JSON.stringify([1, 4])} seconds apart, so anything meant to move needs an
    expression (evolution/offset/rotation driven by \`time\`) — a static value will read as a still.
  · The library below is PRIOR ART, not a lookup table. Reason from what those stacks were doing;
    do not copy one unless it genuinely fits.`;

const prompt = [
  'You are the planning stage of an After Effects effects assistant. Author a stack that realises the',
  "artist's request, from an empty comp.",
  '',
  `ARTIST INTENT: ${intent}`,
  passCriteria.length ? 'It will be judged against:\n' + passCriteria.map(c => `  - ${c}`).join('\n') : '',
  families !== 'any' ? `Prefer the ${families} family unless it cannot express this.` : '',
  '',
  '=== EFFECTS WITH A KNOWN CAUSAL MODEL (use these levers by name; ⟨gated⟩ ones need their gate set first) ===',
  cardBlock || '(no essence cards available)',
  '',
  `=== OTHER INSTALLED EFFECTS (name-only roster, ${roster.length}) ===`,
  roster.join(' · '),
  '',
  '=== PRIOR ART — what has worked before (stack + what it was for) ===',
  catalogue().join('\n'),
  '',
  CONTRACT,
].filter(Boolean).join('\n');

async function call(body, tries = 3) {
  for (let a = 1; a <= tries; a++) {
    try {
      const r = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body,
      });
      if (r.ok) return r.json();
      const t = (await r.text()).slice(0, 300);
      if (r.status < 500 && r.status !== 429) { console.error(`API ${r.status}: ${t}`); process.exit(1); }
      console.error(`API ${r.status} (attempt ${a}/${tries})`);
    } catch (e) { console.error(`fetch error (attempt ${a}/${tries}): ${String(e).slice(0, 140)}`); }
    if (a < tries) await new Promise(r => setTimeout(r, a * 4000));
  }
  console.error('API unreachable after retries'); process.exit(1);
}

// A full particle recipe is long — a Particular stack with a real param set runs well past 3k
// tokens, and a truncated response is not a planning failure but a budget failure. They look
// identical from the outside (both surface as "unparseable JSON"), so say which one happened.
const data = await call(JSON.stringify({ model, max_completion_tokens: 8000, messages: [{ role: 'user', content: prompt }] }));
const choice = data.choices?.[0];
const text = (choice?.message?.content || '').trim();
let recipe;
try { recipe = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
catch {
  if (choice?.finish_reason === 'length') {
    console.error(`planner response hit the token ceiling (${text.length} chars) and was cut mid-JSON — raise max_completion_tokens or ask for a smaller stack.`);
  } else {
    console.error('planner returned unparseable JSON:\n' + text.slice(0, 600));
  }
  process.exit(1);
}

// ---- mechanical validation ---------------------------------------------------------------------
// The runner reports per-param failures, but each one costs a bridge round-trip and a render. A
// matchName that provably cannot exist is cheaper to catch here.
const problems = [];
recipe.effects = (recipe.effects || []).filter(fx => {
  if (!installedByMatch.has(fx.matchName)) {
    problems.push(`effect "${fx.matchName}" is not installed on this machine — dropped`);
    return false;
  }
  fx.params = (fx.params || []).filter(p => {
    const mn = Array.isArray(p) ? p[0] : p?.matchName;
    if (typeof mn !== 'string') { problems.push(`malformed param entry on ${fx.matchName} — dropped`); return false; }
    // param matchNames belong to their effect; a mismatch means the model borrowed one from elsewhere
    if (!mn.startsWith(fx.matchName) && !mn.startsWith('ADBE Effect')) {
      problems.push(`param "${mn}" does not belong to ${fx.matchName} — dropped`);
      return false;
    }
    return true;
  });
  return true;
});

recipe.name ||= slug;
recipe.compName ||= slug.replace(/[^a-zA-Z0-9]+/g, '_');
recipe.intent ||= intent;
recipe.comp ||= { width: 1280, height: 720, fps: 30, duration: 6 };
recipe.background ||= [0, 0, 0];
recipe.hostName ||= 'Artwork';
recipe.renderFrames ||= [1, 4];
recipe._planner = { model, date: new Date().toISOString().slice(0, 10) };
if (problems.length) recipe._validation = problems;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(recipe, null, 2));

console.log(`\n=== plan for "${intent}" ===`);
console.log(`rationale: ${recipe._rationale || '(none given)'}`);
for (const fx of recipe.effects) {
  const e = installedByMatch.get(fx.matchName);
  console.log(`  ${e?.name || fx.matchName} [${fx.matchName}] — ${(fx.params || []).length} param(s), ${(fx.expressions || []).length} expression(s)`);
}
for (const p of problems) console.log(`  ⚠ ${p}`);
if (!recipe.effects.length) console.log('  (no usable effects survived validation)');
console.log(`\nrecipe → ${path.relative(REPO, outPath)}`);
console.log(`next: node recipe-harness/runner/recipe_runner.mjs ${path.relative(REPO, outPath)}`);
process.exit(recipe.effects.length ? 0 : 4);
