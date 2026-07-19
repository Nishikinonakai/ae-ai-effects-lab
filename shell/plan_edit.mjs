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
import { leverContext } from '../introspect/essence/lookup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const intent = arg('intent', null);
const statePath = arg('state', null);
if (!intent || !statePath) {
  console.error('usage: node shell/plan_edit.mjs --intent="..." --state=<comp_state.json> [--frame=<f.png>] [--out=<spec.json>]');
  process.exit(1);
}
const model = arg('model', 'gpt-5.6-terra');
const outPath = path.resolve(arg('out', path.join(REPO, 'shell', 'out', 'plan_spec.json')));
const forcedLayer = arg('layer', null) ? Number(arg('layer')) : null;

// ---- env (.env.api fallback), same seam as the scorer ----
const envFile = path.join(REPO, 'recipe-harness', '.env.api');
if ((!process.env.OPENAI_API_KEY || !process.env.OPENAI_BASE_URL) && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const API_KEY = process.env.OPENAI_API_KEY;
const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
if (!API_KEY) { console.error('OPENAI_API_KEY missing (env or recipe-harness/.env.api)'); process.exit(1); }

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
    matchName: fx.matchName, name: fx.name, enabled: fx.enabled, paramCount: fx.paramCount,
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
    effects: (l.effects || []).map(summariseEffect),
  })),
};

// essence context for every effect present on a live layer
const presentEffects = [...new Set(liveLayers.flatMap(l => (l.effects || []).map(f => f.matchName)))];
const lc = leverContext(presentEffects);

const SPEC_CONTRACT = `Return STRICT JSON only, in this shape:
{"targetLayer": <layer index to edit>,
 "rationale": "<one or two sentences: what you are changing and WHY it serves the intent>",
 "passCriteria": ["<observable visual criterion>", "..."],
 "edits": [ <one or more apply_edit ops> ]}

apply_edit ops:
  {"op":"param","layerIndex":N,"effectMatchName":"<fx matchName>","paramMatchName":"<param matchName>","value":<number | [r,g,b] 0..1>}
      · if the param has "numKeys" in the perception dump it is KEYFRAMED and you MUST add
        "keyframeMode":"scale"     (value is a MULTIPLIER applied to every key, preserving the envelope)
        or "keyframeMode":"setAtTime" (value is ABSOLUTE, set at the current playhead)
  {"op":"addEffect","layerIndex":N,"effectMatchName":"<fx matchName>"}
  {"op":"expression","layerIndex":N,"target":"position"|"scale"|"rotation"|"opacity"|"anchor","expression":"<AE expression>"}

Rules:
  · Use ONLY matchNames that appear in the PERCEPTION dump or the lever list. Never invent one.
  · Prefer the FEWEST edits that could plausibly achieve the intent — this is a seed the visual
    loop will refine, not a finished look. Two or three well-chosen levers beat ten guesses.
  · Read the CURRENT VALUES before choosing. If a lever is already at the value you want, it is not
    the lever to move. If a gate-like param (a luminance threshold, an enable, a view mode) is set
    so the effect cannot contribute, open it FIRST — nothing downstream can matter while it is shut.
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
  lc.block || '(no essence cards matched the effects present — reason from the param names and your own knowledge of these effects)',
  '',
  'The rendered frame at the current playhead follows. This is what the artist is looking at right now.',
  '',
  SPEC_CONTRACT,
].filter(Boolean).join('\n');

const content = [{ type: 'text', text: prompt }];
const framePath = arg('frame', null);
if (framePath && fs.existsSync(path.resolve(framePath))) {
  content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${fs.readFileSync(path.resolve(framePath)).toString('base64')}`, detail: 'high' } });
}

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

const data = await call(JSON.stringify({ model, max_completion_tokens: 2048, messages: [{ role: 'user', content }] }));
const text = (data.choices?.[0]?.message?.content || '').trim();
let plan;
try { plan = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
catch (e) { console.error('planner returned unparseable JSON:\n' + text.slice(0, 600)); process.exit(1); }

// ---- validate every matchName against perception (the mechanical guard) ----------------------
const layerByIndex = new Map((state.layers || []).map(l => [l.index, l]));
const problems = [];
const edits = (plan.edits || []).filter(e => {
  const L = layerByIndex.get(e.layerIndex);
  if (!L) { problems.push(`layer ${e.layerIndex} does not exist — edit dropped`); return false; }
  if (!L.activeNow) problems.push(`layer ${e.layerIndex} "${L.name}" is not live at this frame — the edit may be invisible`);
  if (e.op === 'addEffect') return true;
  if (e.op === 'expression') return true;
  if (e.op === 'param') {
    const fx = (L.effects || []).find(f => f.matchName === e.effectMatchName);
    if (!fx) { problems.push(`effect ${e.effectMatchName} is not on layer ${e.layerIndex} — edit dropped`); return false; }
    const p = (fx.params || []).find(q => q.matchName === e.paramMatchName);
    if (!p) { problems.push(`param ${e.paramMatchName} is not on ${e.effectMatchName} — edit dropped`); return false; }
    // a keyframed param needs an explicit mode or apply_edit will refuse it
    if (p.numKeys && !e.keyframeMode) {
      e.keyframeMode = 'setAtTime';
      problems.push(`param ${e.paramMatchName} is keyframed (${p.numKeys} keys) and no keyframeMode was given — defaulted to setAtTime`);
    }
    return true;
  }
  problems.push(`unknown op "${e.op}" — edit dropped`);
  return false;
});

const spec = {
  label: `plan_${Date.now().toString(36)}`,
  _intent: intent,
  _rationale: plan.rationale || '',
  _passCriteria: plan.passCriteria || [],
  _targetLayer: plan.targetLayer ?? edits[0]?.layerIndex ?? null,
  _model: model,
  ...(problems.length ? { _validation: problems } : {}),
  edits,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));

console.log(`\n=== plan for "${intent}" ===`);
console.log(`comp "${state.comp}" @ t=${state.time}s · ${state.activeCount}/${state.numLayers} layers live`);
console.log(`rationale: ${spec._rationale}`);
for (const e of edits) {
  if (e.op === 'param') console.log(`  ~ layer ${e.layerIndex} ${e.effectMatchName} ${e.paramMatchName} → ${JSON.stringify(e.value)}${e.keyframeMode ? ` (${e.keyframeMode})` : ''}`);
  else if (e.op === 'addEffect') console.log(`  + layer ${e.layerIndex} add ${e.effectMatchName}`);
  else if (e.op === 'expression') console.log(`  ƒ layer ${e.layerIndex} ${e.target} = ${String(e.expression).slice(0, 60)}`);
}
for (const p of problems) console.log(`  ⚠ ${p}`);
if (!edits.length) console.log('  (no applicable edits — see rationale; this usually means a handoff is required)');
console.log(`\nspec → ${path.relative(REPO, outPath)}`);
console.log(`next: node brownfield/tune_edit.mjs --seed=${path.relative(REPO, outPath)} --intent=${JSON.stringify(intent)} --layer=${spec._targetLayer}`);
process.exit(edits.length ? 0 : 4);   // 4 = planned but nothing applicable (handoff needed)
