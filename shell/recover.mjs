// recover.mjs — what the kernel does when a step dies underneath it.
//
// Two recoveries live here, both born from real incidents on 2026-07-20:
//
//   1. BRIDGE REVIVAL. The MCP bridge palette is injected into AE by DoScriptFile, so an AE
//      restart silently kills it — the panel (dockable, auto-loads) survives, the bridge does
//      not. At 21:09 a real panel request then died with "TIMEOUT waiting for AE bridge" and
//      the product just reported an error, even though PRD §七 lists bridge self-healing as a
//      core shell responsibility and bridge_up.sh already knows how to do it. The kernel now
//      recognises that exact failure signature and re-runs bridge_up.sh — which is idempotent,
//      pings first, and only injects the palette into the ALREADY-RUNNING AE.
//      The one thing it must never do from an error path is LAUNCH AE (bridge_up.sh would):
//      requests come from the panel inside AE, so AE being gone means the user quit it — an
//      unattended relaunch of a 4GB app is not recovery, it is a surprise. Hence aeRunning().
//
//   2. EDIT-REPORT SALVAGE. A tune that dies (cancelled, crashed, or its bridge vanished
//      mid-loop) never writes tune_summary.json — that is the last thing it does — so the
//      kernel used to read "no summary" as "nothing happened" while the comp had in fact been
//      edited. The cancel path got a salvage in C.8; the CRASH path did not (§十三's shape,
//      seventh sighting: the same abstraction built on one exit path and missing on the other).
//      apply_edit writes one report PER EDIT as it goes, each carrying its own deterministic
//      inverse, so those files are the real record on every exit path. Collecting them can
//      over-collect an edit the tune itself already rolled back (revert-on-decline) — rolling
//      that back again degrades to recorded skips / restoring values it already holds, which
//      is noisy but converges on the original state. Stranding edits does not.
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

// The literal string every bridge round-trip in this repo prints when the palette never answers
// (apply_edit.mjs, dump_comp.mjs, …). Matching the signature, not the exit code: a non-zero exit
// also means "no comp open", and relaunching the palette cannot fix that.
export function looksLikeBridgeTimeout(text) {
  return /TIMEOUT waiting for AE bridge/.test(String(text || ''));
}

const AE_PROC = 'After Effects 2022.app/Contents/MacOS/After Effects';
export function aeRunning() {
  return spawnSync('pgrep', ['-f', AE_PROC], { encoding: 'utf8' }).status === 0;
}

// Bring the bridge back while AE is running. Resolves { ok } or { ok:false, why } — never throws.
export function reviveBridge(repo) {
  return new Promise(resolve => {
    if (!aeRunning()) {
      resolve({ ok: false, why: "After Effects isn't running — start it (or run ./shell/shell_up.sh), then ask again." });
      return;
    }
    const p = spawn('bash', [path.join(repo, 'bridge_up.sh')], { cwd: repo });
    let out = '', err = '';
    // bridge_up.sh worst case ≈ dead-bridge ping (15s) + 10 DoScriptFile attempts; cap it so a
    // wedged osascript cannot hang the kernel forever.
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* already gone */ } }, 150000);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => {
      clearTimeout(t);
      if (code === 0) resolve({ ok: true, detail: out.trim().split('\n').pop() });
      else resolve({ ok: false, why: 'AE is running but its bridge panel did not come back — check AE for a blocking modal dialog, or run ./bridge_up.sh by hand.' });
    });
  });
}

// Every edit report a tune left in its work dir, in APPLICATION order (mtime), as repo-relative
// paths — the shape session.appliedReports holds. Pure collection; the caller owns the session.
export function collectEditReports(workDir, repo) {
  try {
    return fs.readdirSync(workDir)
      .filter(f => /^edit_.*_report\.json$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(workDir, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t)
      .map(x => path.relative(repo, path.join(workDir, x.f)));
  } catch {
    return [];
  }
}
