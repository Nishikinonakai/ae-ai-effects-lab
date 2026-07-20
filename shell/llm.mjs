// llm.mjs — the ONE place that knows which LLM provider this install talks to.
//
// The scorer had a backend seam (claude_score / gpt_score / gemini_score, one contract, picked from
// whichever credential is present). The PLANNERS did not — each carried its own inline OpenAI call.
// So swapping the key to Gemini silently switched the scorer and left both planners reading
// OPENAI_API_KEY, and the product stopped working entirely: every request died at "planning failed".
// It looked like a config error and it was an architecture gap — a seam that existed on one side of
// the loop and not the other.
//
// Provider is chosen by which credential is actually available, same rule the scorer uses, so one
// key swap moves the whole product. Env wins over the gitignored .env.api file.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { loadCredentials } from './keys.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

// Credentials come from shell/keys.mjs: process env, then the macOS Keychain, then the legacy
// plaintext file. Resolved ONCE per process — loadCredentials shells out to `security` per key, and
// provider() is called on every request.
let credSource = null;
function loadEnv() {
  if (credSource) return credSource;
  credSource = loadCredentials();
  return credSource;
}

// Which provider, which model, and where the key came from — the answer to "am I actually using
// what I think I am". Not knowing that cost a whole afternoon: the scorer had moved to Gemini while
// the planners still read OPENAI_API_KEY, and the failure read like a config error.
export function activeConfig() {
  const src = loadEnv();
  const p = provider();
  return { provider: p, model: defaultModel(p), keySource: p ? src[`${p.toUpperCase()}_API_KEY`] || 'none' : 'none' };
}

// ---- COST METER ------------------------------------------------------------------------------
// PRD §12.7 puts this first, and today is why: £5.72 went out in a day and nobody knew until
// somebody counted the files afterwards — 98% of it on measurement the artist never asked for. A
// product that spends the user's money silently is not shippable, and this needs no UI to be useful:
// an append-only ledger any surface can read.
//
// Prices are per MILLION tokens, USD, and they WILL drift. They are declared here rather than
// guessed at each call site so there is one thing to correct, and every entry records the rates it
// used so a later price change cannot retroactively rewrite history.
const PRICES = {
  'gemini-3-flash-preview': { in: 0.30, out: 2.50 },
  'gemini-3.5-flash': { in: 0.30, out: 2.50 },
  'gemini-3.1-flash-lite': { in: 0.10, out: 0.40 },
  'gemini-3.1-pro-preview': { in: 2.00, out: 12.00 },
  'gpt-5.6-terra': { in: 1.25, out: 10.00 },
  'claude-sonnet-5': { in: 3.00, out: 15.00 },
};
const LEDGER = path.join(os.homedir(), 'Documents', 'ae-ai-shell', 'spend.jsonl');

// What this call was FOR. Without it the ledger says "you spent £5.72" and not "you spent £5.60 of
// it on experiments" — which is the only version that changes behaviour.
export function setPurpose(p) { process.env.AE_AI_PURPOSE = p || ''; }

export function recordSpend({ model, usage, purpose }) {
  const key = String(model || '').replace(/^[a-z]+:/, '');
  const price = PRICES[key];
  const inTok = usage?.promptTokenCount ?? usage?.prompt_tokens ?? 0;
  const outTok = (usage?.candidatesTokenCount ?? usage?.completion_tokens ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  const usd = price ? (inTok * price.in + outTok * price.out) / 1e6 : null;
  const row = {
    ts: new Date().toISOString(),
    model: key,
    purpose: purpose || process.env.AE_AI_PURPOSE || 'unknown',
    inTok, outTok,
    usd: usd === null ? null : +usd.toFixed(6),
    ...(price ? { rates: price } : { _noPriceFor: key }),
  };
  try {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    fs.appendFileSync(LEDGER, JSON.stringify(row) + '\n');
  } catch { /* never let accounting break the product */ }
  return row;
}

// Totals for a window, split by purpose — the shape a budget gate and a cost screen both need.
export function spendSummary({ sinceMs = 24 * 3600 * 1000 } = {}) {
  if (!fs.existsSync(LEDGER)) return { total: 0, calls: 0, byPurpose: {}, unpriced: 0 };
  const cutoff = Date.now() - sinceMs;
  const out = { total: 0, calls: 0, byPurpose: {}, unpriced: 0 };
  for (const line of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (Date.parse(r.ts) < cutoff) continue;
    out.calls++;
    if (r.usd === null) { out.unpriced++; continue; }
    out.total += r.usd;
    out.byPurpose[r.purpose] = +((out.byPurpose[r.purpose] || 0) + r.usd).toFixed(6);
  }
  out.total = +out.total.toFixed(4);
  return out;
}

export function provider() {
  loadEnv();
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

// Default per provider for a PLANNING job: structured reasoning over a large perception dump plus an
// image. Deliberately not the cheapest tier — a wrong plan costs a whole apply→render→verify cycle,
// which is far more expensive than the token difference.
const DEFAULT_MODEL = {
  gemini: 'gemini-3-flash-preview',
  openai: 'gpt-5.6-terra',
  anthropic: 'claude-sonnet-5',
};

export function defaultModel(p = provider()) { return DEFAULT_MODEL[p] || null; }

// Ask for JSON. `parts` is [{text}] and/or [{image: <path>}] — the caller does not need to know how
// each provider spells an attachment.
//
// Gemini enforces the shape with responseSchema when one is given, which removes a real failure mode:
// every other backend asks for "STRICT JSON" in the prompt and then slices between the first { and
// the last }, which fails silently on prose or truncation.
// AE writes 16-BIT PNGs, and the vision endpoints reject them ("Unable to process input image").
// gemini_score got away with it only because its sips downscale converts to 8-bit as a side effect;
// plan_edit passed the raw frame through and every request died at the planning step. Normalising
// here means no caller has to know, and it also caps the payload — a 4K frame is ~28MB, past the
// per-image limit, which is the same bug wearing a different hat.
const MAX_IMG_DIM = 1280;
function normaliseImage(fp) {
  const out = fp.replace(/\.png$/i, `_llm${MAX_IMG_DIM}.png`);
  // -Z bounds the long edge; --setProperty format png re-encodes at 8 bits per channel
  const r = spawnSync('sips', ['-Z', String(MAX_IMG_DIM), '--setProperty', 'format', 'png', fp, '--out', out], { encoding: 'utf8' });
  return (r.status === 0 && fs.existsSync(out)) ? out : fp;
}

export async function askJSON(parts, { schema = null, model = null, maxTokens = 16384, tries = 3 } = {}) {
  const p = provider();
  if (!p) throw new Error('no LLM credential found (GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY, in env or recipe-harness/.env.api)');
  const mdl = model || defaultModel(p);
  const b64 = fp => fs.readFileSync(fp).toString('base64');

  if (p === 'gemini') {
    const base = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const gParts = parts.map(x => x.image
      ? { inlineData: { mimeType: 'image/png', data: b64(normaliseImage(x.image)) } }
      : { text: x.text });
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: gParts }],
      // Gemini 3 THINKS, and thinking tokens are charged to this same budget — too small a value
      // truncates the JSON, which responseSchema cannot prevent (it constrains shape, not completion).
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens, ...(schema ? { responseSchema: schema } : {}) },
    });
    let lastErr = null;
    for (let a = 1; a <= tries; a++) {
      // The fetch itself must be inside the retry, not outside it. Without this a transient socket
      // error ("TypeError: fetch failed") escapes the loop on the FIRST attempt and kills the whole
      // request — two consecutive real runs died that way, at the planning step, on a hiccup that a
      // single retry would have absorbed.
      let r;
      try {
        r = await fetch(`${base}/models/${mdl}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body,
        });
      } catch (e) {
        lastErr = e;
        console.error(`network error (attempt ${a}/${tries}): ${String(e).slice(0, 120)}`);
        if (a < tries) { await new Promise(res => setTimeout(res, a * 4000)); continue; }
        throw new Error(`network unreachable after ${tries} attempts: ${String(lastErr).slice(0, 160)}`);
      }
      if (r.ok) {
        const data = await r.json();
        const cand = data.candidates?.[0];
        if (cand?.finishReason === 'MAX_TOKENS') {
          throw new Error(`response hit maxOutputTokens (thinking used ${data.usageMetadata?.thoughtsTokenCount ?? '?'}) — raise maxTokens`);
        }
        const text = (cand?.content?.parts || []).map(x => x.text).filter(Boolean).join('').trim();
        const spend = recordSpend({ model: mdl, usage: data.usageMetadata });
        return { text, model: `${p}:${mdl}`, spend };
      }
      const t = (await r.text()).slice(0, 400);
      // a QUOTA 429 is permanent for this key+model; retrying turns a precise error into a vague one
      if (r.status === 429 && /quota|billing|exceeded your current/i.test(t)) throw new Error(`no quota for "${mdl}" on this key: ${t.slice(0, 200)}`);
      // The image-decode 400 is transient by the API's own advice ("Please retry"), so it must not
      // fall into the fatal branch with the genuine 4xx errors — a whole request used to die on one.
      const retryable4xx = r.status === 400 && /process input image|Please retry/i.test(t);
      if (r.status < 500 && r.status !== 429 && !retryable4xx) throw new Error(`API ${r.status}: ${t}`);
      if (a < tries) await new Promise(res => setTimeout(res, a * 4000));
    }
    throw new Error('API unreachable after retries');
  }

  if (p === 'openai') {
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const content = parts.map(x => x.image
      ? { type: 'image_url', image_url: { url: `data:image/png;base64,${b64(normaliseImage(x.image))}`, detail: 'high' } }
      : { type: 'text', text: x.text });
    for (let a = 1; a <= tries; a++) {
      let r;
      try {
        r = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: JSON.stringify({ model: mdl, max_completion_tokens: maxTokens, messages: [{ role: 'user', content }] }),
        });
      } catch (e) {
        console.error(`network error (attempt ${a}/${tries}): ${String(e).slice(0, 120)}`);
        if (a < tries) { await new Promise(res => setTimeout(res, a * 4000)); continue; }
        throw new Error(`network unreachable after ${tries} attempts: ${String(e).slice(0, 160)}`);
      }
      if (r.ok) {
        const data = await r.json();
        const spend = recordSpend({ model: mdl, usage: data.usage });
        return { text: (data.choices?.[0]?.message?.content || '').trim(), model: `${p}:${mdl}`, spend };
      }
      const t = (await r.text()).slice(0, 400);
      if (r.status < 500 && r.status !== 429) throw new Error(`API ${r.status}: ${t}`);
      if (a < tries) await new Promise(res => setTimeout(res, a * 4000));
    }
    throw new Error('API unreachable after retries');
  }

  throw new Error(`provider "${p}" has no planning implementation yet`);
}

// Pull the JSON object out of a reply. With Gemini's responseSchema the whole reply IS the object;
// the brace-slicing fallback is for providers that will wrap it in prose.
export function parseJSON(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const i = text.indexOf('{'), j = text.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('no JSON object in reply:\n' + text.slice(0, 500));
  return JSON.parse(text.slice(i, j + 1));
}
