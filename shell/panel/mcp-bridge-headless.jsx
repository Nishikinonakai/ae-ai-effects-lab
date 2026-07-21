// mcp-bridge-headless.jsx — the AE file bridge with NO window.
//
// The floating "MCP Bridge Auto" palette came from the vendored upstream fork
// (after-effects-mcp/src/scripts/mcp-bridge-auto.jsx). Its UI was never load-bearing: polling
// lives on app.scheduleTask, which persists in the engine with no window at all — proven the
// night we closed the palette and the bridge kept answering. The artist named the window as a
// nuisance (an always-open floater nobody reads, with the same white-scrolling text box the
// ae-ai-panel just shed), so this variant keeps the PROTOCOL and drops the chrome:
//
//   · runScript ONLY. Every tool in this repo drives AE through runScript (see README —
//     "everything else depends on it"); the 18 upstream commands were dead weight here. An
//     unknown command answers with a status:"error" result naming the fact.
//   · same files, same statuses: ae_command.json  pending → running → completed|error, result
//     text written VERBATIM to ae_mcp_result.json (clients JSON.parse it themselves).
//   · log → ae-mcp-bridge/bridge_log.txt (errors and lifecycle only, not every poll).
//   · heartbeat → ae-mcp-bridge/bridge_heartbeat.json every few ticks, so a UI (the ae-ai-panel
//     shows a bridge ✓/✗) can tell "bridge alive" from "AE open but deaf" without a round-trip.
//   · stop remotely:  $.global.__aeBridgeEnabled = false  (one runScript away); relaunching this
//     file refreshes the code but never schedules a second timer.
//
// It also RETIRES a live palette on load: the legacy checkForCommands global is no-op'd (the old
// repeating task then idles forever) and its window is closed if present — so switching is one
// DoScriptFile, no AE restart, no competing pollers double-executing commands.
//
// launch: bridge_up.sh does  DoScriptFile <repo>/shell/panel/mcp-bridge-headless.jsx
// (straight from the repo — nothing to install into root-owned folders.)
(function () {
  var BRIDGE = Folder.myDocuments.fsName + "/ae-mcp-bridge";
  var CMD = BRIDGE + "/ae_command.json";
  var RES = BRIDGE + "/ae_mcp_result.json";
  var HEART = BRIDGE + "/bridge_heartbeat.json";
  var LOG = BRIDGE + "/bridge_log.txt";
  var dir = new Folder(BRIDGE);
  if (!dir.exists) dir.create();

  function readAll(p) {
    var f = new File(p);
    if (!f.exists) return null;
    f.encoding = "UTF-8";
    if (!f.open("r")) return null;
    var s = f.read();
    f.close();
    return s;
  }
  function writeAll(p, s) {
    var f = new File(p);
    f.encoding = "UTF-8";
    if (!f.open("w")) return false;
    f.write(s);
    f.close();
    return true;
  }
  function logLine(msg) {
    try {
      var f = new File(LOG);
      f.encoding = "UTF-8";
      if (f.open("a")) { f.writeln(new Date().toString() + "  " + msg); f.close(); }
    } catch (e) { /* logging must never break the bridge */ }
  }
  function q(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n\t]/g, " ") + '"'; }

  // Rewrite the command file's status. JSON is present in this AE's engine (the palette leaned on
  // it for months); the regex fallback keeps us honest on engines where it is not.
  function setStatus(raw, st) {
    var out = null;
    try {
      if (typeof JSON !== "undefined" && JSON.parse) {
        var o = JSON.parse(raw);
        o.status = st;
        out = JSON.stringify(o, null, 2);
      }
    } catch (eJ) { out = null; }
    if (out === null) out = String(raw).replace(/"status"\s*:\s*"[a-z]+"/, '"status":"' + st + '"');
    writeAll(CMD, out);
  }

  // Retire a legacy palette if one is running: its repeating task evals the STRING
  // "checkForCommands()" against the global scope, so a no-op global starves it for good.
  try { $.global.checkForCommands = function () {}; } catch (eN) {}
  try {
    if ($.global.panel && ($.global.panel instanceof Window) && String($.global.panel.text).indexOf("MCP Bridge") === 0) {
      $.global.panel.close();
      logLine("legacy palette closed and its poller no-op'd");
    }
  } catch (eC) {}

  $.global.__aeBridgeEnabled = true;
  $.global.__aeBridgeBusy = false;   // re-entrancy guard: a long script must not be entered twice
  $.global.__aeBridgeBeats = 0;

  $.global.__aeBridgeTick = function () {
    if (!$.global.__aeBridgeEnabled || $.global.__aeBridgeBusy) return;
    $.global.__aeBridgeBusy = true;
    try {
      $.global.__aeBridgeBeats++;
      if ($.global.__aeBridgeBeats % 4 === 1) writeAll(HEART, '{"alive":true,"ts":' + new Date().getTime() + '}');
      var raw = readAll(CMD);
      if (raw) {
        var cmd = null;
        try { cmd = (typeof JSON !== "undefined" && JSON.parse) ? JSON.parse(raw) : eval("(" + raw + ")"); } catch (eP) { cmd = null; }
        if (cmd && cmd.status === "pending") {
          setStatus(raw, "running");
          var out = "", failed = false;
          if (cmd.command === "runScript") {
            try { out = String(eval(cmd.args && cmd.args.script ? cmd.args.script : "")); }
            catch (eE) { failed = true; out = '{"status":"error","message":' + q(String(eE)) + '}'; logLine("runScript threw: " + String(eE)); }
          } else {
            failed = true;
            out = '{"status":"error","message":"headless bridge supports runScript only; got ' + String(cmd.command).replace(/"/g, "") + '"}';
            logLine("unsupported command: " + String(cmd.command));
          }
          writeAll(RES, out);
          // status LAST: clients poll the command file and read the result only after the flip,
          // so the result must be on disk before the status says it is.
          var raw2 = readAll(CMD);
          setStatus(raw2 !== null ? raw2 : raw, failed ? "error" : "completed");
        }
      }
    } catch (eT) { logLine("tick error: " + String(eT)); }
    $.global.__aeBridgeBusy = false;
  };

  // One timer, ever. Re-running this file (bridge_up.sh is idempotent) refreshes every function
  // above but must not stack a second repeating task next to the first.
  if (!$.global.__aeBridgeScheduled) {
    app.scheduleTask("__aeBridgeTick()", 500, true);
    $.global.__aeBridgeScheduled = true;
    logLine("headless bridge up (500ms poll, runScript only)");
  } else {
    logLine("headless bridge refreshed (timer already scheduled)");
  }
})();
