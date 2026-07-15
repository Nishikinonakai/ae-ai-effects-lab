// recipe_runner.mjs — declarative Trapcode recipe runner for the AE MCP bridge.
//
// Reads a recipe JSON, compiles it into an idempotent ExtendScript program, sends it
// through the file bridge (~/Documents/ae-mcp-bridge), waits for completion, then polls
// for the rendered frame PNGs. Prints a structured report: per-param ok/fail + frame paths.
//
// usage: node recipe_runner.mjs <recipe.json> [--timeout=180] [--outdir=<dir>]
// module: import { runRecipe } from './recipe_runner.mjs'   (tune_loop.mjs drives it per-iteration)
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, '..');
const BRIDGE = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
const CMD = path.join(BRIDGE, 'ae_command.json');
const RES = path.join(BRIDGE, 'ae_mcp_result.json');

// ---- ExtendScript interpreter (generic; recipe injected as a literal) ----
// Builds its JSON report string MANUALLY (AE 2022 ExtendScript has no guaranteed JSON.stringify).
const AEX = String.raw`(function () {
  var R = __RECIPE__;
  var parts = [];
  var frames = [];
  var esc = function (s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\"'); };

  function findLayer(comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
    return null;
  }

  try {
    // headless insurance: suppress AE-raised modal dialogs (plugin-native dialogs may still
    // appear — recipes must avoid known triggers, e.g. wind with Air Resistance 0)
    try { app.beginSuppressDialogs(); } catch (eSup) {}
    app.beginUndoGroup("Recipe: " + R.name);

    // 1) find-or-create comp (idempotent — no duplicate comps on re-run)
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.name === R.compName) { comp = it; break; }
    }
    if (!comp) comp = app.project.items.addComp(R.compName, R.comp.width, R.comp.height, 1, R.comp.duration, R.comp.fps);
    comp.openInViewer();

    // 2) find-or-create BG solid (Particular renders on transparency; needs a backing)
    if (R.background) {
      var bg = findLayer(comp, "BG");
      if (!bg) bg = comp.layers.addSolid(R.background, "BG", R.comp.width, R.comp.height, 1, R.comp.duration);
      else bg.property("Source Text"); // no-op guard
      bg.moveToEnd();
    }

    // 3) host layer: find (idempotent re-run) | clone from a curve-library master | new solid.
    // Masters carry CUSTOM_VALUE state (over-life curves, gradients) that setValue cannot
    // reach — layer copy is a full-state transfer, so curves ride along; the recipe's params
    // pass then overrides the scriptable values on the clone.
    var hostName = R.hostName || "Host";
    var host = findLayer(comp, hostName);
    if (!host) {
      if (R.master) {
        var mcomp = null;
        for (var mi = 1; mi <= app.project.numItems; mi++) {
          var mit = app.project.item(mi);
          if (mit instanceof CompItem && mit.name === R.master.comp) { mcomp = mit; break; }
        }
        if (!mcomp) {
          app.project.importFile(new ImportOptions(new File(R.master.library)));
          for (var mj = 1; mj <= app.project.numItems; mj++) {
            var mjt = app.project.item(mj);
            if (mjt instanceof CompItem && mjt.name === R.master.comp) { mcomp = mjt; break; }
          }
        }
        if (!mcomp) throw new Error("master comp not found after import: " + R.master.comp);
        mcomp.layer(R.master.layer || 1).copyToComp(comp);
        host = comp.layer(1);            // copyToComp lands on top
        host.name = hostName;
        host.startTime = 0;
        parts.push('{"p":"[master] clone ' + esc(R.master.comp) + '","ok":true}');
      } else {
        host = comp.layers.addSolid([0,0,0], hostName, R.comp.width, R.comp.height, 1, R.comp.duration);
      }
      // .ffx presets apply ONCE, on the freshly created host only — re-applying on a
      // found host would stack duplicate effects (idempotency).
      if (R.presets) {
        for (var pi = 0; pi < R.presets.length; pi++) {
          try {
            var pf = new File(R.presets[pi]);
            if (!pf.exists) throw new Error("file missing");
            host.applyPreset(pf);
            parts.push('{"p":"[preset] ' + esc(R.presets[pi]) + '","ok":true}');
          } catch (pe) {
            parts.push('{"p":"[preset] ' + esc(R.presets[pi]) + '","ok":false,"err":"' + esc(String(pe).substring(0,70)) + '"}');
          }
        }
      }
    }

    // 4) find-or-apply the effect STACK in order (multi-effect plans: form + color + glow ...)
    for (var s = 0; s < R.effects.length; s++) {
      var spec = R.effects[s];
      var fx = null;
      for (var fi = 1; fi <= host.Effects.numProperties; fi++) {
        try { if (host.Effects.property(fi).matchName === spec.matchName) { fx = host.Effects.property(fi); break; } } catch (e) {}
      }
      if (!fx) fx = host.Effects.addProperty(spec.matchName);
      var tag = "[" + (s + 1) + ":" + spec.matchName + "] ";

      // params — per-param try/catch + readback (batch-set dies silently on first hidden param)
      if (spec.params) {
        for (var k = 0; k < spec.params.length; k++) {
          var pr = spec.params[k];            // [matchName, value, label]
          var mn = pr[0], val = pr[1], lbl = tag + (pr[2] || pr[0]);
          try {
            fx.property(mn).setValue(val);
            var rb = String(fx.property(mn).value).substring(0, 24);
            parts.push('{"p":"' + esc(lbl) + '","ok":true,"v":"' + esc(rb) + '"}');
          } catch (e) {
            parts.push('{"p":"' + esc(lbl) + '","ok":false,"err":"' + esc(String(e).substring(0,70)) + '"}');
          }
        }
      }

      // expressions (the only route to procedural motion; curves still need .ffx)
      if (spec.expressions) {
        for (var x = 0; x < spec.expressions.length; x++) {
          var ex = spec.expressions[x];       // [matchName, exprString, label]
          var emn = ex[0], estr = ex[1], elbl = tag + (ex[2] || ex[0]) + " (expr)";
          try {
            fx.property(emn).expression = estr;
            parts.push('{"p":"' + esc(elbl) + '","ok":true}');
          } catch (e) {
            parts.push('{"p":"' + esc(elbl) + '","ok":false,"err":"' + esc(String(e).substring(0,70)) + '"}');
          }
        }
      }
    }

    // 7) camera rig (Particular auto-uses the comp camera). Remove old, add fresh.
    for (var L = comp.numLayers; L >= 1; L--) if (comp.layer(L) instanceof CameraLayer) comp.layer(L).remove();
    if (R.camera) {
      var cam = comp.layers.addCamera(R.name + " Cam", [R.comp.width/2, R.comp.height/2]);
      cam.position.setValue(R.camera.position);
      cam.pointOfInterest.setValue(R.camera.pointOfInterest);
      if (R.camera.zoom) cam.property("Zoom").setValue(R.camera.zoom);
    }

    app.endUndoGroup();

    // 8) render frames (saveFrameToPng is async; driver polls for the files)
    for (var f = 0; f < R.renderFrames.length; f++) {
      var t = R.renderFrames[f];
      var fp = R._outDir + "/" + R.name + "_t" + String(t).replace(".", "p") + ".png";
      comp.saveFrameToPng(t, new File(fp));
      frames.push('"' + esc(fp) + '"');
    }

    try { app.endSuppressDialogs(false); } catch (eSup2) {}
    return '{"status":"done","name":"' + esc(R.name) + '","params":[' + parts.join(",") + '],"frames":[' + frames.join(",") + ']}';
  } catch (e) {
    try { app.endUndoGroup(); } catch (e2) {}
    try { app.endSuppressDialogs(false); } catch (eSup3) {}
    return '{"status":"error","name":"' + esc(R.name) + '","message":"' + esc(String(e)) + '","params":[' + parts.join(",") + ']}';
  }
})();`;

// Run one recipe/plan object through the bridge. Returns { report, frames } where
// frames = [{ path, ready }]. Throws on bridge timeout; a recipe-level error comes back
// as report.status === 'error' (caller decides how to die).
export async function runRecipe(recipeInput, opts = {}) {
  const recipe = JSON.parse(JSON.stringify(recipeInput)); // recipes are pure JSON; deep copy

  // normalize: legacy single `effect` + top-level params/expressions -> one-element stack.
  // Real-world plans are almost always effect STACKS (e.g. Fractal Noise for form + Tint
  // for color), so `effects: [{matchName, params, expressions}, ...]` is the primary schema.
  if (!recipe.effects) {
    recipe.effects = [{
      matchName: recipe.effect,
      params: recipe.params || [],
      expressions: recipe.expressions || [],
    }];
  }

  const outDir = opts.outDir || path.join(REPO, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  recipe._outDir = outDir;
  const timeoutSec = opts.timeoutSec || 180;

  // resolve library/preset paths relative to the harness root, so recipes stay portable
  if (recipe.master?.library && !path.isAbsolute(recipe.master.library))
    recipe.master.library = path.join(REPO, recipe.master.library);
  if (recipe.presets)
    recipe.presets = recipe.presets.map(p => (path.isAbsolute(p) ? p : path.join(REPO, p)));

  const script = AEX.replace('__RECIPE__', JSON.stringify(recipe));

  // ---- send through the bridge ----
  if (!fs.existsSync(BRIDGE)) fs.mkdirSync(BRIDGE, { recursive: true });
  fs.writeFileSync(RES, JSON.stringify({ status: 'waiting' }));
  fs.writeFileSync(CMD, JSON.stringify({
    command: 'runScript',
    args: { script },
    timestamp: new Date().toISOString(),
    status: 'pending',
  }, null, 2));

  const deadline = Date.now() + timeoutSec * 1000;
  let report = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const cmd = JSON.parse(fs.readFileSync(CMD, 'utf8'));
      if (cmd.status === 'completed' || cmd.status === 'error') {
        report = JSON.parse(fs.readFileSync(RES, 'utf8'));
        break;
      }
    } catch { /* mid-write */ }
  }
  if (!report) throw new Error('timed out waiting for AE bridge (is the panel open with Auto-run ON?)');

  // ---- poll for async frame files ----
  const frames = report.frames || [];
  const frameDeadline = Date.now() + (opts.frameTimeoutMs || 30000);
  const ready = new Set();
  while (ready.size < frames.length && Date.now() < frameDeadline) {
    await new Promise(r => setTimeout(r, 1000));
    for (const fp of frames) if (!ready.has(fp) && fs.existsSync(fp) && fs.statSync(fp).size > 0) ready.add(fp);
  }

  return { report, frames: frames.map(fp => ({ path: fp, ready: ready.has(fp) })) };
}

export function fmtParams(params) {
  return params.map(p => p.ok
    ? `  ✓ ${p.p}${p.v !== undefined ? ' = ' + p.v : ''}`
    : `  ✗ ${p.p}  — ${p.err}`).join('\n');
}

// ---- CLI ----
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const recipePath = process.argv[2];
  if (!recipePath) { console.error('usage: node recipe_runner.mjs <recipe.json> [--timeout=180] [--outdir=<dir>]'); process.exit(1); }
  const timeoutSec = Number((process.argv.find(a => a.startsWith('--timeout=')) || '').split('=')[1] || 180);
  const outDir = (process.argv.find(a => a.startsWith('--outdir=')) || '').split('=')[1] || undefined;

  const recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
  let out;
  try {
    out = await runRecipe(recipe, { timeoutSec, outDir });
  } catch (e) {
    console.error('ERROR: ' + e.message);
    process.exit(1);
  }
  const { report, frames } = out;
  if (report.status === 'error') {
    console.error('RECIPE ERROR: ' + report.message);
    if (report.params) console.error(fmtParams(report.params));
    process.exit(1);
  }
  console.log('\n=== recipe: ' + report.name + ' ===');
  console.log(fmtParams(report.params));
  const okCount = report.params.filter(p => p.ok).length;
  console.log(`\nparams: ${okCount}/${report.params.length} ok`);
  console.log('frames:');
  for (const f of frames) console.log(`  ${f.ready ? '✓' : '✗ (not written)'} ${f.path}`);
}
