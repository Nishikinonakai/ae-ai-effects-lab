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
// usage: node shell/kernel.mjs [--model=<provider default>] [--max-iters=3] [--accept=8] [--once]
//        [--dashboard-port=7867] [--no-dashboard]
// NOTE on --accept: 8 is not calibrated against the ACTIVE scorer. The default Gemini model scored
// 3-7 across 15 cases and never once emitted an 8 (recipe-harness/vision/ab_report.json), so on that
// corpus the accept path is unreachable and every run ends in handover. See KNOWN_ISSUES.md.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { loadCards, cardFor } from '../introspect/essence/lookup.mjs';
import { defaultModel, spendSummary, setPurpose, activeConfig, beginRequest, endRequest } from './llm.mjs';
import { startDashboard } from './dashboard.mjs';
import { budgetStatus } from './budget.mjs';
import { looksLikeBridgeTimeout, reviveBridge, collectEditReports } from './recover.mjs';
import { gateIntent } from './intent_gate.mjs';

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
    else if (e.op === 'addLayer') lines.push(`⊕ new ${e.kind || 'solid'} layer${e.name ? ` "${e.name}"` : ''} on top`);
    else if (e.op === 'textContent') lines.push(`✎ layer ${e.layerIndex} text → "${String(e.text).slice(0, 40)}"`);
  }
  if (spec._rationale) lines.push('', spec._rationale);
  return lines.join('\n');
}

// Result fields must be CLEARED at every request start, not only at kernel boot. setState merges,
// so without this a request that ends in handoff/error shows the PREVIOUS run's frame, score and
// "what it changed" — measured live (2026-07-21, the user's adversarial test): a text-replace
// request correctly refused as a handoff, while the panel still displayed the Form-ember edits
// from the run before it. Same shape as the stale-result-on-restart bug, one path over (§十三).
const RESULT_FIELDS = { frame: null, changed: null, rationale: null, score: null, trace: [], pass: null, handoffCode: null };

// ---- the pipeline ------------------------------------------------------------------------------
async function handleRun(req) {
  const intent = String(req.intent || '').trim();
  if (!intent) { setState({ phase: 'error', message: 'no intent given', canAccept: false, canRollback: false }); return; }

  // Requests whose missing capability is knowable without reading the comp must stop here. Besides
  // preventing bluff edits, this avoids spending a planning/scoring call on an impossible request.
  // Preserve any older unaccepted session: a handoff must never strand its rollback stack.
  const gated = gateIntent(intent);
  if (gated) {
    const pending = !!session?.appliedReports?.length;
    setState({
      ...RESULT_FIELDS,
      phase: 'handoff',
      message: gated.rationale,
      rationale: gated.rationale,
      intent,
      handoffCode: gated.code,
      canAccept: pending,
      canRollback: pending,
    });
    return;
  }

  // Carry forward anything still applied and unaccepted. Overwriting the session here would drop
  // the only pointer to the previous request's rollback reports — the edits would stay on the
  // artist's comp with no way for the product to undo them, which is the same class of bug as
  // losing the session on a crash. Asking a second question is not consent to lose the first
  // answer, so instead the stack accumulates and Rollback unwinds all of it, newest first.
  // PRE-FLIGHT THE BUDGET. The gate in llm.mjs is the thing that actually stops spending, but on its
  // own it surfaces mid-request as a cryptic failure after the comp has already been read. Checking
  // here means the artist is told before anything happens, in numbers, with the command to change it.
  const bud = budgetStatus();
  if (bud.exceeded) {
    setState({
      phase: 'budget',
      message: `Daily budget reached — $${bud.spentToday.toFixed(3)} of $${bud.dailyUsd.toFixed(2)}. Nothing was run. Raise it with: node shell/budget.mjs daily <amount>`,
      canAccept: false, canRollback: !!session?.appliedReports?.length,
    });
    return;
  }

  cancelled = false;
  // Open the per-request budget window. Its scope is the whole tune, not one API call — the cap is
  // there to stop a loop that keeps iterating, and a loop is many calls.
  beginRequest(intent.slice(0, 60));
  setPreviewWidth(req.panelWidth);
  const carried = session?.appliedReports?.length ? session.appliedReports : [];
  if (carried.length) console.log(`carrying ${carried.length} unaccepted edit(s) from "${session.intent}" into this request's rollback stack`);
  session = { intent, appliedReports: [...carried], carriedFrom: carried.length ? session.intent : null, summaryPath: null };
  saveSession();   // keep disk and memory in step even if this request fails before it applies anything
  const workDir = path.join(WORK, `req_${Date.now().toString(36)}`);
  fs.mkdirSync(workDir, { recursive: true });

  // 1) PERCEIVE
  setState({ ...RESULT_FIELDS, phase: 'perceiving', message: 'reading your composition…', intent, canAccept: false, canRollback: false });
  let dump = await run('brownfield/dump_comp.mjs', [`--out=${workDir}`]);
  if (dump.code !== 0 && looksLikeBridgeTimeout(dump.err + dump.out) && !cancelled) {
    // The one perceive failure the shell can heal by itself: the bridge palette died (an AE
    // restart kills it — it is script-injected, unlike the dockable panel the request came from).
    // Measured live 2026-07-20 21:09: a real request timed out here and the product only shrugged.
    // Revive is bounded to this FREE, deterministic step — a paid tune is never auto-retried.
    setState({ message: 'the AE bridge is not answering — relaunching the bridge panel…' });
    const rev = await reviveBridge(REPO);
    if (!rev.ok) { setState({ phase: 'error', message: rev.why, canRollback: !!session?.appliedReports?.length }); return; }
    setState({ message: 'bridge is back — reading your composition…' });
    dump = await run('brownfield/dump_comp.mjs', [`--out=${workDir}`]);
  }
  if (dump.code !== 0) {
    const noComp = /no active composition/.test(dump.err + dump.out);
    setState({
      phase: 'error',
      message: noComp
        ? 'no composition is open in AE — open the comp you want to edit, then ask again.'
        : `could not read the comp — is a composition open and the bridge panel running?\n${dump.err.slice(0, 300)}`,
      canRollback: !!session?.appliedReports?.length,
    });
    return;
  }
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
    const pending = !!session?.appliedReports?.length;
    setState({ phase: 'handoff', message: spec._rationale || 'This needs something only you can do in the UI first.', canAccept: pending, canRollback: pending });
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

  // SALVAGE THE ROLLBACK STACK on ANY exit that never reached tune_summary.json — that file is the
  // last thing a tune writes, so a cancelled tune AND a crashed one (bridge died mid-loop, apply
  // blew up) both leave the comp edited with no summary. The cancel branch got this salvage first
  // and the crash branch did not — §十三's half-an-abstraction shape, seventh sighting — so it now
  // lives in recover.mjs and every no-summary exit goes through it. Measured when first built:
  // Exposure/Radius/Threshold moved 1.6/60/260 → 2.5/2000/0 with Rollback greyed out.
  const salvage = () => {
    const reports = collectEditReports(workDir, REPO);
    if (reports.length) {
      session.appliedReports = [...(session.appliedReports || []), ...reports];
      saveSession();
      console.log(`salvaged ${reports.length} applied edit(s) from the dead tune — Rollback can undo them`);
    }
    return reports.length;
  };

  if (cancelled) { salvage(); return finishCancelled(); }

  const summaryPath = path.join(workDir, 'tune_summary.json');
  if (!fs.existsSync(summaryPath)) {
    const n = salvage();
    setState({
      phase: 'error',
      message: `the edit loop died before finishing:\n${(tune.err || tune.out).slice(-400)}`
        + (n ? `\n${n} edit(s) it had already applied are recovered — Roll back undoes them, Accept keeps them.` : ''),
      canAccept: n > 0,
      canRollback: (session?.appliedReports?.length || 0) > 0,
    });
    return;
  }
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

// THE CALIBRATION PIPELINE. KNOWN_ISSUES #1 is stuck on a dataset nobody was collecting: the
// accept bar can only be calibrated against "what a human considered done", and every Keep/Roll
// back click IS that label — yet until 2026-07-21 the click evaporated (both handlers just cleared
// the session). One JSONL row per decision, written BEFORE the session is torn down; when a few
// dozen accumulate, the judge's score distribution can finally be lined up against human taste.
// Labels must never break the product, hence the swallow.
function logDecision(decision) {
  try {
    // A click with nothing applied ("nothing to roll back", "kept 0 edits") is not a judgment on
    // any result — recording it would poison the label set with intent:null rows. Guarded HERE,
    // once, not at each call site.
    if (!(session?.appliedReports?.length)) return;
    const st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
    fs.appendFileSync(path.join(SHELL_DIR, 'decisions.jsonl'), JSON.stringify({
      ts: new Date().toISOString(),
      decision,                                          // keep | rollback
      intent: session?.intent || null,
      score: st.score ?? null,                           // null when deciding on a resumed session
      edits: session?.appliedReports?.length || 0,
      engine: st.engine || null,
      summary: session?.summaryPath ? path.relative(REPO, String(session.summaryPath)) : null,
    }) + '\n');
  } catch { /* a lost label is a pity; a broken accept is a bug */ }
}

async function handleRollback() {
  logDecision('rollback');   // log FIRST — even a rollback that stalls midway was still a rejection
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
  // RESULT_FIELDS here too: after a rollback those changes no longer exist, and a "what it
  // changed" list describing undone edits is actively misleading (seen live after the artist's
  // level-by-level rollback — the fresh panel still displayed the rolled-back snow stack).
  setState({ ...RESULT_FIELDS, phase: 'idle', message: `rolled back ${undone} edit(s) — your comp is back where it started.`, canAccept: false, canRollback: false });
}

function handleAccept() {
  logDecision('keep');
  const n = session?.appliedReports?.length || 0;
  session = null; saveSession();
  setState({ ...RESULT_FIELDS, phase: 'idle', message: n ? `kept ${n} edit(s).` : 'kept.', canAccept: false, canRollback: false });
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
    // A budget refusal is not a crash. Naming it as one sends the artist to the logs looking for a
    // bug, when the answer is a number they chose and can change in one command.
    const msg = /BudgetExceeded/.test(e?.name || '')
      ? `${e.message}`
      : `kernel error: ${String(e).slice(0, 300)}`;
    setState({ phase: /BudgetExceeded/.test(e?.name || '') ? 'budget' : 'error', message: msg });
  } finally {
    endRequest();
    busy = false;
  }
}

// A fresh start must not present a STALE RESULT as if it were current. setState merges, so the
// previous run's frame, rationale, score and "what it changed" survived every restart — the panel
// opened showing a finished job nobody had just run, with Keep it / Roll back live against a session
// that no longer existed. Clear the result fields explicitly (RESULT_FIELDS, defined above handleRun
// — every request start clears them too); only a resumable session re-populates.
session = loadSession();
if (session) {
  setState({ ...RESULT_FIELDS, phase: 'review', message: `resumed — ${session.appliedReports.length} edit(s) from "${session.intent}" are still applied and not yet accepted.`, canAccept: true, canRollback: true, intent: session.intent });
} else {
  setState({ ...RESULT_FIELDS, phase: 'idle', message: 'ready', canAccept: false, canRollback: false });
}
// The dashboard is part of the shell, not a separate thing to remember to start. It is loopback-only
// and costs nothing when nobody has the page open.
if (!ONCE) {
  const dashUrl = await startDashboard(Number(arg('dashboard-port', 7867)));
  if (dashUrl) { console.log(`dashboard: ${dashUrl}`); setState({ dashboard: dashUrl }); }
}

console.log(`kernel up — watching ${REQ}`);
const cfg = activeConfig();
console.log(`  provider=${cfg.provider || 'NONE'}  model=${MODEL || cfg.model || '(none)'}  key from=${cfg.keySource}`);
console.log(`  max-iters=${MAX_ITERS}  accept-bar=${ACCEPT_BAR}`);
if (!cfg.provider) console.error('  ⚠ no credential found — every request will fail at planning. node shell/keys.mjs status');
// Put it where the artist can see it too, not just in a terminal they may never look at.
setState({ engine: `${cfg.provider || 'none'} · ${MODEL || cfg.model || 'none'}` });
// A supervisor (the Electron window) sets AE_AI_ORPHAN_EXIT when it spawns this kernel: exit when
// the parent goes away. Signal handlers in the supervisor are NOT a substitute — a SIGTERM to
// Electron killed it before its Node-level handlers ran (measured live, first Electron run), and a
// crash never runs them. An orphaned process's ppid flips to the reaper (1 on macOS), which is a
// fact this side can poll. A standalone kernel (shell_up.sh, a terminal) never sets the flag.
if (process.env.AE_AI_ORPHAN_EXIT) {
  const supervisor = process.ppid;
  setInterval(() => {
    if (process.ppid !== supervisor) {
      console.log(`supervisor (pid ${supervisor}) is gone — exiting so no second kernel races the request file`);
      process.exit(0);
    }
  }, 2000).unref();
}
if (ONCE) { await poll(); process.exit(0); }
setInterval(poll, 800);
