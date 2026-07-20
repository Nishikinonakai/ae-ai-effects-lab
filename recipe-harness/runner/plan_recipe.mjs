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
//        [--name=<slug>] [--model=<provider default>] [--pass="a||b"] [--families=native|particular|form|any]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { askJSON, parseJSON, provider } from '../../shell/llm.mjs';
import { loadCards, leverContext } from '../../introspect/essence/lookup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.resolve(__dirname, '..');
const REPO = path.resolve(HARNESS, '..');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const intent = arg('intent', null);
if (!intent) { console.error('usage: node recipe-harness/runner/plan_recipe.mjs --intent="..." [--out=<recipe.json>] [--name=slug]'); process.exit(1); }
const model = arg('model', null);   // llm.mjs picks per provider
const families = arg('families', 'any');
const slug = arg('name', 'planned-' + Date.now().toString(36));
const outPath = path.resolve(arg('out', path.join(HARNESS, 'plans', `${slug}.json`)));
const passCriteria = (arg('pass', '') || '').split('||').map(s => s.trim()).filter(Boolean);

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
  · SAMPLING — you choose "renderFrames", and the whole render will be judged from ONLY those two
    stills, so pick times at which your effect is actually measurable:
      - the FIRST sample must be at steady state. A particle system with life L takes ~L seconds to
        fill; sampling at t=1 with life 8 shows a fraction of the population and reads as "too
        sparse" no matter how high the birth rate goes.
      - the two samples must share a trackable cohort: their gap must be SHORTER than particle life,
        or every particle visible in the first is dead by the second and no motion is inferable.
      - avoid sampling in phase with any periodic expression you write, or both stills catch the
        same moment of the cycle.
    If life is longer than the comp, shorten life rather than sampling early.
  · Motion needs an expression (evolution/offset/rotation driven by \`time\`) — a static value reads
    as a still across both samples.
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

// One shared LLM seam (shell/llm.mjs). This file used to carry its own OpenAI request, so swapping
// the key to Gemini moved the scorer and left both planners reading OPENAI_API_KEY — the whole
// product stopped planning and it read like a config error rather than the architecture gap it was.
//
// A full particle recipe is long (a real Particular stack runs well past 3k tokens) and a truncated
// response is a budget failure, not a planning failure. They look identical from outside — both
// surface as "unparseable JSON" — so llm.mjs names the token-ceiling case explicitly.
if (!provider()) { console.error('no LLM credential found (GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY)'); process.exit(1); }
let text, usedModel;
try {
  const res = await askJSON([{ text: prompt }], { model, maxTokens: 16384 });
  text = res.text; usedModel = res.model;
} catch (e) { console.error('planner failed: ' + String(e).slice(0, 400)); process.exit(1); }

let recipe;
try { recipe = parseJSON(text); }
catch (e) {
  console.error('planner returned unparseable JSON: ' + String(e).slice(0, 200) + '\n' + text.slice(0, 600));
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
