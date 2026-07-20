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
// Model default gemini-3.5-flash: stable (a preview model changing underneath an eval baseline would
// invalidate comparisons), frontier-class vision. Override with --model= for A/B against
// gemini-3.1-pro-preview on hard cases.
//
// Auth: GEMINI_API_KEY from env, else recipe-harness/.env.api (gitignored).
//
// usage: node vision/gemini_score.mjs <review_request.json> [--model=gemini-3.5-flash] [--maxdim=1280]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { validateReview } from '../runner/review_schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- env (.env.api fallback) ----
const envFile = path.join(__dirname, '..', '.env.api');
if (!process.env.GEMINI_API_KEY && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('GEMINI_API_KEY missing (env or recipe-harness/.env.api)'); process.exit(1); }
const BASE = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

const reqPath = process.argv[2];
if (!reqPath) { console.error('usage: node vision/gemini_score.mjs <review_request.json> [--model=...]'); process.exit(1); }
const flag = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const model = flag('model', 'gemini-3.5-flash');
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
    suggestions: {
      type: 'ARRAY',
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

async function call(tries = 3) {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    // Gemini 3 models THINK, and thinking tokens are charged against this same budget — a trivial
    // prompt already spends 30-80 of them, and a nuanced visual judgement spends far more. At 4096
    // the reasoning ate the allowance and the JSON came back truncated on 1 request in 3, which
    // responseSchema cannot prevent (it constrains shape, not completion). The models allow 65536.
    generationConfig: { responseMimeType: 'application/json', responseSchema, maxOutputTokens: 16384 },
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

const data = await call();
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
review.score = Math.max(0, Math.min(10, Math.round(review.score)));
review._backend = `gemini:${model}`;
review._frames_scored = attached;
if (data.usageMetadata?.thoughtsTokenCount) review._thinking_tokens = data.usageMetadata.thoughtsTokenCount;
if (degraded.length) review._degraded = degraded;

const errs = validateReview(review);
if (errs.length) { console.error('scorer returned invalid review: ' + errs.join('; ')); process.exit(1); }

const outPath = path.join(path.dirname(reqPath), 'review.json');
fs.writeFileSync(outPath, JSON.stringify(review, null, 2));
console.log(outPath);
