// claude_describe.mjs — PRODUCTION vision backend for the auto-probe loop.
//
// Drop-in replacement for the in-session agent-vision step: consumes an auto_probe manifest,
// sends each param's value-frames to Claude (batched per param so it can COMPARE values and
// flag identical/degenerate ones), and writes descriptions.json in the exact schema the
// in-session backend produced — so enrich_card.mjs consumes either identically.
//
// Requires ANTHROPIC_API_KEY in env and `npm i @anthropic-ai/sdk`.
// usage: node vision/claude_describe.mjs enrichment/<effect>.manifest.json [--model=claude-sonnet-5]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = process.argv[2];
if (!manifestPath) { console.error('usage: node vision/claude_describe.mjs <manifest.json>'); process.exit(1); }
const model = (process.argv.find(a => a.startsWith('--model=')) || '').split('=')[1] || 'claude-sonnet-5';

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const b64 = fp => fs.readFileSync(fp).toString('base64');

async function describeParam(effect, target) {
  // interleave a label + its frame for every value, then ask for a comparative JSON read
  const content = [{
    type: 'text',
    text: `These are renders of the After Effects effect "${effect.name}" applied to a flat gray solid, ` +
      `changing ONLY the parameter "${target.name}" (an enum/dropdown; AE does not expose its labels). ` +
      `Each image is captioned with the integer value set. Study them as a set.\n\n` +
      `Return STRICT JSON: {"values":{"<v>":"<=8-word look>"},"note":"comparative summary; ` +
      `call out any values that look IDENTICAL, and whether the parameter appears to have NO visible ` +
      `effect (possibly gated by another param)","caveat":"<short method caveat or empty>"}. JSON only.`,
  }];
  for (const { value, frame } of target.values) {
    content.push({ type: 'text', text: `value = ${value}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64(frame) } });
  }

  const msg = await client.messages.create({ model, max_tokens: 1024, messages: [{ role: 'user', content }] });
  const text = msg.content.map(c => (c.type === 'text' ? c.text : '')).join('').trim();
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const parsed = JSON.parse(json);
  return { param: target.name, values: parsed.values || {}, note: parsed.note || '', caveat: parsed.caveat || '' };
}

const out = { effect: manifest.effect.matchName, backend: `claude-api:${model}`, descriptions: {} };
for (const target of manifest.targets) {
  process.stderr.write(`describing ${target.name} (${target.values.length} values)... `);
  try {
    out.descriptions[target.matchName] = await describeParam(manifest.effect, target);
    process.stderr.write('ok\n');
  } catch (e) {
    process.stderr.write('FAIL ' + String(e).slice(0, 80) + '\n');
  }
}

const effSafe = manifest.effect.matchName.replace(/[^a-zA-Z0-9]+/g, '_');
const outPath = path.join(__dirname, '..', 'enrichment', effSafe + '.descriptions.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(outPath);
