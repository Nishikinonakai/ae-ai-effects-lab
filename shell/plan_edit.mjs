// plan_edit.mjs — the headless BROWNFIELD PLANNER: "what should I change?" as a runnable component.
//
// Every loop in this repo already runs headless except the one step that mattered most: deciding
// what edit to make. That decision was always the agent reasoning in-session, which is why the lab
// needs a human-in-the-loop session to do anything. A product cannot ship that. This closes it —
// intent + perception + the essence index → a validated apply_edit spec, no session required.
//
// The three inputs mirror what the agent actually looks at:
//   1. the INTENT, in the artist's words
//   2. dump_comp's PERCEPTION — what layers exist, their inferred roles, their real param values,
//      what is live at this frame, what is keyframed, what is an opaque core
//   3. the ESSENCE INDEX — the causal model of the effects that are actually present
// plus the rendered FRAME, so the plan is grounded in how the comp currently LOOKS, not just how
// it is configured.
//
// The output is a seed for tune_edit, not a final answer: the visual loop is what converges it.
// So this optimises for "a plausible first move on the right lever" over "correct in one shot".
//
// ANTI-HALLUCINATION: every matchName the model returns is checked against the perception dump
// before the spec is written. A param edit must name an effect that exists on that layer and a
// param that exists on that effect. This is the same guard review_schema applies to the scorer,
// enforced here mechanically rather than by instruction — a plan that references a param that
// isn't there would burn a whole apply→render→verify cycle to discover it.
//
// usage: node shell/plan_edit.mjs --intent="..." --state=<comp_state.json> [--frame=<frame.png>]
//        [--out=<spec.json>] [--model=gpt-5.6-terra] [--layer=N]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { leverContext, loadCards } from '../introspect/essence/lookup.mjs';
import { askJSON, parseJSON, provider, defaultModel } from './llm.mjs';
import { validateEdits } from './plan_validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const intent = arg('intent', null);
const statePath = arg('state', null);
if (!intent || !statePath) {
  console.error('usage: node shell/plan_edit.mjs --intent="..." --state=<comp_state.json> [--frame=<f.png>] [--out=<spec.json>]');
  process.exit(1);
}
const model = arg('model', null);   // null = whatever llm.mjs picks for the available credential
const outPath = path.resolve(arg('out', path.join(REPO, 'shell', 'out', 'plan_spec.json')));
const forcedLayer = arg('layer', null) ? Number(arg('layer')) : null;

const state = JSON.parse(fs.readFileSync(path.resolve(statePath), 'utf8'));

// ---- compress perception into something a prompt can hold ----------------------------------
// A real comp dump is enormous (Particular alone reports 400 params). Sending it whole would bury
// the signal and blow the context, so each effect contributes its essence-card key levers first —
// the params with a known causal meaning — then fills the remainder in declaration order.
const PARAMS_PER_EFFECT = 14;
function summariseEffect(fx) {
  const card = leverContext([fx.matchName]).levers;
  const keyMNs = new Set(card.map(l => l.matchName));
  const params = fx.params || [];
  const keyed = params.filter(p => keyMNs.has(p.matchName));
  const rest = params.filter(p => !keyMNs.has(p.matchName));
  const chosen = [...keyed, ...rest].slice(0, PARAMS_PER_EFFECT);
  return {
    // paradeIndex = WHICH instance. Two copies of one effect on a layer is routine (the KillKiss
    // lyric twins), and without seeing the slot the model cannot address the second one even in
    // principle — it would emit an unpinned edit apply_edit then refuses as AMBIGUOUS.
    matchName: fx.matchName, ...(fx.paradeIndex != null ? { paradeIndex: fx.paradeIndex } : {}),
    name: fx.name, enabled: fx.enabled, paramCount: fx.paramCount,
    ...(fx.opaqueCore ? { opaqueCore: fx.opaqueCore } : {}),
    params: chosen.map(p => ({
      matchName: p.matchName, name: p.name, value: p.value,
      ...(p.numKeys ? { numKeys: p.numKeys } : {}),          // keyframed → needs a keyframeMode
      ...(p.expression ? { expression: String(p.expression).slice(0, 80) } : {}),
    })),
    ...(params.length > chosen.length ? { _truncated: params.length - chosen.length } : {}),
  };
}

// Only layers LIVE at this frame can affect what the artist is looking at. A dead layer is not a
// candidate for "make the glow wider" — editing it would produce a confidently inert result.
const liveLayers = (state.layers || []).filter(l => l.activeNow);
const perception = {
  comp: state.comp, size: `${state.width}x${state.height}`, fps: state.fps, time: state.time,
  numLayers: state.numLayers, liveAtThisFrame: state.activeCount,
  ...(state.missingLive ? { WARNING_missingFootage: `${state.missingLive} live layer(s) have OFFLINE source — the frame shows colour-bar placeholders, do not judge the look from it` } : {}),
  layers: liveLayers.map(l => ({
    index: l.index, name: l.name, role: l.role, blendMode: l.blendMode, trackMatte: l.trackMatte,
    ...(l.text !== undefined ? { text: l.text } : {}),   // text layers: what they currently say
    effects: (l.effects || []).map(summariseEffect),
  })),
};

// --- what the planner is allowed to reach for ---------------------------------------------------
// Two different questions need two different palettes, and conflating them was a real failure:
//   "tune what is here"  → the effects already on the live layers
//   "ADD something"      → everything installed on this machine
// This only ever supplied the first. On a bare solid with no effects the essence context came back
// EMPTY, so the model could not know Particular existed — and correctly refused to invent a
// matchName, producing an honest "I can't do that" for a request that was entirely doable. Found by
// clicking the panel by hand: "add a disc-shaped particle convergence" on an empty layer.
const presentEffects = [...new Set(liveLayers.flatMap(l => (l.effects || []).map(f => f.matchName)))];

const installedPath = path.join(REPO, 'introspect', 'installed_effects.json');
const installed = fs.existsSync(installedPath) ? JSON.parse(fs.readFileSync(installedPath, 'utf8')).effects : [];
const installedByMatch = new Map(installed.map(e => [e.match, e]));
// Effects with a causal model get their full lever block; the rest are a name-only roster, which is
// enough for the model to know something exists and reach for it by matchName.
const cardedEffects = loadCards().map(c => c.matchName || c.primaryMatchName).filter(Boolean);
const lc = leverContext([...new Set([...presentEffects, ...cardedEffects])]);
const roster = installed
  .filter(e => !/obsolete/i.test(e.category))
  .filter(e => /^(ADBE|CC|tc |VIDEOCOPILOT|BCC|S_|PEDG)/.test(e.match))
  .filter(e => !cardedEffects.includes(e.match))
  .map(e => `${e.name} [${e.match}]`);


const SPEC_CONTRACT = `Return STRICT JSON only, in this shape:
{"targetLayer": <layer index to edit>,
 "rationale": "<one or two sentences: what you are changing and WHY it serves the intent>",
 "passCriteria": ["<observable visual criterion>", "..."],
 "edits": [ <one or more apply_edit ops> ]}

apply_edit ops:
  {"op":"param","layerIndex":N,"effectMatchName":"<fx matchName>","paramMatchName":"<param matchName>","value":<number | [r,g,b] 0..1> [,"effectIndex":<paradeIndex>]}
      · if the param has "numKeys" in the perception dump it is KEYFRAMED and you MUST add
        "keyframeMode":"scale"     (value is a MULTIPLIER applied to every key, preserving the envelope)
        or "keyframeMode":"setAtTime" (value is ABSOLUTE, set at the current playhead)
      · if the layer carries MORE THAN ONE instance of the same effect (same matchName twice), you
        MUST add "effectIndex": the "paradeIndex" (from the perception dump) of the instance you
        mean — without it the edit cannot say which copy and will be refused. With a single
        instance it may be omitted.
  {"op":"addEffect","layerIndex":N,"effectMatchName":"<fx matchName>"}
  {"op":"expression","layerIndex":N,"target":"position"|"scale"|"rotation"|"opacity"|"anchor","expression":"<AE expression>"}
  {"op":"textContent","layerIndex":N,"text":"<full replacement string>"}
      · replaces a TEXT layer's source text (layers with a "text" field in the perception dump).
        Whole-string replacement. A layer whose text shows [KEYFRAMED×n] cannot be edited this way.
  {"op":"addLayer","kind":"solid"|"adjustment" [,"name":"<label>"] [,"color":[r,g,b] 0..1]}
      · creates a NEW full-comp layer at the TOP of the stack. Use it whenever the request needs its
        own canvas — a generative effect (rain, snow, noise, particles), an overlay texture, or a
        grade above everything — instead of painting on an unrelated existing layer.
      · in LATER edits of this same spec, address the new layer as "layerIndex": 0 and keep using
        the PERCEPTION indices for all pre-existing layers — the applier re-maps them automatically.
      · "adjustment" affects every layer below it (grades/distortion); "solid" is a fresh opaque
        canvas for generative effects.

Rules:
  · Use ONLY matchNames that appear in the PERCEPTION dump, the lever list, or the installed roster.
    Never invent one.
  · If the request asks for something the comp does not have yet, ADD the effect that provides it —
    the roster above is what is available. Do not report the request as impossible just because the
    layer is currently bare; a bare layer is the normal starting point for "add X".
  · Prefer the FEWEST edits that could plausibly achieve the intent — this is a seed the visual
    loop will refine, not a finished look. Two or three well-chosen levers beat ten guesses.
  · Read the CURRENT VALUES before choosing. If a lever is already at the value you want, it is not
    the lever to move. If a gate-like param (a luminance threshold, an enable, a view mode) is set
    so the effect cannot contribute, open it FIRST — nothing downstream can matter while it is shut.
  · A lever marked ⟨gated⟩ in the lever list is NOT writable until its named gate is opened. To use
    one, emit TWO edits in order: the gate first, then the lever. Emitting the lever alone throws
    and wastes the whole apply→render→verify cycle. Edits are applied in the order you list them.
  · Edit a layer that is LIVE at this frame; the dump lists only those.
  · If an effect is marked opaqueCore, its load-bearing state (matte/solve/scene) is NOT scriptable.
    Do not pretend a param edit creates it. Either edit a different layer, or return an empty edits
    array with a rationale saying which handoff the user must perform.`;

const prompt = [
  'You are the planning stage of an After Effects assistant. The artist has described what they want;',
  'you decide the concrete edit to make to their EXISTING composition.',
  '',
  `ARTIST INTENT: ${intent}`,
  forcedLayer ? `The artist has selected layer ${forcedLayer} — target that layer unless it is impossible.` : '',
  '',
  'PERCEPTION — the live state of their comp (real values, read from the project just now):',
  JSON.stringify(perception, null, 1),
  '',
  lc.block || '(no essence cards available)',
  '',
  `=== OTHER EFFECTS INSTALLED ON THIS MACHINE (name-only, ${roster.length}) — you MAY add any of these ===`,
  roster.join(' · '),
  '',
  'The rendered frame at the current playhead follows. This is what the artist is looking at right now.',
  '',
  SPEC_CONTRACT,
].filter(Boolean).join('\n');

// One shared LLM seam (shell/llm.mjs) rather than an inline provider call. This file used to carry
// its own OpenAI request, so swapping the key to Gemini moved the scorer and left the planner
// reading OPENAI_API_KEY — every request died at "planning failed" and the product was completely
// unusable until a hand-driven run surfaced it.
const content = [{ text: prompt }];
const framePath = arg('frame', null);
if (framePath && fs.existsSync(path.resolve(framePath))) content.push({ image: path.resolve(framePath) });

if (!provider()) { console.error('no LLM credential found (GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY)'); process.exit(1); }
let plan, usedModel;
try {
  const res = await askJSON(content, { model, maxTokens: 16384 });
  usedModel = res.model;
  plan = parseJSON(res.text);
} catch (e) {
  console.error('planning failed: ' + String(e).slice(0, 400));
  process.exit(1);
}

// ---- validate every matchName against perception (the mechanical guard) ----------------------
// The validator lives in plan_validate.mjs so the offline tests can pin it. It resolves every
// param edit to ONE effect instance (via paradeIndex/effectIndex — the last third of
// KNOWN_ISSUES #2), predicts the parade slot of effects this spec itself adds, checks matchNames
// against perception, and defaults keyframeMode where a bare setValue would be refused.
const { edits, problems } = validateEdits(plan.edits, state, installedByMatch);

const spec = {
  label: `plan_${Date.now().toString(36)}`,
  _intent: intent,
  _rationale: plan.rationale || '',
  _passCriteria: plan.passCriteria || [],
  _targetLayer: plan.targetLayer ?? edits[0]?.layerIndex ?? null,
  _model: usedModel,
  ...(problems.length ? { _validation: problems } : {}),
  edits,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));

console.log(`\n=== plan for "${intent}" ===`);
console.log(`comp "${state.comp}" @ t=${state.time}s · ${state.activeCount}/${state.numLayers} layers live`);
console.log(`rationale: ${spec._rationale}`);
for (const e of edits) {
  if (e.op === 'param') console.log(`  ~ layer ${e.layerIndex} ${e.effectMatchName}${e.effectIndex != null ? ` #${e.effectIndex}` : ''} ${e.paramMatchName} → ${JSON.stringify(e.value)}${e.keyframeMode ? ` (${e.keyframeMode})` : ''}`);
  else if (e.op === 'addEffect') console.log(`  + layer ${e.layerIndex} add ${e.effectMatchName}`);
  else if (e.op === 'expression') console.log(`  ƒ layer ${e.layerIndex} ${e.target} = ${String(e.expression).slice(0, 60)}`);
  else if (e.op === 'addLayer') console.log(`  ⊕ new ${e.kind} layer "${e.name || ''}"`);
  else if (e.op === 'textContent') console.log(`  ✎ layer ${e.layerIndex} text → "${String(e.text).slice(0, 40)}"`);
}
for (const p of problems) console.log(`  ⚠ ${p}`);
if (!edits.length) console.log('  (no applicable edits — see rationale; this usually means a handoff is required)');
console.log(`\nspec → ${path.relative(REPO, outPath)}`);
console.log(`next: node brownfield/tune_edit.mjs --seed=${path.relative(REPO, outPath)} --intent=${JSON.stringify(intent)} --layer=${spec._targetLayer}`);
process.exit(edits.length ? 0 : 4);   // 4 = planned but nothing applicable (handoff needed)
