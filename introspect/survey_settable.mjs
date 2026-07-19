// survey_settable.mjs — how common are NOT-WRITABLE params across the installed plugin ecosystem?
//
// Deep Glow turned out to expose 9 params to the scripting API — full name, range, units, live
// value — that reject every write. The question is whether that is an oddity or endemic, because
// the answer changes how much the planner and the tune loop should trust introspection at all: if
// it is common, "readable" is simply not evidence of "usable" and every card in the index needs the
// settability pass before it can be believed.
//
// IMPORTANT — what this measures: "not writable in the effect's DEFAULT state". That is NOT the
// same as "permanently dead". A param can be conditionally gated behind a parent enum and become
// perfectly writable once it is opened — Trapcode Form's Base Form Size Y probes as hidden here and
// is set successfully by 49 shipped recipes. Read the per-effect count, not the param percentage:
// the latter is dominated by Form's 2080-param internal tree. See SETTABILITY.md.
//
// One effect at a time would be a 1522-effect, multi-hour crawl. This samples instead — a stratified
// draw across vendor families, so each family's rate is measured on its own rather than being
// swamped by whichever vendor happens to ship the most filters.
//
// usage: node introspect/survey_settable.mjs [--per-family=8] [--families=BCC,Sapphire,...]
//        [--only=<matchName,...>]  [--out=<report.json>]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS = path.join(__dirname, 'cards');
const INTROSPECT = path.join(__dirname, 'introspect_effect.mjs');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const perFamily = Number(arg('per-family', 8));
const outPath = path.resolve(arg('out', path.join(__dirname, 'settability_survey.json')));

const installed = JSON.parse(fs.readFileSync(path.join(__dirname, 'installed_effects.json'), 'utf8')).effects;

// Family from the match name, which is the honest vendor signature (display categories lie: BCC
// spreads across a dozen "BCC ..." categories, native AE effects live under Stylize/Distort/etc).
function familyOf(e) {
  const m = e.match;
  if (/^ADBE/.test(m)) return 'AE native';
  if (/^CC/.test(m) || /^CS /.test(m)) return 'Cycore (CC)';
  if (/^BCC/.test(m)) return 'Boris BCC';
  if (/^S_/.test(m)) return 'Sapphire';
  if (/^tc /i.test(m) || /^Trapcode/i.test(m)) return 'Trapcode';
  if (/^VIDEOCOPILOT/i.test(m)) return 'Video Copilot';
  if (/^(RG |Universe|Red Giant)/i.test(m)) return 'RG Universe';
  if (/==$/.test(m)) return 'FxFactory';                 // base64-ish opaque ids
  return 'other';
}

const only = (arg('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const wantFamilies = (arg('families', '') || '').split(',').map(s => s.trim()).filter(Boolean);

// Deterministic stride sampling rather than random: reruns compare directly, and it spreads the
// draw across a vendor's whole catalogue instead of clustering on whatever ships first.
function sample(list, n) {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
}

let targets;
if (only.length) {
  targets = installed.filter(e => only.includes(e.match) || only.includes(e.name));
} else {
  const byFamily = new Map();
  for (const e of installed) {
    if (/obsolete/i.test(e.category)) continue;          // shipped-but-dead effects skew the rate
    const f = familyOf(e);
    if (wantFamilies.length && !wantFamilies.includes(f)) continue;
    if (!byFamily.has(f)) byFamily.set(f, []);
    byFamily.get(f).push(e);
  }
  targets = [...byFamily.entries()].flatMap(([, list]) => sample(list, perFamily));
}

console.log(`surveying ${targets.length} effect(s) across ${new Set(targets.map(familyOf)).size} families…\n`);

const rows = [];
for (let i = 0; i < targets.length; i++) {
  const e = targets[i];
  const safe = e.match.replace(/[^a-zA-Z0-9]+/g, '_');
  const cardPath = path.join(CARDS, safe + '.json');
  process.stdout.write(`[${i + 1}/${targets.length}] ${e.name} … `);

  // introspect_effect does both passes (structure, then settability on the settled instance)
  const r = spawnSync('node', [INTROSPECT, e.match], { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0 || !fs.existsSync(cardPath)) {
    console.log(`skipped (${(r.stdout || r.stderr || 'no card').trim().split('\n').pop().slice(0, 60)})`);
    rows.push({ name: e.name, matchName: e.match, family: familyOf(e), status: 'skipped' });
    continue;
  }
  let card;
  try { card = JSON.parse(fs.readFileSync(cardPath, 'utf8')); }
  catch { console.log('skipped (unreadable card)'); rows.push({ name: e.name, matchName: e.match, family: familyOf(e), status: 'skipped' }); continue; }

  const leaves = card.params.filter(p => p.type !== 'GROUP' && p.settable);
  const hidden = leaves.filter(p => p.settable === 'hidden');
  if (!leaves.length) {
    console.log('skipped (settability probe did not run)');
    rows.push({ name: e.name, matchName: e.match, family: familyOf(e), status: 'skipped' });
    continue;
  }
  rows.push({
    name: e.name, matchName: e.match, family: familyOf(e), status: 'ok',
    leaves: leaves.length, hidden: hidden.length,
    hiddenParams: hidden.map(p => ({ matchName: p.matchName, name: p.name })),
  });
  console.log(`${hidden.length}/${leaves.length} hidden${hidden.length ? '  ← ' + hidden.slice(0, 4).map(p => p.name || p.matchName).join(', ') : ''}`);
}

// ---- rollup -------------------------------------------------------------------------------------
const ok = rows.filter(r => r.status === 'ok');
const byFam = new Map();
for (const r of ok) {
  if (!byFam.has(r.family)) byFam.set(r.family, { effects: 0, withHidden: 0, leaves: 0, hidden: 0 });
  const f = byFam.get(r.family);
  f.effects++; f.leaves += r.leaves; f.hidden += r.hidden;
  if (r.hidden) f.withHidden++;
}

const report = {
  _date: new Date().toISOString().slice(0, 10),
  _method: 'introspect_effect settability second pass (settled instance) on a stratified sample',
  _meaning: 'hidden = not writable in the DEFAULT state. Conditionally-gated params count here too — see SETTABILITY.md.',
  sampled: rows.length, probed: ok.length, skipped: rows.length - ok.length,
  totals: {
    effectsWithHidden: ok.filter(r => r.hidden).length,
    leaves: ok.reduce((a, r) => a + r.leaves, 0),
    hidden: ok.reduce((a, r) => a + r.hidden, 0),
  },
  byFamily: Object.fromEntries([...byFam].map(([k, v]) => [k, {
    ...v,
    pctEffectsAffected: v.effects ? +(100 * v.withHidden / v.effects).toFixed(1) : 0,
    pctParamsHidden: v.leaves ? +(100 * v.hidden / v.leaves).toFixed(1) : 0,
  }])),
  effects: rows,
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 1));

console.log(`\n=== settability survey (not-writable in DEFAULT state) — ${ok.length} effects probed ===`);
console.log('family              effects   with-hidden   params  hidden');
for (const [fam, v] of [...byFam].sort((a, b) => b[1].hidden - a[1].hidden)) {
  console.log(`${fam.padEnd(20)}${String(v.effects).padStart(6)}${String(v.withHidden).padStart(11)} (${String(Math.round(100 * v.withHidden / v.effects)).padStart(3)}%)${String(v.leaves).padStart(9)}${String(v.hidden).padStart(7)} (${(100 * v.hidden / v.leaves).toFixed(1)}%)`);
}
console.log(`\n${report.totals.effectsWithHidden}/${ok.length} effects expose at least one param that is NOT WRITABLE in the default state.`);
console.log(`${report.totals.hidden}/${report.totals.leaves} sampled params (${(100 * report.totals.hidden / report.totals.leaves).toFixed(1)}%) — but see SETTABILITY.md: this figure is dominated by one effect and conflates gated with dead.`);
console.log(`\nreport → ${path.relative(path.resolve(__dirname, '..'), outPath)}`);
