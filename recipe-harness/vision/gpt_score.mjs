// gpt_score.mjs — OpenAI-backend scorer twin of claude_score.mjs (same seam, third impl).
//
// Consumes the same review_request.json, writes the same review.json schema, so
// tune_loop.mjs cannot tell any backend apart. Plain fetch against an OpenAI-compatible
// chat-completions endpoint — no SDK install needed (Node >=18 global fetch).
//
// Auth: OPENAI_API_KEY (+ optional OPENAI_BASE_URL) from env, else from
// recipe-harness/.env.api (gitignored KEY=VALUE lines).
// Model default gpt-5.6-terra — the balanced vision tier (July 2026 lineup); the scoring
// job is nuanced visual judgment + strict-JSON causal nudges, above Luna's
// extraction/routing tier and far below Sol-grade work. Override with --model=.
//
// usage: node vision/gpt_score.mjs <loop/<name>/iterN/review_request.json> [--model=gpt-5.6-terra]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateReview } from '../runner/review_schema.mjs';
import { loadCredentials } from '../../shell/keys.mjs';
import { modelFor } from '../../shell/llm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Credentials come from shell/keys.mjs (env -> macOS Keychain -> legacy plaintext file).
// This file used to load .env.api itself, which is the same half-a-seam that broke the planners:
// moving the key to the Keychain fixed the kernel and left the scorer keyless.
loadCredentials();
const API_KEY = process.env.OPENAI_API_KEY;
const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
if (!API_KEY) { console.error('OPENAI_API_KEY missing (env or recipe-harness/.env.api)'); process.exit(1); }

const reqPath = process.argv[2];
if (!reqPath) { console.error('usage: node vision/gpt_score.mjs <review_request.json> [--model=...]'); process.exit(1); }
const model = (process.argv.find(a => a.startsWith('--model=')) || '').split('=')[1] || modelFor('vision', 'openai');

const req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
const b64 = fp => fs.readFileSync(fp).toString('base64');

const header = [
  'You are scoring an After Effects render against an artist\'s intent, inside an automatic tune loop.',
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
  'The rendered frames follow, captioned with their comp time. Compare frames at different times to judge MOTION.',
  '',
  req.review_instructions,
].filter(Boolean).join('\n');

const content = [{ type: 'text', text: header }];
// mined drafts embed their target look as "reference thumbnail: <path>" in the intent —
// attach it so the scorer judges image-vs-image (the validation criterion), not text-vs-image.
// path may contain SPACES (every vendor thumb does, e.g. "Smoke Hit.png") — \S+ silently
// failed to match those, so the reference NEVER attached and every "image-vs-image" mining
// score was actually text-vs-image. Match through spaces to the last .png on the line.
const thumbMatch = (req.intent || '').match(/reference thumbnail:\s*(\/.+\.png)/i);
if (thumbMatch && fs.existsSync(thumbMatch[1])) {
  content.push({ type: 'text', text: 'REFERENCE (vendor thumbnail — the TARGET look; judge the render against this):' });
  content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64(thumbMatch[1])}`, detail: 'high' } });
}
for (const fp of req.frames) {
  content.push({ type: 'text', text: `frame ${path.basename(fp)}:` });
  content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64(fp)}`, detail: 'high' } });
}

// What the scorer ACTUALLY saw. The degrade path below silently removes attachments to get a
// response at all; without this record, a review produced from half the evidence is indistinguishable
// from a review produced from all of it.
const degraded = [];

// retry: headless batches die on one transient socket error otherwise (horns, dim-gpt-r1)
async function callWithRetry(body, tries = 3) {
  for (let a = 1; a <= tries; a++) {
    try {
      const resp = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body,
      });
      if (resp.ok) return resp.json();
      const errText = (await resp.text()).slice(0, 400);
      if (resp.status < 500 && resp.status !== 429) {
        // one image the endpoint can't parse (some vendor thumbs) — degrade: drop the
        // reference attachment and retry text+frames only (fractal-lines, dim-gpt-r2)
        if (errText.includes('image_parse_error')) {
          // one attached image is unparseable: the reference thumb, or a frame corrupted
          // by AE's late-session async saveFrameToPng. Strip one image per retry —
          // reference first, then the LAST frame — until only one frame remains.
          const msg = JSON.parse(body);
          const c = msg.messages[0].content;
          const ri = c.findIndex(x => x.type === 'text' && x.text.startsWith('REFERENCE (vendor thumbnail'));
          const imgCount = c.filter(x => x.type === 'image_url').length;
          if (ri >= 0) {
            console.error('image_parse_error — retrying WITHOUT the reference thumbnail');
            degraded.push('dropped_reference_thumbnail');
            c.splice(ri, 2);
          } else if (imgCount > 1) {
            // Dropping the LAST frame silently is the worst of these: 23 of 24 eval prompts phrase a
            // motion criterion against the frame PAIR, so a one-frame scorer cannot judge motion and
            // says so ("does not visibly provide a t4 comparison") — and the caller had no way to
            // tell that review apart from a genuine low score. It now leaves a trace.
            console.error('image_parse_error persists — dropping the last frame attachment');
            degraded.push('dropped_last_frame');
            for (let i = c.length - 1; i >= 0; i--) if (c[i].type === 'image_url') { c.splice(i - 1, 2); break; }
          } else {
            console.error(`API ${resp.status}: ${errText}`); process.exit(1);
          }
          body = JSON.stringify(msg);
          continue;
        }
        console.error(`API ${resp.status}: ${errText}`); process.exit(1);
      }
      console.error(`API ${resp.status} (attempt ${a}/${tries}): ${errText.slice(0, 120)}`);
    } catch (e) {
      console.error(`fetch error (attempt ${a}/${tries}): ${String(e).slice(0, 160)}`);
    }
    if (a < tries) await new Promise(r => setTimeout(r, a * 4000));
  }
  console.error('API unreachable after retries');
  process.exit(1);
}
const data = await callWithRetry(JSON.stringify({ model, max_completion_tokens: 2048, messages: [{ role: 'user', content }] }));
const text = (data.choices?.[0]?.message?.content || '').trim();
const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
const review = JSON.parse(json);
review.suggestions = review.suggestions || [];
review._backend = `gpt-api:${model}`;
if (degraded.length) review._degraded = degraded;

const errs = validateReview(review);
if (errs.length) { console.error('scorer returned invalid review: ' + errs.join('; ')); process.exit(1); }

const outPath = path.join(path.dirname(reqPath), 'review.json');
fs.writeFileSync(outPath, JSON.stringify(review, null, 2));
console.log(outPath);
