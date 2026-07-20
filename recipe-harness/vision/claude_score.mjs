// claude_score.mjs — PRODUCTION scorer backend for the tune loop.
//
// The recipe-side twin of introspect/vision/claude_describe.mjs: consumes a
// review_request.json staged by tune_loop.mjs, sends intent + pass criteria + current
// plan + prior trajectory + the rendered frames to Claude, and writes review.json next
// to the request — in EXACTLY the schema the in-session agent backend writes, so
// tune_loop.mjs cannot tell the backends apart.
//
// Requires ANTHROPIC_API_KEY in env and `npm i @anthropic-ai/sdk`.
// usage: node vision/claude_score.mjs <loop/<name>/iterN/review_request.json> [--model=claude-sonnet-5]
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { validateReview } from '../runner/review_schema.mjs';
import { modelFor } from '../../shell/llm.mjs';

const reqPath = process.argv[2];
if (!reqPath) { console.error('usage: node vision/claude_score.mjs <review_request.json> [--model=...]'); process.exit(1); }
const model = (process.argv.find(a => a.startsWith('--model=')) || '').split('=')[1] || modelFor('vision', 'anthropic');

const req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
const client = new Anthropic(); // reads ANTHROPIC_API_KEY
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
for (const fp of req.frames) {
  content.push({ type: 'text', text: `frame ${path.basename(fp)}:` });
  content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64(fp) } });
}

const msg = await client.messages.create({ model, max_tokens: 2048, messages: [{ role: 'user', content }] });
const text = msg.content.map(c => (c.type === 'text' ? c.text : '')).join('').trim();
const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
const review = JSON.parse(json);
review.suggestions = review.suggestions || [];
review._backend = `claude-api:${model}`;

const errs = validateReview(review);
if (errs.length) { console.error('scorer returned invalid review: ' + errs.join('; ')); process.exit(1); }

const outPath = path.join(path.dirname(reqPath), 'review.json');
fs.writeFileSync(outPath, JSON.stringify(review, null, 2));
console.log(outPath);
