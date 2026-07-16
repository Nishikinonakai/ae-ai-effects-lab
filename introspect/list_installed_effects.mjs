// list_installed_effects.mjs — dump the COMPLETE installed-effect inventory via app.effects.
//
// Product requirement (user, 2026-07-16): the mature planner must know every plugin the
// user actually has installed and choose from THAT pool to satisfy an NL request — not
// from a curated subset. This inventory is the planner's choice pool and the enrichment
// queue for the ontology pipeline (introspect_effect.mjs per entry, prioritized by usage
// frequency observed in real sessions).
//
// Read-only; safe anytime AE is idle. usage: node introspect/list_installed_effects.mjs
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
const CMD = path.join(BRIDGE, 'ae_command.json');
const RES = path.join(BRIDGE, 'ae_mcp_result.json');

// app.effects access is SLOW (plugin-registry hit per element; >60s for a full suite on
// cold AE) — pull in chunks with a generous per-chunk timeout.
const chunkScript = (from, to) => String.raw`(function () {
  var esc = function (s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\"'); };
  try {
    var n = app.effects.length, out = [];
    for (var i = ${from}; i < Math.min(${to}, n); i++) {
      var e = app.effects[i];
      out.push('{"name":"' + esc(e.displayName) + '","match":"' + esc(e.matchName) + '","category":"' + esc(e.category) + '"}');
    }
    return '{"status":"ok","total":' + n + ',"effects":[' + out.join(",") + ']}';
  } catch (err) { return '{"status":"error","message":"' + esc(String(err)) + '"}'; }
})();`;

async function send(script, timeoutMs) {
  fs.writeFileSync(RES, JSON.stringify({ status: 'waiting' }));
  fs.writeFileSync(CMD, JSON.stringify({ command: 'runScript', args: { script }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const c = JSON.parse(fs.readFileSync(CMD, 'utf8'));
      if (c.status === 'completed' || c.status === 'error') return JSON.parse(fs.readFileSync(RES, 'utf8'));
    } catch { /* mid-write */ }
  }
  return null;
}

const CHUNK = 250;
let report = null;
{
  const first = await send(chunkScript(0, CHUNK), 240000);
  if (!first || first.status !== 'ok') { console.error('failed: ' + JSON.stringify(first).slice(0, 200)); process.exit(1); }
  report = { status: 'ok', count: first.total, effects: first.effects };
  for (let from = CHUNK; from < first.total; from += CHUNK) {
    process.stderr.write(`chunk ${from}/${first.total}...\n`);
    const c = await send(chunkScript(from, from + CHUNK), 240000);
    if (!c || c.status !== 'ok') { console.error('chunk failed at ' + from); process.exit(1); }
    report.effects.push(...c.effects);
  }
}

const byVendor = {};
for (const e of report.effects) {
  const vendor = e.match.startsWith('ADBE') ? 'Adobe' : e.match.startsWith('CC ') ? 'Cycore' : e.match.split(/[ _-]/)[0];
  byVendor[vendor] = (byVendor[vendor] || 0) + 1;
}
const outPath = path.join(__dirname, 'installed_effects.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(`${report.count} installed effects -> ${outPath}`);
console.log('by vendor prefix:', JSON.stringify(byVendor));
