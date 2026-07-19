// ae-ai-panel.jsx — the THIN CLIENT of PRD §七: an AE panel that only talks.
//
// Everything that thinks lives outside AE (shell/kernel.mjs): the LLM planning call, the essence
// index, the visual scorer, the convergence loop. None of it can run in AE's scripting engine, and
// none of it needs to. This panel owns exactly four jobs — take a sentence, show progress, show the
// resulting frame, and offer Keep / Roll back. It is deliberately dumb: it renders whatever
// state.json says and never decides anything itself, so the product's behaviour can change entirely
// without reinstalling anything into AE.
//
// ScriptUI, not UXP, per §七: UXP restricts access to third-party effect params (Particular's 7657)
// and arbitrary ExtendScript, which is most of what this product does.
//
// Channel: ~/Documents/ae-ai-shell/{request.json,state.json} — separate from the MCP bridge, which
// is the kernel's own hands. Sharing one channel would deadlock the two.
//
// install: copy to the ScriptUI Panels folder (see shell/install_panel.sh), then Window → ae-ai-panel

(function () {
  var SHELL_DIR = Folder.myDocuments.fsName + "/ae-ai-shell";
  var REQ = SHELL_DIR + "/request.json";
  var STATE = SHELL_DIR + "/state.json";
  var POLL_SEC = 1.0;

  var dir = new Folder(SHELL_DIR);
  if (!dir.exists) dir.create();

  // ---------- window ----------
  var win = new Window("palette", "AE AI — effects assistant", undefined, { resizeable: true });
  win.orientation = "column";
  win.alignChildren = ["fill", "top"];
  win.spacing = 8;
  win.margins = 12;

  var promptGroup = win.add("group");
  promptGroup.orientation = "column";
  promptGroup.alignChildren = ["fill", "top"];
  promptGroup.add("statictext", undefined, "What do you want?");
  var input = promptGroup.add("edittext", undefined, "", { multiline: true });
  input.preferredSize.height = 56;

  var rowRun = win.add("group");
  rowRun.alignment = ["fill", "top"];
  var runBtn = rowRun.add("button", undefined, "Make it");
  var layerChk = rowRun.add("checkbox", undefined, "only the selected layer");
  layerChk.value = true;

  var statusText = win.add("statictext", undefined, "connecting…", { truncate: "middle" });
  statusText.alignment = ["fill", "top"];

  var rationale = win.add("statictext", undefined, "", { multiline: true, truncate: "end" });
  rationale.preferredSize.height = 32;

  var previewPanel = win.add("panel", undefined, "preview");
  previewPanel.alignment = ["fill", "fill"];
  previewPanel.margins = 6;
  var preview = previewPanel.add("image", undefined, undefined);
  preview.preferredSize = [320, 180];
  preview.alignment = ["center", "center"];

  var rowDecide = win.add("group");
  rowDecide.alignment = ["fill", "bottom"];
  var acceptBtn = rowDecide.add("button", undefined, "Keep it");
  var rollbackBtn = rowDecide.add("button", undefined, "Roll back");
  acceptBtn.enabled = false;
  rollbackBtn.enabled = false;

  var logBox = win.add("edittext", undefined, "", { multiline: true, readonly: true, scrolling: true });
  logBox.preferredSize.height = 90;
  logBox.alignment = ["fill", "bottom"];

  // ---------- io ----------
  function writeRequest(obj) {
    obj.status = "pending";
    obj.ts = new Date().toISOString();
    var f = new File(REQ);
    f.encoding = "UTF-8";
    f.open("w");
    f.write(toJSON(obj));
    f.close();
  }

  // ExtendScript has no reliable JSON.stringify; the payloads here are small and flat, and the one
  // field that can contain anything (the artist's own sentence, in any language) is escaped.
  function esc(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, " ").replace(/\n/g, " ").replace(/\t/g, " ");
  }
  function toJSON(o) {
    var parts = [];
    for (var k in o) {
      if (!o.hasOwnProperty(k)) continue;
      var v = o[k];
      if (v === null || v === undefined) parts.push('"' + k + '":null');
      else if (typeof v === "number") parts.push('"' + k + '":' + v);
      else if (typeof v === "boolean") parts.push('"' + k + '":' + (v ? "true" : "false"));
      else parts.push('"' + k + '":"' + esc(v) + '"');
    }
    return "{" + parts.join(",") + "}";
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

  function log(msg) {
    var t = new Date().toLocaleTimeString();
    logBox.text = t + "  " + msg + "\n" + logBox.text;
  }

  // ---------- ui update ----------
  var lastMessage = "", lastFrame = "";
  function applyState(s) {
    if (!s) { statusText.text = "kernel not running — start it with: node shell/kernel.mjs"; return; }

    var phase = s.phase || "idle";
    var busy = (phase === "perceiving" || phase === "planning" || phase === "applying" || phase === "rolling-back");
    runBtn.enabled = !busy;
    acceptBtn.enabled = !!s.canAccept;
    rollbackBtn.enabled = !!s.canRollback;

    statusText.text = phaseLabel(phase) + (s.score !== undefined && s.score !== null && phase === "review" ? "  ·  " + s.score + "/10" : "");
    if (s.rationale && s.rationale !== rationale.text) rationale.text = s.rationale;
    if (s.message && s.message !== lastMessage) { log(s.message); lastMessage = s.message; }

    // The frame is the product's actual output — show it, and only reload when the path changes
    // (re-reading a 4K PNG every second would make the panel crawl).
    if (s.frame && s.frame !== lastFrame) {
      var img = new File(s.frame);
      if (img.exists) {
        try { preview.image = img; lastFrame = s.frame; } catch (e) { log("could not show the frame: " + e.toString()); }
      }
    } else if (!s.frame && lastFrame) {
      try { preview.image = undefined; } catch (e) {}
      lastFrame = "";
    }
    win.layout.layout(true);
  }

  function phaseLabel(p) {
    if (p === "idle") return "Ready";
    if (p === "perceiving") return "Reading your comp…";
    if (p === "planning") return "Thinking…";
    if (p === "applying") return "Making it and looking at the result…";
    if (p === "review") return "Have a look";
    if (p === "handoff") return "Needs you first";
    if (p === "rolling-back") return "Undoing…";
    if (p === "error") return "Something went wrong";
    return p;
  }

  // ---------- actions ----------
  runBtn.onClick = function () {
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
    writeRequest({ action: "run", intent: text, layer: layerIdx });
    log("asked for: " + text);
  };

  acceptBtn.onClick = function () { writeRequest({ action: "accept" }); acceptBtn.enabled = false; rollbackBtn.enabled = false; };
  rollbackBtn.onClick = function () { writeRequest({ action: "rollback" }); acceptBtn.enabled = false; rollbackBtn.enabled = false; };

  // ---------- poll ----------
  // Same mechanism the MCP bridge panel uses: app.scheduleTask against a named global. ScriptUI has
  // no event loop of its own, so a global is the only way to keep a repeating task addressable.
  $.global.__aeAiPanelTick = function () {
    try { applyState(readState()); } catch (e) { statusText.text = "panel error: " + e.toString(); }
  };
  app.scheduleTask("__aeAiPanelTick()", POLL_SEC * 1000, true);

  applyState(readState());
  win.center();
  win.show();
})();
