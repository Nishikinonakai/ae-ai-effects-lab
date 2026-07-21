// ae-ai-panel.jsx — the THIN CLIENT of PRD §七: an AE panel that only talks.
//
// Everything that thinks lives outside AE (shell/kernel.mjs): the LLM planning call, the essence
// index, the visual scorer, the convergence loop. None of it can run in AE's scripting engine, and
// none of it needs to. This panel renders whatever state.json says and decides nothing itself, so
// the product's behaviour can change entirely without reinstalling anything into AE.
//
// DOCKABLE. AE hands a Panel object as `this` when the script lives in the ScriptUI Panels folder
// and is opened from the Window menu — build into that and the panel docks like any native one.
// Launched any other way (DoScriptFile, the ESTK) `this` is not a Panel and we fall back to a
// floating palette. Same code path either way; only the container differs. A floating-only tool is
// a demo, not something an artist leaves open next to the timeline.
//
// ScriptUI, not UXP, per §七: UXP restricts access to third-party effect params (Particular's 7657)
// and arbitrary ExtendScript, which is most of what this product does.
//
// EVERYTHING HERE IS ES3. No toISOString, no Array.map/filter/forEach, no JSON.stringify, no const.
// The engine silently swallows exceptions thrown inside event handlers, so a modern-JS slip becomes
// a button that does nothing — which is exactly how the first live click failed.
//
// 2026-07-21 rework, from the artist actually using it (Datte adversarial session):
//   · the panel forced a minimum width and clipped when docked narrow → wide rows split up; the
//     spend/engine line gets a row of its own instead of shouldering into the options row
//   · long messages ("Needs you first" rationales) were cut off by fixed-height statictexts →
//     text height now follows content (CJK-aware estimate), so the whole sentence is readable
//   · every read-only surface was a WHITE edittext, and wheel-scrolling one dragged up a blank
//     white viewport that covered the text → "what it changed" and the log are now plain
//     statictext: dark-theme native, nothing to scroll, nothing to flash. The only edittext left
//     is the input box, which has to be one.
//   · waiting was shapeless ("is it iterating? how long?") → the status line now carries a live
//     elapsed clock while the kernel is busy, next to the pass counter it already showed
//
// Channel: ~/Documents/ae-ai-shell/{request.json,state.json} — separate from the MCP bridge, which
// is the kernel's own hands. Sharing one channel would deadlock the two.
//
// install: shell/shell_up.sh copies this into the ScriptUI Panels folder; then Window → ae-ai-panel

(function (thisObj) {
  var SHELL_DIR = Folder.myDocuments.fsName + "/ae-ai-shell";
  var REQ = SHELL_DIR + "/request.json";
  var STATE = SHELL_DIR + "/state.json";
  // The headless bridge (the kernel's hands — now windowless) writes a heartbeat file every couple
  // of seconds; its age is the cheapest possible "is the bridge alive" signal, and showing it here
  // is what let the floating MCP palette disappear without losing the one thing it told anyone.
  var BRIDGE_HEART = Folder.myDocuments.fsName + "/ae-mcp-bridge/bridge_heartbeat.json";
  var POLL_SEC = 1.0;

  var dir = new Folder(SHELL_DIR);
  if (!dir.exists) dir.create();

  // ---------- window / panel ----------
  var win = (thisObj instanceof Panel)
    ? thisObj
    : new Window("palette", "AE AI — effects assistant", undefined, { resizeable: true });
  win.orientation = "column";
  win.alignChildren = ["fill", "top"];
  win.spacing = 6;
  win.margins = 10;

  var promptGroup = win.add("group");
  promptGroup.orientation = "column";
  promptGroup.alignChildren = ["fill", "top"];
  promptGroup.spacing = 3;
  promptGroup.add("statictext", undefined, "What do you want?");
  var input = promptGroup.add("edittext", undefined, "", { multiline: true });
  input.preferredSize.height = 52;
  // Do not let the input's default width become the panel's floor.
  input.minimumSize.width = 120;

  // Buttons on one row, the layer checkbox on its own — three-abreast was one of the two rows that
  // set the panel's minimum width, and the checkbox label was the first thing to get clipped.
  var rowRun = win.add("group");
  rowRun.alignment = ["fill", "top"];
  var runBtn = rowRun.add("button", undefined, "Make it");
  var stopBtn = rowRun.add("button", undefined, "Stop");
  stopBtn.enabled = false;
  var layerChk = win.add("checkbox", undefined, "only the selected layer");
  layerChk.value = true;

  var statusText = win.add("statictext", undefined, "connecting…", { truncate: "middle" });
  statusText.alignment = ["fill", "top"];
  statusText.preferredSize.width = 180;
  var rationale = win.add("statictext", undefined, "", { multiline: true });
  rationale.alignment = ["fill", "top"];
  rationale.preferredSize.width = 180;

  // The preview must not dictate the panel's width — and an `image` control always did, because it
  // draws at native pixel size: the kernel's thumbnail is rendered for whatever width the panel had
  // at REQUEST time, so after narrowing the dock the previous thumbnail held the old width as a
  // hard floor until the next run replaced it (measured live: a 240px window refused to go below
  // ~500px while showing a 470px frame). A customview with its own onDraw scales the bitmap down
  // to whatever box the layout actually gives it, so no thumbnail can ever be a width floor again.
  var previewPanel = win.add("panel", undefined, "preview");
  previewPanel.alignment = ["fill", "fill"];
  previewPanel.alignChildren = ["fill", "fill"];
  previewPanel.margins = 5;
  previewPanel.minimumSize.height = 90;
  var preview = previewPanel.add("customview", undefined);
  preview.alignment = ["fill", "fill"];
  preview.preferredSize = [180, 100];
  preview.previewImage = null;
  preview.onDraw = function () {
    try {
      var g = this.graphics;
      if (!this.previewImage) return;
      var isz = this.previewImage.size, iw = isz[0], ih = isz[1];
      var cw = this.size.width, chh = this.size.height;
      if (!iw || !ih || !cw || !chh) return;
      var k = cw / iw; if (chh / ih < k) k = chh / ih;
      if (k > 1) k = 1;                      // never upscale — a soft blow-up reads as a render bug
      var w = Math.floor(iw * k), h = Math.floor(ih * k);
      g.drawImage(this.previewImage, Math.floor((cw - w) / 2), Math.floor((chh - h) / 2), w, h);
    } catch (eDraw) { /* a failed paint must not kill the tick */ }
  };

  // WHAT IT CHANGED — the handover surface, and the reason this is not just a progress bar.
  // PRD §11.6: the product's value is getting the STRUCTURE right and handing over, not converging
  // to a 9. An artist who can see "it added Particular with a disc emitter and moved these four
  // levers" can take it from there in ninety seconds. One that only sees "7/10" cannot.
  // statictext, not edittext: the white scrolling box hid more than it showed (wheel over it raised
  // a blank white viewport across the text). Height follows content instead of scrolling.
  var changedPanel = win.add("panel", undefined, "what it changed");
  changedPanel.alignment = ["fill", "top"];
  changedPanel.alignChildren = ["fill", "top"];
  changedPanel.margins = 5;
  var changedList = changedPanel.add("statictext", undefined, "", { multiline: true });
  changedList.alignment = ["fill", "top"];
  changedList.preferredSize.width = 180;

  var rowDecide = win.add("group");
  rowDecide.alignment = ["fill", "top"];
  var acceptBtn = rowDecide.add("button", undefined, "Keep it");
  var rollbackBtn = rowDecide.add("button", undefined, "Roll back");
  acceptBtn.enabled = false;
  rollbackBtn.enabled = false;

  var rowOpts = win.add("group");
  rowOpts.alignment = ["fill", "top"];
  rowOpts.add("statictext", undefined, "passes");
  var itersInput = rowOpts.add("edittext", undefined, "3");
  itersInput.preferredSize.width = 34;
  rowOpts.add("statictext", undefined, "accept at");
  var barInput = rowOpts.add("edittext", undefined, "8");
  barInput.preferredSize.width = 34;
  var clearBtn = rowOpts.add("button", undefined, "clear log");
  // Cost, visible without being asked for — on its own row, because the engine+spend string is the
  // longest line in the panel and sharing the options row made it the width floor.
  var spendText = win.add("statictext", undefined, "", { truncate: "middle" });
  spendText.alignment = ["fill", "top"];
  spendText.preferredSize.width = 180;

  // The log keeps the last few events, newest first, as theme-native statictext. The full history
  // is in the kernel's own terminal/log; the panel's job is "what just happened", not archaeology.
  var LOG_KEEP = 6;
  var logText = win.add("statictext", undefined, "", { multiline: true });
  logText.alignment = ["fill", "bottom"];
  logText.preferredSize.width = 180;
  logText.preferredSize.height = 86;

  // ---------- io ----------
  function esc(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, " ").replace(/\n/g, " ").replace(/\t/g, " ");
  }
  // ExtendScript is ES3: Date.prototype.toISOString DOES NOT EXIST. Calling it threw inside the
  // click handler, ScriptUI swallowed the exception, and the button became a silent no-op — the
  // single worst failure mode this panel has, and invisible to every test that did not click it.
  function isoNow() {
    var d = new Date();
    function p(n, w) { var s = String(n); while (s.length < (w || 2)) s = "0" + s; return s; }
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
      "T" + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + "Z";
  }
  function toJSON(o) {
    var parts = [], k, v;
    for (k in o) {
      if (!o.hasOwnProperty(k)) continue;
      v = o[k];
      if (v === null || v === undefined) parts.push('"' + k + '":null');
      else if (typeof v === "number") parts.push('"' + k + '":' + v);
      else if (typeof v === "boolean") parts.push('"' + k + '":' + (v ? "true" : "false"));
      else parts.push('"' + k + '":"' + esc(v) + '"');
    }
    return "{" + parts.join(",") + "}";
  }

  // Never fail silently. A button that does nothing when clicked is the worst outcome this panel can
  // produce: the artist cannot tell a broken product from a slow one, and there is no thread to pull.
  function writeRequest(obj) {
    try {
      obj.status = "pending";
      obj.ts = isoNow();
      var payload = toJSON(obj);
      var f = new File(REQ);
      f.encoding = "UTF-8";
      if (!f.open("w")) throw new Error("could not open " + REQ + " for writing");
      f.write(payload);
      f.close();
      log("sent: " + obj.action);
      return true;
    } catch (e) {
      log("COULD NOT SEND: " + e.toString());
      statusText.text = "could not reach the kernel — see the log";
      return false;
    }
  }

  function readState() {
    var f = new File(STATE);
    if (!f.exists) return null;
    try {
      f.open("r");
      var txt = f.read();
      f.close();
      if (!txt) return null;
      return (typeof JSON !== "undefined" && JSON.parse) ? JSON.parse(txt) : eval("(" + txt + ")");
    } catch (e) { return null; }
  }

  var logLines = [];
  function log(msg) {
    var t = new Date().toLocaleTimeString();
    logLines.unshift(t + "  " + msg);
    if (logLines.length > LOG_KEEP) logLines.length = LOG_KEEP;
    logText.text = logLines.join("\n");
  }

  function intFrom(field, dflt, lo, hi) {
    var n = parseInt(field.text, 10);
    if (isNaN(n) || n < lo || n > hi) { field.text = String(dflt); return dflt; }
    return n;
  }

  // ---------- ui update ----------
  // Height-to-fit for a multiline statictext: the fixed 30px rationale cut "Needs you first"
  // explanations mid-sentence, and the only place the full text survived was a scrolling white box
  // nobody could read either. Estimate wrapped lines from the laid-out width; CJK glyphs run about
  // twice the advance of latin in the UI font, so they count double. An estimate, not typography —
  // clamped so a wild guess cannot blow the layout apart.
  function fitHeight(ctrl, text, minH, maxH) {
    var w = 280;
    try { if (win.size && win.size.width && win.size.width > 60) w = win.size.width - 34; } catch (e) {}
    if (w < 120) w = 120;
    var units = 0, i, c;
    for (i = 0; i < text.length; i++) { c = text.charCodeAt(i); units += (c > 0x2E80) ? 2 : 1; }
    var perLine = Math.floor(w / 6.5);
    if (perLine < 12) perLine = 12;
    var lines = Math.ceil(units / perLine) + (text.split("\n").length - 1);
    if (lines < 1) lines = 1;
    var h = lines * 15 + 4;
    if (h < minH) h = minH;
    if (h > maxH) h = maxH;
    ctrl.preferredSize.height = h;
    ctrl.minimumSize.height = h;
  }

  function fmtElapsed(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + "s";
    return Math.floor(s / 60) + "m" + (s % 60 < 10 ? "0" : "") + (s % 60) + "s";
  }

  var lastMessage = "", lastFrame = "", lastChanged = "", lastRationale = "";
  var busySince = 0;   // wall-clock anchor for the elapsed display; 0 = not busy
  function applyState(s) {
    if (!s) { statusText.text = "kernel not running — start it with: node shell/kernel.mjs"; return; }

    var phase = s.phase || "idle";
    var busy = (phase === "perceiving" || phase === "planning" || phase === "applying" || phase === "rolling-back");
    // "cancelling" is not in `busy` because Stop must go dead the moment it is pressed — but that
    // left Make it LIVE during the wind-down, so a second click could start a new request while the
    // old one was still undoing its edits, against a comp mid-rollback. Cancelling is a state where
    // NEITHER button should accept input: the run is not finished, and stopping it again is a no-op.
    var cancelling = (phase === "cancelling");
    runBtn.enabled = !busy && !cancelling;
    stopBtn.enabled = busy;
    acceptBtn.enabled = !!s.canAccept;
    rollbackBtn.enabled = !!s.canRollback;

    // The elapsed clock answers "is it doing anything and for how long" — the wait between passes
    // is a minute-plus of rendering and scoring, and a motionless line reads as a hang. Anchored to
    // when THIS panel first saw the busy state; survives nothing and needs to survive nothing.
    if (busy) { if (!busySince) busySince = new Date().getTime(); }
    else busySince = 0;

    var head = phaseLabel(phase);
    if (phase === "review" && s.score !== undefined && s.score !== null) head += "  ·  " + s.score + "/10";
    if (busy && s.pass) head += "  ·  pass " + s.pass;
    if (busy && busySince) head += "  ·  " + fmtElapsed(new Date().getTime() - busySince);
    statusText.text = head;

    // Which engine is actually answering. "I thought it was using X" was a real defect, not a
    // hypothetical — the scorer moved provider while the planners did not, and nothing showed it.
    // Plus the bridge heartbeat: AE-open-but-deaf and bridge-alive look identical otherwise.
    if (s.spend || s.engine) {
      var bridgeMark = "";
      try {
        var hf = new File(BRIDGE_HEART);
        bridgeMark = (hf.exists && (new Date().getTime() - hf.modified.getTime()) < 6000) ? "  ·  bridge ✓" : "  ·  bridge ✗";
      } catch (eH) { bridgeMark = ""; }
      spendText.text = (s.engine ? s.engine + "  ·  " : "") + (s.spend || "") + bridgeMark;
    }
    // Explicit clears matter as much as sets: on a fresh kernel these come back null, and treating
    // null as "no update" is what made a stale result look like a live one.
    if (s.rationale !== undefined) {
      var rt = s.rationale || "";
      if (rt !== lastRationale) { rationale.text = rt; fitHeight(rationale, rt, 14, 128); lastRationale = rt; }
    }
    if (s.message && s.message !== lastMessage) { log(s.message); lastMessage = s.message; }

    // Height cap 120, not 180: a long change list used to grow the panel past the dock's height and
    // push the spend line and log clean out of view (seen live after the two-layer snow plan).
    // Bottom lines that exist but cannot be seen are worse than a truncated list the log completes.
    var ch = s.changed || "";
    if (ch !== lastChanged) { changedList.text = ch; fitHeight(changedList, ch, 14, 120); lastChanged = ch; }

    // The frame is the product's actual output — show it, and only reload when the path changes
    // (re-reading a PNG every second would make the panel crawl). Repaint must be asked for
    // explicitly: onDraw fires on layout/expose, not on property assignment.
    if (s.frame && s.frame !== lastFrame) {
      var img = new File(s.frame);
      if (img.exists) {
        try {
          preview.previewImage = ScriptUI.newImage(img.fsName);
          lastFrame = s.frame;
          try { preview.notify("onDraw"); } catch (eN) {}
        } catch (e) { log("could not show the frame: " + e.toString()); }
      }
    } else if (!s.frame && lastFrame) {
      preview.previewImage = null;
      lastFrame = "";
      try { preview.notify("onDraw"); } catch (eN2) {}
    }
    try { win.layout.layout(true); } catch (e3) {}
  }

  function phaseLabel(p) {
    if (p === "idle") return "Ready";
    if (p === "perceiving") return "Reading your comp…";
    if (p === "planning") return "Thinking…";
    if (p === "applying") return "Making it and looking at the result…";
    if (p === "review") return "Have a look";
    if (p === "handoff") return "Needs you first";
    if (p === "rolling-back") return "Undoing…";
    if (p === "cancelling") return "Stopping…";
    if (p === "cancelled") return "Stopped";
    if (p === "budget") return "Budget reached — nothing was run";
    if (p === "error") return "Something went wrong";
    return p;
  }

  // ---------- actions ----------
  runBtn.onClick = function () {
    try { runClicked(); }
    catch (e) { log("panel error in Make it: " + e.toString()); statusText.text = "panel error — see the log"; }
  };
  function runClicked() {
    log("Make it clicked");          // first line, so "did the click register at all" is never in doubt
    var text = input.text;
    if (!text || !text.replace(/\s/g, "")) { log("type what you want first"); return; }
    var layerIdx = 0;
    if (layerChk.value) {
      try {
        var comp = app.project.activeItem;
        if (comp && comp instanceof CompItem) {
          var sel = comp.selectedLayers;
          if (sel && sel.length > 0) layerIdx = sel[0].index;
        }
      } catch (e) {}
      if (!layerIdx) log("no layer selected — letting it choose");
    }
    var w = 0;
    try { w = win.size ? win.size.width : 0; } catch (eW) {}
    if (writeRequest({
      action: "run", intent: text, layer: layerIdx,
      maxIters: intFrom(itersInput, 3, 1, 8),
      acceptBar: intFrom(barInput, 8, 1, 10),
      panelWidth: w                                  // so the next preview is rendered to fit
    })) log("asked for: " + text);
  }

  // STOP. A tune is minutes of rendering and paid scoring; without this the only way out is killing
  // the kernel, which strands the session and loses the rollback stack.
  stopBtn.onClick = function () {
    try {
      log("stop requested");
      stopBtn.enabled = false;
      writeRequest({ action: "cancel" });
    } catch (e) { log("panel error in Stop: " + e.toString()); }
  };

  acceptBtn.onClick = function () {
    try { writeRequest({ action: "accept" }); acceptBtn.enabled = false; rollbackBtn.enabled = false; }
    catch (e) { log("panel error in Keep it: " + e.toString()); }
  };
  rollbackBtn.onClick = function () {
    try { writeRequest({ action: "rollback" }); acceptBtn.enabled = false; rollbackBtn.enabled = false; }
    catch (e) { log("panel error in Roll back: " + e.toString()); }
  };
  clearBtn.onClick = function () { logLines = []; logText.text = ""; };

  // ---------- poll ----------
  // ScriptUI has no event loop of its own, so app.scheduleTask against a named global is the only
  // way to keep a repeating task addressable. The whole tick is wrapped: one bad state.json must not
  // kill the panel, because a dead tick looks identical to a hung kernel.
  $.global.__aeAiPanelTick = function () {
    try { applyState(readState()); }
    catch (e) { try { statusText.text = "panel error: " + e.toString(); } catch (e2) {} }
  };
  app.scheduleTask("__aeAiPanelTick()", POLL_SEC * 1000, true);

  try { applyState(readState()); } catch (e) {}

  // A docked panel gets resized by dragging its edge; without this the children keep their first
  // layout and the panel looks broken at any other width.
  win.onResizing = win.onResize = function () { try { win.layout.resize(); } catch (eR) {} };

  if (win instanceof Window) { win.center(); win.show(); }
  else { win.layout.layout(true); win.layout.resize(); }
})(this);
