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

const SCRIPT = String.raw`(function () {
  var esc = function (s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\"'); };
  try {
    var out = [];
    for (var i = 1; i <= app.effects.length; i++) {
      var e = app.effects[i];
      out.push('{"name":"' + esc(e.displayName) + '","match":"' + esc(e.matchName) + '","category":"' + esc(e.category) + '"}');
    }
    return '{"status":"ok","count":' + out.length + ',"effects":[' + out.join(",") + ']}';
  } catch (err) { return '{"status":"error","message":"' + esc(String(err)) + '"}'; }
})();`;

fs.writeFileSync(RES, JSON.stringify({ status: 'waiting' }));
fs.writeFileSync(CMD, JSON.stringify({ command: 'runScript', args: { script: SCRIPT }, timestamp: new Date().toISOString(), status: 'pending' }, null, 2));

const deadline = Date.now() + 60000;
let report = null;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1500));
  try {
    const c = JSON.parse(fs.readFileSync(CMD, 'utf8'));
    if (c.status === 'completed' || c.status === 'error') { report = JSON.parse(fs.readFileSync(RES, 'utf8')); break; }
  } catch { /* mid-write */ }
}
if (!report || report.status !== 'ok') { console.error('failed: ' + JSON.stringify(report).slice(0, 200)); process.exit(1); }

const byVendor = {};
for (const e of report.effects) {
  const vendor = e.match.startsWith('ADBE') ? 'Adobe' : e.match.startsWith('CC ') ? 'Cycore' : e.match.split(/[ _-]/)[0];
  byVendor[vendor] = (byVendor[vendor] || 0) + 1;
}
const outPath = path.join(__dirname, 'installed_effects.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(`${report.count} installed effects -> ${outPath}`);
console.log('by vendor prefix:', JSON.stringify(byVendor));
