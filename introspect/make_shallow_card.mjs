// make_shallow_card.mjs — mass-produce SHALLOW essence cards, grounded in a live introspection.
//
// Planner-eval round-2 measured why this is the priority: the headless planner went 2/5 on the
// Particular family (which has a deep card) and 0/4 on the native family (which has none). It had
// every native matchName and range available and still could not choose a stack — metadata is not
// a causal model. PRD §八 always called for "shallow essence for breadth"; the eval turned that
// from a plan into the highest-yield thing available.
//
// Shallow ≠ shoddy. A shallow card answers only: what IS this effect, when would you reach for it,
// which handful of its params actually drive the look, and what will bite you. That is what routing
// and first-draft planning need. Deep cards (Particular) stay reserved for the few effects whose
// causal structure genuinely resists a paragraph.
//
// WHY THIS CAN BE CHEAP (PRD §八E, now applied at scale): native and professional plugins give their
// params SEMANTIC NAMES. Introspection hands over "Contrast [ADBE Fractal Noise-0004] range 0..1000"
// — the model does not have to guess what that is. Its own prior does most of the work; the
// introspection supplies the ground truth that keeps matchNames honest.
//
// GROUNDING RULE, enforced mechanically: every matchName the model returns must appear in the live
// introspection card, and every lever must be marked settable. A card that advertises a param that
// does not exist, or one that cannot be written, is worse than no card — it sends the planner and
// the tune loop after something that will throw.
//
// usage: node introspect/make_shallow_card.mjs "<matchName>" ["<matchName>" ...] [--model=...] [--force]
//        node introspect/make_shallow_card.mjs --from=<file with one matchName per line>
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { askJSON, parseJSON, provider } from '../shell/llm.mjs';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const CARDS = path.join(__dirname, 'cards');
const ESSENCE = path.join(__dirname, 'essence');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const model = arg('model', null);   // llm.mjs picks per provider
const force = process.argv.includes('--force');
const fromFile = arg('from', null);
let targets = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (fromFile) targets = fs.readFileSync(path.resolve(fromFile), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
if (!targets.length) { console.error('usage: node introspect/make_shallow_card.mjs "<matchName>" ... | --from=<list.txt>'); process.exit(1); }

// Credentials and provider come from the shared seam (shell/llm.mjs -> shell/keys.mjs). This file
// carried its own inline OpenAI block — the half-a-seam pattern PRD §十三 is about. It was found by
// grepping for `.env.api` after the keychain migration, not by anything failing: it would simply
// have stopped working the next time someone reached for it.
if (!provider()) { console.error('no LLM credential found (GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY)'); process.exit(1); }

const installed = JSON.parse(fs.readFileSync(path.join(__dirname, 'installed_effects.json'), 'utf8')).effects;
const byMatch = new Map(installed.map(e => [e.match, e]));

// Returns the reply TEXT, or null so the caller can skip this effect and continue the batch — one
// unreachable card must not abort a sweep over hundreds.
async function call(prompt) {
  try { return (await askJSON([{ text: prompt }], { model, maxTokens: 8192 })).text; }
  catch (e) { console.error(`  ${String(e).slice(0, 120)}`); return null; }
}

const CONTRACT = `Return STRICT JSON only:
{"essence":"<2-4 sentences: what this effect IS and the causal chain it applies. Write it so someone who has never opened it could predict what moving its main lever does. Name the mechanism, not the marketing.>",
 "when_to_use":["<trigger phrase>", "..."],
 "manifests_as":"<what it LOOKS like on screen, one sentence>",
 "key_levers":[{"name":"<UI name>","matchName":"<exact matchName from the table>","range":[lo,hi],"default":<v>,"units":"<if any>","enum":<true if a mode selector>,
                "effect":"<what moving it DOES, causally — the sentence a planner needs to choose a value>"}],
 "enums_to_verify":{"<Name (matchName, lo-hi)>":"<what you believe the values mean, flagged as unverified>"},
 "config_recipes":{"<named feel>":"<the co-lever combination that produces it, with concrete values>"},
 "reasoning_hooks":["<a trap, dependency or ordering rule a planner would otherwise get wrong>"]}

Rules:
  · key_levers: 4-9 params MAX — only the ones that actually drive the look. A card listing every
    param is a param dump, not a causal model, and helps nobody.
  · Use ONLY matchNames from the table below, copied exactly. Never invent one.
  · when_to_use are retrieval triggers: include both English and Chinese phrasings an artist would
    actually type ("glow", "辉光", "film grain", "颗粒感").
  · enums: AE cannot expose dropdown labels, so any meaning you give an enum value is a BELIEF.
    Put those in enums_to_verify, not in key_levers as if they were established.
  · reasoning_hooks are where the value is: gates, ordering rules, params that do nothing until
    something else is set, defaults that produce nothing visible, things that need animating to read.`;

for (const mn of targets) {
  const meta = byMatch.get(mn);
  const label = meta?.name || mn;
  const safeEss = path.join(ESSENCE, `${label.replace(/[^a-zA-Z0-9]+/g, '_')}.essence.json`);
  if (fs.existsSync(safeEss) && !force) { console.log(`· ${label} — card exists (use --force to rewrite)`); continue; }
  if (!meta) { console.log(`✗ ${mn} — not installed on this machine`); continue; }

  // 1) live introspection (structure + settability on a displayed comp)
  const cardPath = path.join(CARDS, mn.replace(/[^a-zA-Z0-9]+/g, '_') + '.json');
  process.stdout.write(`${label} … introspecting `);
  const r = spawnSync('node', [path.join(__dirname, 'introspect_effect.mjs'), mn], { encoding: 'utf8', timeout: 180000 });
  if (!fs.existsSync(cardPath)) { console.log(`✗ (${(r.stdout || r.stderr || '').trim().split('\n').pop()?.slice(0, 50)})`); continue; }
  const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));

  // Only settable leaves are offered. An unsettable param in a card is a trap — the whole point of
  // the settability pass is that the planner never reaches for one.
  const leaves = card.params.filter(p => p.type !== 'GROUP' && p.matchName && p.settable !== 'hidden' && p.settable !== 'n/a');
  const shut = card.params.filter(p => p.settable === 'hidden');
  const table = leaves.map(p => {
    const rng = (p.min !== undefined && p.max !== undefined) ? ` range ${p.min}..${p.max}` : '';
    return `  ${p.name || '(unnamed)'} [${p.matchName}] type ${p.type}${rng}${p.units ? ' ' + p.units : ''} default ${p.value}`;
  }).join('\n');

  process.stdout.write(`(${leaves.length} settable params) … writing `);
  const prompt = [
    `Write a SHALLOW essence card for the After Effects effect "${meta.name}" (category: ${meta.category}).`,
    'This card will be read by a planner choosing effects for an artist request, and by a visual tune',
    'loop deciding which lever to move next. Accuracy about causality matters more than completeness.',
    '',
    'LIVE INTROSPECTION of this exact build — these are the only matchNames that exist:',
    table,
    shut.length ? `\n(${shut.length} further params are present but NOT WRITABLE on a default instance — do not list them: ${shut.slice(0, 8).map(p => p.name || p.matchName).join(', ')})` : '',
    '',
    CONTRACT,
  ].filter(Boolean).join('\n');

  const text = await call(prompt);
  if (!text) { console.log('✗ (API)'); continue; }
  let body;
  try { body = parseJSON(text); }
  catch { console.log('✗ (unparseable)'); continue; }

  // 2) GROUNDING — drop any lever whose matchName is not real and settable
  const valid = new Set(leaves.map(p => p.matchName));
  const dropped = [];
  body.key_levers = (body.key_levers || []).filter(l => {
    if (!valid.has(l.matchName)) { dropped.push(l.matchName || l.name); return false; }
    return true;
  });

  const out = {
    matchName: mn,
    displayName: meta.name,
    vendor: /^ADBE/.test(mn) ? 'Adobe (native)' : /^CC/.test(mn) ? 'Cycore' : (meta.category || '').split('/')[0].trim(),
    category: meta.category,
    cardDepth: 'shallow',
    ...body,
    ...(shut.length ? { unreachable_levers: shut.map(p => ({ name: p.name, matchName: p.matchName, why: 'not writable on a default instance (settability probe)' })) } : {}),
    ...(dropped.length ? { _droppedUngrounded: dropped } : {}),
    grounding: `matchNames verified against a live introspection of this build (${leaves.length} settable params); levers the model proposed that do not exist or are not settable were dropped`,
    _method: 'introspect/make_shallow_card.mjs — live introspection + model causal knowledge, mechanically grounded',
    _model: model,
    _date: new Date().toISOString().slice(0, 10),
  };
  fs.writeFileSync(safeEss, JSON.stringify(out, null, 1));
  console.log(`✓ ${out.key_levers.length} levers${dropped.length ? `, ${dropped.length} ungrounded dropped` : ''} → essence/${path.basename(safeEss)}`);
}
