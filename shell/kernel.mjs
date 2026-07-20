// kernel.mjs — the PRODUCT SHELL's brain: a daemon that turns a sentence typed in an AE panel
// into a verified edit on the artist's comp.
//
// PRD §七's three-piece architecture is "a thin panel inside AE + a brain outside it + a bridge".
// The brain is this. It owns everything that cannot run inside AE's scripting engine — the LLM
// planning call, the essence index, the visual scorer, the convergence loop — and drives AE only
// through the existing file bridge.
//
// It is deliberately a SEPARATE channel from the AE bridge (~/Documents/ae-mcp-bridge). That bridge
// is the kernel's own hands; this one is the artist's. Sharing them would deadlock: the panel would
// be writing commands to the same file the kernel is using to drive AE.
//
//   ~/Documents/ae-ai-shell/request.json   panel → kernel   {action, intent, layer}
//   ~/Documents/ae-ai-shell/state.json     kernel → panel   {phase, message, frame, canAccept, ...}
//
// One request at a time, by design: an artist watching a frame render does not want a queue, and a
// second concurrent edit would race the first one's rollback stack.
//
// The pipeline per request is the one this repo validated piece by piece:
//   dump_comp (perceive) → plan_edit (decide) → tune_edit (act + verify + converge) → present
// and then the artist decides — Accept keeps it, Rollback undoes the WHOLE request, deterministically.
//
// usage: node shell/kernel.mjs [--model=gpt-5.6-terra] [--max-iters=3] [--accept=8] [--once]
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { loadCards, cardFor } from '../introspect/essence/lookup.mjs';
import { defaultModel, spendSummary, setPurpose, activeConfig } from './llm.mjs';

// matchName -> the name an artist would recognise, via the essence index. Falls back to the
// matchName, which is at least addressable, rather than to nothing.
function niceName(fxMatch, paramMatch) {
  const card = cardFor(fxMatch);
  if (!card) return null;
  if (!paramMatch) return card.displayName || null;
  for (const l of card.key_levers || []) if (l.matchName === paramMatch) return l.name;
  return null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SHELL_DIR = path.join(os.homedir(), 'Documents', 'ae-ai-shell');
const REQ = path.join(SHELL_DIR, 'request.json');
const STATE = path.join(SHELL_DIR, 'state.json');
const WORK = path.join(SHELL_DIR, 'work');
fs.mkdirSync(WORK, { recursive: true });

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
// No hardcoded model. A provider-specific name baked in here is the same bug as the hardcoded
// OPENAI_API_KEY one file over: swapping the credential 404'd every request with
// "models/gpt-5.6-terra is not found". llm.mjs owns provider->model; pass --model only to override.
const MODEL = arg('model', null);
const MAX_ITERS = Number(arg('max-iters', 3));
const ACCEPT_BAR = Number(arg('accept', 8));
const ONCE = process.argv.includes('--once');

// ---- panel-facing state ----------------------------------------------------------------------
// The panel is a dumb renderer of this object. Anything the artist should see goes here, including
// failures: a shell that silently does nothing is worse than one that says what broke.
// The session records what is currently applied but not yet accepted — i.e. exactly what Rollback
// has to undo. It is PERSISTED, not just held in memory: if the kernel dies (or is restarted) while
// an edit is sitting unaccepted on the artist's comp, an in-memory session would strand them with
// changes the product can no longer undo. The rollback reports are on disk anyway; the pointer to
// them has to be too.
const SESSION = path.join(SHELL_DIR, 'session.json');
let session = null;      // { appliedReports: [...], summaryPath, intent }
function saveSession() {
  if (session) fs.writeFileSync(SESSION, JSON.stringify(session, null, 2));
  else if (fs.existsSync(SESSION)) fs.unlinkSync(SESSION);
}
function loadSession() {
  if (!fs.existsSync(SESSION)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(SESSION, 'utf8'));
    // only resume if the reports it points at still exist — otherwise rollback would half-fail
    const live = (s.appliedReports || []).filter(r => fs.existsSync(path.resolve(REPO, r)));
    if (live.length !== (s.appliedReports || []).length) return null;
    return live.length ? s : null;
  } catch { return null; }
}
function setState(patch) {
  const prev = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
  // Spend rides on every state write, so the panel can show it without asking. A cost the artist
  // only discovers on the monthly bill is a cost they cannot act on.
  let spend = null;
  try { const d = spendSummary({ sinceMs: 24 * 3600 * 1000 }); spend = `$${d.total.toFixed(3)} today · ${d.calls} calls`; } catch { /* never block a state write */ }
  const next = { ...prev, ...patch, ...(spend ? { spend } : {}), ts: new Date().toISOString() };
  fs.writeFileSync(STATE, JSON.stringify(next, null, 2));
  if (patch.message) console.log(`[${patch.phase || next.phase || '·'}] ${patch.message}`);
  return next;
}

// ScriptUI image controls do NOT scale their contents — they draw at native pixel size. Handing the
// panel a real AE frame (1280x720 here, 4K on the artist's actual work) would blow the palette
// layout apart. So the panel is only ever given a thumbnail, generated with sips (macOS-native, and
// already the downscaler verify_edit uses for the vision API). Falls back to the original path if
// sips fails — a mis-sized preview beats no preview.
// ScriptUI image controls do not scale their contents — they draw at native size, so the thumbnail
// width IS a minimum width for the whole panel. A fixed 320 therefore forced the panel to be at
// least that wide however the artist had docked it. The panel reports its own width with each
// request and the preview is generated to match, so the layout follows the dock instead of fighting
// it. Clamped: too small to read is as useless as too wide to fit.
let previewW = 320;
function setPreviewWidth(w) {
  const n = Number(w);
  if (Number.isFinite(n) && n >= 160) previewW = Math.max(200, Math.min(640, Math.round(n) - 30));
}
function previewOf(framePath) {
  if (!framePath || !fs.existsSync(framePath)) return framePath || null;
  const out = framePath.replace(/\.png$/i, `_panel${previewW}.png`);
  const r = spawnSync('sips', ['-Z', String(previewW), framePath, '--out', out], { encoding: 'utf8' });
  return (r.status === 0 && fs.existsSync(out)) ? out : framePath;
}

// The child currently doing the work, so Stop can reach it. A tune is minutes of rendering and paid
// scoring; without a way to interrupt it the only exit is killing the kernel, which strands the
// session and loses the rollback stack the artist needs.
let activeChild = null;
let cancelled = false;

function run(script, args, { onLine } = {}) {
  return new Promise(resolve => {
    const p = spawn('node', [path.join(REPO, script), ...args], { cwd: REPO });
    activeChild = p;
    let out = '', err = '';
    p.stdout.on('data', d => {
      out += d;
      // stream the tools' own progress lines to the panel — the artist sees "iter 1: 7/10", not a
      // frozen spinner. These loops take minutes on a real comp; silence reads as a hang.
      if (onLine) for (const line of String(d).split('\n')) { const t = line.trim(); if (t) onLine(t); }
    });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => { if (activeChild === p) activeChild = null; resolve({ code, out, err, cancelled }); });
  });
}

// Stop leaves the applied edits IN PLACE and keeps the rollback stack — the artist asked to stop,
// not to undo. They can then Roll back deliberately, or keep what landed so far. Silently undoing on
// cancel would be the product deciding for them.
function finishCancelled() {
  const n = session?.appliedReports?.length || 0;
  setState({
    phase: 'cancelled',
    message: n ? `stopped — ${n} edit(s) are applied. Keep them or roll back.` : 'stopped before anything was applied.',
    canAccept: n > 0, canRollback: n > 0,
  });
}

function handleCancel() {
  if (!activeChild) { setState({ phase: 'idle', message: 'nothing running' }); return; }
  cancelled = true;
  setState({ phase: 'cancelling', message: 'stopping after the current step…' });
  // SIGTERM, not SIGKILL: apply_edit and tune_edit hold an open AE undo group and a bridge command
  // in flight. Killing outright can leave AE with a half-open undo group and the bridge waiting on a
  // reply that never comes, which wedges the panel for every later request.
  try { activeChild.kill('SIGTERM'); } catch { /* already gone */ }
}

// WHAT IT CHANGED, in the artist's vocabulary — the handover surface.
//
// PRD §11.6 concluded the product's value is getting the STRUCTURE right and handing over, not
// converging to a 9: finding the right stack among 1522 installed effects is what the artist cannot
// do; dialling the last 20% to taste is the part they enjoy. A panel that reports only "7/10" hands
// over nothing. This turns the applied spec into lines they can act on — effect names, not
// matchNames, and the parade slot so a second instance is unambiguous.
function describeChanges(specPath, cardsFor) {
  if (!fs.existsSync(specPath)) return '';
  let spec;
  try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); } catch { return ''; }
  const lines = [];
  for (const e of spec.edits || []) {
    const fx = e.effectMatchName || (e.propertyPath && e.propertyPath[1]) || '';
    const nice = cardsFor(fx) || fx;
    if (e.op === 'addEffect') lines.push(`+ added ${nice}`);
    else if (e.op === 'param') {
      const lever = cardsFor(fx, e.paramMatchName);
      lines.push(`~ ${nice}${e.effectIndex ? ` #${e.effectIndex}` : ''} · ${lever || e.paramMatchName} → ${JSON.stringify(e.value)}${e.keyframeMode ? ` (${e.keyframeMode})` : ''}`);
    } else if (e.op === 'expression') lines.push(`ƒ ${e.target || 'property'} driven by an expression`);
  }
  if (spec._rationale) lines.push('', spec._rationale);
  return lines.join('\n');
}

// ---- the pipeline ------------------------------------------------------------------------------
async function handleRun(req) {
  const intent = String(req.intent || '').trim();
  if (!intent) { setState({ phase: 'error', message: 'no intent given', canAccept: false, canRollback: false }); return; }

  // Carry forward anything still applied and unaccepted. Overwriting the session here would drop
  // the only pointer to the previous request's rollback reports — the edits would stay on the
  // artist's comp with no way for the product to undo them, which is the same class of bug as
  // losing the session on a crash. Asking a second question is not consent to lose the first
  // answer, so instead the stack accumulates and Rollback unwinds all of it, newest first.
  cancelled = false;
  setPreviewWidth(req.panelWidth);
  const carried = session?.appliedReports?.length ? session.appliedReports : [];
  if (carried.length) console.log(`carrying ${carried.length} unaccepted edit(s) from "${session.intent}" into this request's rollback stack`);
  session = { intent, appliedReports: [...carried], carriedFrom: carried.length ? session.intent : null, summaryPath: null };
  saveSession();   // keep disk and memory in step even if this request fails before it applies anything
  const workDir = path.join(WORK, `req_${Date.now().toString(36)}`);
  fs.mkdirSync(workDir, { recursive: true });

  // 1) PERCEIVE
  setState({ phase: 'perceiving', message: 'reading your composition…', intent, frame: null, canAccept: false, canRollback: false, trace: [] });
  const dump = await run('brownfield/dump_comp.mjs', [`--out=${workDir}`]);
  if (dump.code !== 0) { setState({ phase: 'error', message: `could not read the comp — is a composition open and the bridge panel running?\n${dump.err.slice(0, 300)}` }); return; }
  const stateFile = fs.readdirSync(workDir).find(f => f.endsWith('_state.json'));
  const frameFile = fs.readdirSync(workDir).find(f => f.endsWith('_frame.png'));
  if (!stateFile) { setState({ phase: 'error', message: 'perception produced no state file' }); return; }
  const perceived = JSON.parse(fs.readFileSync(path.join(workDir, stateFile), 'utf8'));
  setState({ message: `comp "${perceived.comp}" — ${perceived.activeCount}/${perceived.numLayers} layers live at this frame`, frame: previewOf(frameFile ? path.join(workDir, frameFile) : null) });
  if (perceived.missingLive) {
    setState({ message: `⚠ ${perceived.missingLive} live layer(s) have offline footage — the render shows placeholders, so visual judgement will be unreliable` });
  }

  if (cancelled) return finishCancelled();

  // 2) PLAN
  process.env.AE_AI_PURPOSE = 'plan';
  setState({ phase: 'planning', message: 'deciding what to change…' });
  const planArgs = [`--intent=${intent}`, `--state=${path.join(workDir, stateFile)}`, `--out=${path.join(workDir, 'plan_spec.json')}`];
  if (MODEL) planArgs.push(`--model=${MODEL}`);
  if (frameFile) planArgs.push(`--frame=${path.join(workDir, frameFile)}`);
  if (req.layer) planArgs.push(`--layer=${req.layer}`);
  const plan = await run('shell/plan_edit.mjs', planArgs);
  const specPath = path.join(workDir, 'plan_spec.json');
  if (!fs.existsSync(specPath)) { setState({ phase: 'error', message: `planning failed:\n${(plan.err || plan.out).slice(0, 400)}` }); return; }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  setState({ message: spec._rationale || 'planned.', rationale: spec._rationale });
  if (!spec.edits?.length) {
    // The honest outcome when the load-bearing state isn't scriptable (an unpainted Roto matte, an
    // unbuilt Element 3D scene). Say which handoff is needed rather than applying a bluff edit.
    setState({ phase: 'handoff', message: spec._rationale || 'This needs something only you can do in the UI first.', canAccept: false, canRollback: false });
    return;
  }

  if (cancelled) return finishCancelled();

  // 3) ACT + VERIFY + CONVERGE
  process.env.AE_AI_PURPOSE = 'tune';
  setState({ phase: 'applying', message: 'applying and checking the render…' });
  const tune = await run('brownfield/tune_edit.mjs', [
    `--seed=${specPath}`, `--intent=${intent}`, `--layer=${spec._targetLayer || 1}`,
    `--max-iters=${req.maxIters || MAX_ITERS}`, `--accept=${req.acceptBar || ACCEPT_BAR}`, `--out=${workDir}`,
    ...(MODEL ? [`--model=${MODEL}`] : []),
  ], {
    onLine: line => {
      const m = line.match(/→ iter (\d+): (\w+) (\d+)\/10/);
      if (m) setState({ phase: 'applying', message: `pass ${Number(m[1]) + 1}: scored ${m[3]}/10`, pass: `${Number(m[1]) + 1}/${req.maxIters || MAX_ITERS}` });
      else if (line.startsWith('  ↳')) setState({ message: line.replace(/^\s*↳\s*/, 'trying: ') });
    },
  });

  if (cancelled) {
    // SALVAGE THE ROLLBACK STACK. A killed tune never writes tune_summary.json — that is the last
    // thing it does — so reading the summary found nothing and the session came back empty while the
    // comp had in fact been edited. Measured: Exposure/Radius/Threshold moved 1.6/60/260 to
    // 2.5/2000/0 and Rollback was greyed out. Stranding edits the product cannot undo is the same
    // failure the persisted session exists to prevent, reappearing on a different exit path.
    //
    // apply_edit writes one report PER EDIT as it goes, so those are the real record. Collect them
    // in application order; each carries its own deterministic inverse.
    try {
      const reports = fs.readdirSync(workDir)
        .filter(f => /^edit_.*_report\.json$/.test(f))
        .map(f => ({ f, t: fs.statSync(path.join(workDir, f)).mtimeMs }))
        .sort((a, b) => a.t - b.t)
        .map(x => path.relative(REPO, path.join(workDir, x.f)));
      if (reports.length) {
        session.appliedReports = [...(session.appliedReports || []), ...reports];
        saveSession();
        console.log(`salvaged ${reports.length} applied edit(s) from the interrupted tune — Rollback can undo them`);
      }
    } catch (e) { console.error(`could not salvage the rollback stack: ${e}`); }
    return finishCancelled();
  }

  const summaryPath = path.join(workDir, 'tune_summary.json');
  if (!fs.existsSync(summaryPath)) { setState({ phase: 'error', message: `the edit loop produced no result:\n${(tune.err || tune.out).slice(-400)}` }); return; }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  // append, don't replace — `carried` holds the earlier request's still-unaccepted edits, and they
  // must stay in the stack (older first, so rollback unwinds newest first)
  session.appliedReports = [...carried, ...(summary.appliedReports || [])];
  session.summaryPath = summaryPath;
  saveSession();

  const scored = summary.bestScore;
  const good = summary.accepted || scored >= ACCEPT_BAR;
  const carryNote = carried.length ? ` (Roll back also undoes ${carried.length} earlier edit(s) you never accepted.)` : '';
  const changed = describeChanges(specPath, niceName);
  setState({
    phase: 'review',
    changed,
    message: (good
      ? `Done — scored ${scored}/10. Keep it?`
      : `Best I got was ${scored}/10 — it may not be what you meant. Keep it or roll back?`) + carryNote,
    frame: previewOf(summary.finalFrame ? path.resolve(REPO, summary.finalFrame) : null),
    trace: summary.trace || [],
    score: scored,
    canAccept: true,
    canRollback: session.appliedReports.length > 0,
  });
}

async function handleRollback() {
  if (!session?.appliedReports?.length) { setState({ phase: 'idle', message: 'nothing to roll back', canAccept: false, canRollback: false }); return; }
  setState({ phase: 'rolling-back', message: 'undoing…', canAccept: false, canRollback: false });
  // newest-first: each report's inverse assumes the edits above it are already gone
  let undone = 0;
  for (const rel of [...session.appliedReports].reverse()) {
    // A report whose edits all FAILED carries no inverse — there is nothing to undo and that is not
    // an error. Treating it as one aborted the whole rollback at the newest report and left the
    // artist with everything still applied and a scary message. Skip it and keep unwinding.
    try {
      const rep = JSON.parse(fs.readFileSync(path.resolve(REPO, rel), 'utf8'));
      if (!(rep.inverse || []).length) { console.log(`  (skipping ${path.basename(rel)} — nothing was applied)`); undone++; continue; }
    } catch { /* unreadable — let apply_edit report it */ }

    const r = await run('brownfield/apply_edit.mjs', [`--rollback=${path.resolve(REPO, rel)}`]);
    if (r.code !== 0) {
      // keep only what is still applied, so a retry does not re-undo an edit that already came off
      session.appliedReports = session.appliedReports.slice(0, session.appliedReports.length - undone);
      saveSession();
      setState({ phase: 'error', message: `rollback stopped after ${undone} edit(s) — your comp may be partly changed. Press Roll back again, or use AE's Undo (\u2318Z).`, canRollback: true });
      return;
    }
    undone++;
  }
  session = null; saveSession();
  setState({ phase: 'idle', message: `rolled back ${undone} edit(s) — your comp is back where it started.`, frame: null, canAccept: false, canRollback: false, trace: [] });
}

function handleAccept() {
  const n = session?.appliedReports?.length || 0;
  session = null; saveSession();
  setState({ phase: 'idle', message: n ? `kept ${n} edit(s).` : 'kept.', canAccept: false, canRollback: false, trace: [] });
}

// ---- request loop -------------------------------------------------------------------------------
// Requests are consumed by rewriting status:"taken", so a panel that re-polls does not re-fire the
// same edit. The panel writes status:"pending"; anything else is ignored.
let busy = false;
async function poll() {
  if (!fs.existsSync(REQ)) return;
  let req;
  try { req = JSON.parse(fs.readFileSync(REQ, 'utf8')); } catch { return; }   // mid-write
  if (req.status !== 'pending') return;

  // CANCEL MUST BE READABLE WHILE BUSY. The busy guard used to sit at the top of this function, so
  // the one request that only makes sense mid-run was the one request that could never be read —
  // pressing Stop did nothing until the tune finished on its own, which defeats the entire point.
  // Cancel is also cheap and non-blocking (it signals a child), so it does not need the queue.
  if (req.action === 'cancel') {
    fs.writeFileSync(REQ, JSON.stringify({ ...req, status: 'taken' }, null, 2));
    handleCancel();
    return;
  }

  if (busy) return;
  busy = true;
  try {
    fs.writeFileSync(REQ, JSON.stringify({ ...req, status: 'taken' }, null, 2));
    if (req.action === 'run') await handleRun(req);
    else if (req.action === 'accept') handleAccept();
    else if (req.action === 'rollback') await handleRollback();
    else setState({ phase: 'error', message: `unknown action "${req.action}"` });
  } catch (e) {
    setState({ phase: 'error', message: `kernel error: ${String(e).slice(0, 300)}` });
  } finally {
    busy = false;
  }
}

// A fresh start must not present a STALE RESULT as if it were current. setState merges, so the
// previous run's frame, rationale, score and "what it changed" survived every restart — the panel
// opened showing a finished job nobody had just run, with Keep it / Roll back live against a session
// that no longer existed. Clear the result fields explicitly; only a resumable session re-populates.
const RESULT_FIELDS = { frame: null, changed: null, rationale: null, score: null, trace: [], pass: null };

session = loadSession();
if (session) {
  setState({ ...RESULT_FIELDS, phase: 'review', message: `resumed — ${session.appliedReports.length} edit(s) from "${session.intent}" are still applied and not yet accepted.`, canAccept: true, canRollback: true, intent: session.intent });
} else {
  setState({ ...RESULT_FIELDS, phase: 'idle', message: 'ready', canAccept: false, canRollback: false });
}
console.log(`kernel up — watching ${REQ}`);
const cfg = activeConfig();
console.log(`  provider=${cfg.provider || 'NONE'}  model=${MODEL || cfg.model || '(none)'}  key from=${cfg.keySource}`);
console.log(`  max-iters=${MAX_ITERS}  accept-bar=${ACCEPT_BAR}`);
if (!cfg.provider) console.error('  ⚠ no credential found — every request will fail at planning. node shell/keys.mjs status');
// Put it where the artist can see it too, not just in a terminal they may never look at.
setState({ engine: `${cfg.provider || 'none'} · ${MODEL || cfg.model || 'none'}` });
if (ONCE) { await poll(); process.exit(0); }
setInterval(poll, 800);
