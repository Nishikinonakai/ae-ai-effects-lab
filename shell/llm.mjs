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
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

function loadEnv() {
  const envFile = path.join(REPO, 'recipe-harness', '.env.api');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
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
export async function askJSON(parts, { schema = null, model = null, maxTokens = 16384, tries = 3 } = {}) {
  const p = provider();
  if (!p) throw new Error('no LLM credential found (GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY, in env or recipe-harness/.env.api)');
  const mdl = model || defaultModel(p);
  const b64 = fp => fs.readFileSync(fp).toString('base64');

  if (p === 'gemini') {
    const base = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const gParts = parts.map(x => x.image
      ? { inlineData: { mimeType: 'image/png', data: b64(x.image) } }
      : { text: x.text });
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: gParts }],
      // Gemini 3 THINKS, and thinking tokens are charged to this same budget — too small a value
      // truncates the JSON, which responseSchema cannot prevent (it constrains shape, not completion).
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens, ...(schema ? { responseSchema: schema } : {}) },
    });
    for (let a = 1; a <= tries; a++) {
      const r = await fetch(`${base}/models/${mdl}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body,
      });
      if (r.ok) {
        const data = await r.json();
        const cand = data.candidates?.[0];
        if (cand?.finishReason === 'MAX_TOKENS') {
          throw new Error(`response hit maxOutputTokens (thinking used ${data.usageMetadata?.thoughtsTokenCount ?? '?'}) — raise maxTokens`);
        }
        const text = (cand?.content?.parts || []).map(x => x.text).filter(Boolean).join('').trim();
        return { text, model: `${p}:${mdl}` };
      }
      const t = (await r.text()).slice(0, 400);
      // a QUOTA 429 is permanent for this key+model; retrying turns a precise error into a vague one
      if (r.status === 429 && /quota|billing|exceeded your current/i.test(t)) throw new Error(`no quota for "${mdl}" on this key: ${t.slice(0, 200)}`);
      if (r.status < 500 && r.status !== 429) throw new Error(`API ${r.status}: ${t}`);
      if (a < tries) await new Promise(res => setTimeout(res, a * 4000));
    }
    throw new Error('API unreachable after retries');
  }

  if (p === 'openai') {
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const content = parts.map(x => x.image
      ? { type: 'image_url', image_url: { url: `data:image/png;base64,${b64(x.image)}`, detail: 'high' } }
      : { type: 'text', text: x.text });
    for (let a = 1; a <= tries; a++) {
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: mdl, max_completion_tokens: maxTokens, messages: [{ role: 'user', content }] }),
      });
      if (r.ok) {
        const data = await r.json();
        return { text: (data.choices?.[0]?.message?.content || '').trim(), model: `${p}:${mdl}` };
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
