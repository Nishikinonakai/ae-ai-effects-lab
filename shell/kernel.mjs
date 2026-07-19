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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SHELL_DIR = path.join(os.homedir(), 'Documents', 'ae-ai-shell');
const REQ = path.join(SHELL_DIR, 'request.json');
const STATE = path.join(SHELL_DIR, 'state.json');
const WORK = path.join(SHELL_DIR, 'work');
fs.mkdirSync(WORK, { recursive: true });

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a === undefined ? d : a.slice(n.length + 3); };
const MODEL = arg('model', 'gpt-5.6-terra');
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
  const next = { ...prev, ...patch, ts: new Date().toISOString() };
  fs.writeFileSync(STATE, JSON.stringify(next, null, 2));
  if (patch.message) console.log(`[${patch.phase || next.phase || '·'}] ${patch.message}`);
  return next;
}

// ScriptUI image controls do NOT scale their contents — they draw at native pixel size. Handing the
// panel a real AE frame (1280x720 here, 4K on the artist's actual work) would blow the palette
// layout apart. So the panel is only ever given a thumbnail, generated with sips (macOS-native, and
// already the downscaler verify_edit uses for the vision API). Falls back to the original path if
// sips fails — a mis-sized preview beats no preview.
const PREVIEW_W = 320;
function previewOf(framePath) {
  if (!framePath || !fs.existsSync(framePath)) return framePath || null;
  const out = framePath.replace(/\.png$/i, `_panel${PREVIEW_W}.png`);
  const r = spawnSync('sips', ['-Z', String(PREVIEW_W), framePath, '--out', out], { encoding: 'utf8' });
  return (r.status === 0 && fs.existsSync(out)) ? out : framePath;
}

function run(script, args, { onLine } = {}) {
  return new Promise(resolve => {
    const p = spawn('node', [path.join(REPO, script), ...args], { cwd: REPO });
    let out = '', err = '';
    p.stdout.on('data', d => {
      out += d;
      // stream the tools' own progress lines to the panel — the artist sees "iter 1: 7/10", not a
      // frozen spinner. These loops take minutes on a real comp; silence reads as a hang.
      if (onLine) for (const line of String(d).split('\n')) { const t = line.trim(); if (t) onLine(t); }
    });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, out, err }));
  });
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

  // 2) PLAN
  setState({ phase: 'planning', message: 'deciding what to change…' });
  const planArgs = [`--intent=${intent}`, `--state=${path.join(workDir, stateFile)}`, `--out=${path.join(workDir, 'plan_spec.json')}`, `--model=${MODEL}`];
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

  // 3) ACT + VERIFY + CONVERGE
  setState({ phase: 'applying', message: 'applying and checking the render…' });
  const tune = await run('brownfield/tune_edit.mjs', [
    `--seed=${specPath}`, `--intent=${intent}`, `--layer=${spec._targetLayer || 1}`,
    `--max-iters=${MAX_ITERS}`, `--accept=${ACCEPT_BAR}`, `--model=${MODEL}`, `--out=${workDir}`,
  ], {
    onLine: line => {
      const m = line.match(/→ iter (\d+): (\w+) (\d+)\/10/);
      if (m) setState({ phase: 'applying', message: `pass ${Number(m[1]) + 1}: scored ${m[3]}/10` });
      else if (line.startsWith('  ↳')) setState({ message: line.replace(/^\s*↳\s*/, 'trying: ') });
    },
  });

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
  setState({
    phase: 'review',
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
  if (busy || !fs.existsSync(REQ)) return;
  let req;
  try { req = JSON.parse(fs.readFileSync(REQ, 'utf8')); } catch { return; }   // mid-write
  if (req.status !== 'pending') return;

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

session = loadSession();
if (session) {
  setState({ phase: 'review', message: `resumed — ${session.appliedReports.length} edit(s) from "${session.intent}" are still applied and not yet accepted.`, canAccept: true, canRollback: true, intent: session.intent });
} else {
  setState({ phase: 'idle', message: 'ready', canAccept: false, canRollback: false, trace: [], frame: null });
}
console.log(`kernel up — watching ${REQ}`);
console.log(`  model=${MODEL}  max-iters=${MAX_ITERS}  accept-bar=${ACCEPT_BAR}`);
if (ONCE) { await poll(); process.exit(0); }
setInterval(poll, 800);
