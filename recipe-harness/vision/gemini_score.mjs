// gemini_score.mjs — Gemini backend for the shared vision-scorer seam (third impl, native API).
//
// Same contract as claude_score.mjs / gpt_score.mjs: consumes a review_request.json, writes a
// review.json matching runner/review_schema.mjs, so tune_loop / verify_edit / tune_edit cannot tell
// the backends apart.
//
// This one is NATIVE generateContent rather than the OpenAI-compatibility shim, for two reasons that
// both fix real defects found in this repo:
//
//   1. responseSchema ENFORCES the review shape at the API. Every previous backend asked for "STRICT
//      JSON only" in the prompt and then sliced between the first '{' and last '}' — which failed
//      whenever the model wrote prose around it or ran out of output budget mid-object. Those two
//      failure modes are indistinguishable from the outside; here the first cannot happen.
//   2. Frames are DOWNSCALED before they are sent. gpt_score inlined full-res PNGs and, when the
//      payload was too large, silently spliced out the last frame — a scorer holding one frame
//      cannot judge motion, which is what 23 of 24 eval prompts ask it to do. Shrinking the payload
//      removes the condition instead of degrading under it.
//
// MODEL CHOICE — decided by a paired A/B, not by the docs and not by the tier name.
//
// 16 stored review_requests re-scored by each candidate and compared against the answer the old GPT
// scorer already gave on the identical frames and instructions (vision/ab_scorers.mjs):
//
//   model                    |Δ| vs gpt   fail-with-no-suggestions   self-contradictory   API errors
//   gemini-3-flash-preview       0.80              1/16                     1/16              1/16
//   gemini-3.5-flash             1.00              1/16                     1/16              2/16
//   gemini-3.1-pro-preview       1.13              3/16                     3/16              0/16
//
// DEFAULT gemini-3-flash-preview: closest agreement, most suggestions per review (4.3), and it is
// the model Google's guide singles out for visual reasoning.
//
// The counter-intuitive result is that the PRO model is the worst fit. It is the most reliable at
// the API layer — zero errors — and the worst at the job: it disagreed most, contradicted its own
// verdict three times, and three times failed a render while proposing nothing. That last one is not
// a quality issue, it is a loop-killer (tune_loop exits on fail_no_applicable_suggestions), which is
// why this file now retries that case explicitly. "More capable tier" did not mean "better scorer".
//
// gemini-3.1-flash-lite works too; untested here, the cheap fallback.
// Note gemini-2.5-flash now 404s for new users — do not fall back to it.
//
// (An earlier revision of this comment blamed free-tier per-day quota for the model ranking. That was
// real at the time but has been superseded: the key now has billing, every candidate ran to
// completion, and the table above is the behavioural comparison that quota previously prevented.)
//
// Auth: GEMINI_API_KEY from env, else recipe-harness/.env.api (gitignored).
//
// usage: node vision/gemini_score.mjs <review_request.json> [--model=gemini-3-flash-preview] [--maxdim=1280]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { validateReview } from '../runner/review_schema.mjs';
import { loadCredentials } from '../../shell/keys.mjs';
import { recordSpend, assertBudget } from '../../shell/llm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Credentials come from shell/keys.mjs (env -> macOS Keychain -> legacy plaintext file).
// This file used to load .env.api itself, which is the same half-a-seam that broke the planners:
// moving the key to the Keychain fixed the kernel and left the scorer keyless.
loadCredentials();
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('GEMINI_API_KEY missing (env or recipe-harness/.env.api)'); process.exit(1); }
const BASE = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

const reqPath = process.argv[2];
if (!reqPath) { console.error('usage: node vision/gemini_score.mjs <review_request.json> [--model=...]'); process.exit(1); }
const flag = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const model = flag('model', 'gemini-3-flash-preview');
const maxdim = Number(flag('maxdim', 1280));

const req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
const degraded = [];

// ---- frames ------------------------------------------------------------------------------------
// A 1280x720 16-bit AE frame is ~11MB; base64 is ~15MB, and several of those plus the prompt runs
// into the request ceiling. Downscale a COPY (sips is macOS-native and already the downscaler
// verify_edit uses) — the originals stay untouched for rollback and re-scoring.
function scaled(fp) {
  if (!fs.existsSync(fp)) return null;
  const out = fp.replace(/\.png$/i, `_score${maxdim}.png`);
  const r = spawnSync('sips', ['-Z', String(maxdim), fp, '--out', out], { encoding: 'utf8' });
  return (r.status === 0 && fs.existsSync(out)) ? out : fp;
}
const b64 = fp => fs.readFileSync(fp).toString('base64');

// ---- prompt ------------------------------------------------------------------------------------
// Deliberately the same information the other backends get, so a backend swap is a swap and not a
// redesign. The one addition is the frame-caption discipline, which matters more here because
// Gemini sees the parts as an ordered stream.
const header = [
  "You are scoring an After Effects render against an artist's intent, inside an automatic tune loop.",
  '',
  `INTENT: ${req.intent}`,
  req.pass_criteria?.length ? 'PASS CRITERIA:\n' + req.pass_criteria.map(c => `  - ${c}`).join('\n') : '',
  `ITERATION: ${req.iteration} of ${req.max_iters}`,
  '',
  'CURRENT PLAN (effect stack; params are [matchName, value, label]):',
  JSON.stringify(req.plan, null, 1),
  '',
  req.prior_iterations?.length
    ? 'PRIOR ITERATIONS (avoid re-suggesting what already failed):\n' + req.prior_iterations.map(p => `  iter ${p.iter}: ${p.verdict} (${p.score}/10) — ${p.critique}`).join('\n')
    : '',
  '',
  'The rendered frames follow, each captioned with its filename. Compare frames at different comp',
  'times to judge MOTION — a single still cannot show drift, rotation or flicker.',
  '',
  req.review_instructions,
  '',
  'Return AT MOST 6 suggestions, and fewer is better. They are applied mechanically and all at once,',
  'so a long list is not thoroughness — it is an unattributable change where nothing can be learned',
  'from the result. Name the smallest set of levers that would move the frame toward the intent.',
].filter(Boolean).join('\n');

const parts = [{ text: header }];

// mined drafts embed a target look as "reference thumbnail: <path>" in the intent
const thumb = (req.intent || '').match(/reference thumbnail:\s*(\/.+\.png)/i);
if (thumb && fs.existsSync(thumb[1])) {
  const t = scaled(thumb[1]);
  parts.push({ text: 'REFERENCE (vendor thumbnail — the TARGET look; judge the render against this):' });
  parts.push({ inlineData: { mimeType: 'image/png', data: b64(t) } });
}
for (const fp of req.frames || []) {
  const s = scaled(fp);
  if (!s) { degraded.push(`missing_frame:${path.basename(fp)}`); continue; }
  parts.push({ text: `frame ${path.basename(fp)}:` });
  parts.push({ inlineData: { mimeType: 'image/png', data: b64(s) } });
}
const attached = parts.filter(p => p.inlineData).length;
if (!attached) { console.error('no frames could be attached — refusing to score blind'); process.exit(1); }

// ---- schema ------------------------------------------------------------------------------------
// Enforced by the API, so an unparseable review is impossible. Suggestion shapes are heterogeneous
// (param / expression / effect / camera / background), so every shape-specific field is optional and
// `type` carries the discriminator — permissive enough to express all five, strict enough that the
// envelope is always valid.
const responseSchema = {
  type: 'OBJECT',
  required: ['verdict', 'score', 'critique'],
  properties: {
    verdict: { type: 'STRING', enum: ['pass', 'fail'] },
    score: { type: 'INTEGER' },
    critique: { type: 'STRING' },
    // CAP THE LIST. Left unbounded, gemini-3-flash-preview returned FIFTY suggestions for one
    // review — and tune_loop applies them mechanically and all at once, so that is not verbosity,
    // it is a plan-destroying edit with no way to attribute which nudge did what. It is also what
    // was exhausting the output budget. review_schema already asks for "FEW causal nudges over many
    // speculative ones"; this makes the instruction structural instead of advisory.
    suggestions: {
      type: 'ARRAY',
      maxItems: 6,
      items: {
        type: 'OBJECT',
        required: ['type', 'why'],
        properties: {
          type: { type: 'STRING', enum: ['param', 'expression', 'effect', 'camera', 'background'] },
          effect: { type: 'STRING' },
          matchName: { type: 'STRING' },
          expression: { type: 'STRING' },
          why: { type: 'STRING' },
          value_number: { type: 'NUMBER' },
          value_list: { type: 'ARRAY', items: { type: 'NUMBER' } },
        },
      },
    },
  },
};

// The scorer has its own fetch, so it must pass the gate explicitly — a cap that guards askJSON and
// not this one would be exactly the half-a-seam pattern PRD §十三 is about, and the scorer is the
// bigger spender of the two.
try { assertBudget(); }
catch (e) { console.error(String(e.message || e)); process.exit(3); }

async function call(tries = 3) {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    // Gemini 3 models THINK, and thinking tokens are charged against this same budget — a trivial
    // prompt already spends 30-80 of them, and a nuanced visual judgement spends far more. At 4096
    // the reasoning ate the allowance and the JSON came back truncated on 1 request in 3, which
    // responseSchema cannot prevent (it constrains shape, not completion). The models allow 65536.
    // 16384 still truncated the two longest reviews (dense Chinese critiques with full suggestion
    // sets). Thinking tokens are unbounded from the caller's side, so the budget has to cover
    // reasoning AND output — the models allow 65536 and unused budget costs nothing.
    generationConfig: { responseMimeType: 'application/json', responseSchema, maxOutputTokens: 32768 },
  });
  for (let a = 1; a <= tries; a++) {
    try {
      const r = await fetch(`${BASE}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
        body,
      });
      if (r.ok) return r.json();
      const t = (await r.text()).slice(0, 400);
      // A 429 is normally back-pressure and worth retrying, but a QUOTA 429 is permanent for this
      // key+model and retrying just turns a precise error into a vague one: gemini-3.1-pro-preview
      // reported "API unreachable after retries" on all 12 A/B cases when the real answer was "this
      // key has no quota for that model".
      if (r.status === 429 && /quota|billing|exceeded your current/i.test(t)) {
        console.error(`API 429 — no quota for "${model}" on this key. Pick a model the key can serve (e.g. gemini-3.5-flash) or raise the quota.\n${t.slice(0, 200)}`);
        process.exit(1);
      }
      if (r.status < 500 && r.status !== 429) { console.error(`API ${r.status}: ${t}`); process.exit(1); }
      console.error(`API ${r.status} (attempt ${a}/${tries}): ${t.slice(0, 140)}`);
    } catch (e) { console.error(`fetch error (attempt ${a}/${tries}): ${String(e).slice(0, 160)}`); }
    if (a < tries) await new Promise(r => setTimeout(r, a * 4000));
  }
  console.error('API unreachable after retries'); process.exit(1);
}

let data = await call();
const cand = data.candidates?.[0];
if (!cand) { console.error('no candidate returned: ' + JSON.stringify(data).slice(0, 300)); process.exit(1); }
// A truncated response and a refused one look identical downstream unless the reason is surfaced.
if (cand.finishReason && cand.finishReason !== 'STOP') degraded.push(`finish:${cand.finishReason}`);
// MAX_TOKENS is the one finish reason that guarantees a broken payload — name it, because a
// truncated response and a refused one produce the same parse error downstream.
if (cand.finishReason === 'MAX_TOKENS') {
  console.error(`response hit maxOutputTokens (thinking used ${data.usageMetadata?.thoughtsTokenCount ?? '?'} of ${data.usageMetadata?.candidatesTokenCount ?? '?'} output tokens) — raise it or simplify the request.`);
}
const text = (cand.content?.parts || []).map(p => p.text).filter(Boolean).join('').trim();
let review;
try { review = JSON.parse(text); }
catch { console.error(`response was not valid JSON despite responseSchema (finishReason=${cand.finishReason}):\n` + text.slice(0, 500)); process.exit(1); }

// Fold the split value fields back into the single `value` the appliers expect. The schema has to
// split them because JSON Schema unions are not expressible here, but nothing downstream should
// have to know that.
review.suggestions = (review.suggestions || []).map(s => {
  const out = { ...s };
  if (s.value_list?.length) out.value = s.value_list;
  else if (s.value_number !== undefined) out.value = s.value_number;
  delete out.value_number; delete out.value_list;
  return out;
});
// A FAIL WITH NO SUGGESTIONS TERMINATES THE LOOP. tune_loop exits on
// `fail_no_applicable_suggestions`, so a scorer that criticises the render and then offers nothing
// does not merely waste an iteration — it ends the run. Measured across a 16-case A/B: 1 in 16 for
// the flash models and 3 in 16 for gemini-3.1-pro-preview. That is far too common to accept, and it
// is recoverable: the model has already articulated what is wrong in the critique, so asking it to
// name the levers usually works. One targeted retry, then give up honestly and say so.
if (review.verdict === 'fail' && !review.suggestions.length) {
  console.error('scorer failed the render but proposed nothing — asking once for the levers');
  parts.push({ text: [
    '',
    'You returned verdict="fail" with an EMPTY suggestions list. That combination stops the tune loop',
    'entirely, so it must not be used to mean "I am not sure what to change".',
    `Your critique was: ${review.critique}`,
    'Name the concrete parameter changes that would address exactly that critique, using only',
    'matchNames visible in the plan above. If the defect genuinely cannot be reached by any parameter',
    '(it needs a different effect, a different stack order, or an asset), say so in the critique and',
    'return verdict="fail" with suggestions=[] again — that answer is respected, but only on purpose.',
  ].join('\n') });
  const retry = await call(2);
  const rc = retry.candidates?.[0];
  const rtext = (rc?.content?.parts || []).map(p => p.text).filter(Boolean).join('').trim();
  try {
    const r2 = JSON.parse(rtext);
    if (r2.suggestions?.length) {
      review.suggestions = r2.suggestions;
      if (r2.critique) review.critique = r2.critique;
      degraded.push('suggestions_recovered_on_retry');
      data = retry;
    } else degraded.push('fail_without_suggestions_confirmed');
  } catch { degraded.push('fail_without_suggestions_retry_unparseable'); }
  // fold the split value fields on whatever we ended up with
  review.suggestions = (review.suggestions || []).map(s => {
    const out = { ...s };
    if (s.value_list?.length) out.value = s.value_list;
    else if (s.value_number !== undefined) out.value = s.value_number;
    delete out.value_number; delete out.value_list;
    return out;
  });
}

// Belt and braces: the schema caps the list, but the applier is the thing that would be harmed, so
// it must not depend on the API honouring maxItems.
if (review.suggestions.length > 6) {
  degraded.push(`truncated_suggestions:${review.suggestions.length}->6`);
  review.suggestions = review.suggestions.slice(0, 6);
}
review.score = Math.max(0, Math.min(10, Math.round(review.score)));
review._backend = `gemini:${model}`;
// The scorer is the product's biggest recurring cost — one call per tune iteration, several per
// request. Metering only the planner would have shown a tenth of the real spend.
try {
  const sp = recordSpend({ model, usage: data.usageMetadata, purpose: process.env.AE_AI_PURPOSE || 'score' });
  if (sp && sp.usd !== null) review._usd = sp.usd;
} catch { /* accounting must never break scoring */ }
review._frames_scored = attached;
if (data.usageMetadata?.thoughtsTokenCount) review._thinking_tokens = data.usageMetadata.thoughtsTokenCount;
if (degraded.length) review._degraded = degraded;

const errs = validateReview(review);
if (errs.length) { console.error('scorer returned invalid review: ' + errs.join('; ')); process.exit(1); }

const outPath = path.join(path.dirname(reqPath), 'review.json');
fs.writeFileSync(outPath, JSON.stringify(review, null, 2));
console.log(outPath);
