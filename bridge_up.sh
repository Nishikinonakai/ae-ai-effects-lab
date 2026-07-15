#!/bin/bash
# bridge_up.sh — zero-manual-step session bootstrap for the AE MCP bridge.
#
# Discovered 2026-07-15: mcp-bridge-auto.jsx is a plain `new Window("palette")`, so it can
# be launched via AppleScript DoScriptFile — no Window-menu click needed. Auto-run defaults
# to ON in the panel source. This replaces the old "open AE → Window → mcp-bridge-auto.jsx →
# check Auto-run" manual ritual entirely.
#
# usage: ./bridge_up.sh   (idempotent; safe to re-run)
set -e
AE_APP="Adobe After Effects 2022"
PANEL="/Applications/Adobe After Effects 2022/Scripts/ScriptUI Panels/mcp-bridge-auto.jsx"
BRIDGE_DIR="$HOME/Documents/ae-mcp-bridge"
PING_JSX="$(mktemp -t aeping).jsx"

# 1) launch AE if not running
if ! pgrep -f "After Effects 2022.app/Contents/MacOS/After Effects" > /dev/null; then
  echo "launching $AE_APP ..."
  open -ga "$AE_APP"
fi

# 2) wait for the app process, then give plugins time to load
for i in $(seq 1 60); do
  pgrep -f "After Effects 2022.app/Contents/MacOS/After Effects" > /dev/null && break
  sleep 2
done

# 3) quick liveness ping; if the bridge already answers, we're done
cat > "$PING_JSX" <<'EOF'
(function(){ return '{"status":"alive","ae":"' + app.version + '"}'; })();
EOF
ping_bridge() {
  node "$(dirname "$0")/gap-test/send.mjs" "$PING_JSX" "${1:-20}" 2>/dev/null
}
if out=$(ping_bridge 15); then
  echo "bridge already alive: $out"
  exit 0
fi

# 4) launch the palette via DoScriptFile (retry while AE finishes booting)
for i in $(seq 1 10); do
  if osascript -e "tell application \"$AE_APP\" to DoScriptFile \"$PANEL\"" >/dev/null 2>&1; then
    sleep 5
    if out=$(ping_bridge 20); then
      echo "bridge up: $out"
      exit 0
    fi
  fi
  echo "AE still booting (attempt $i) ..."
  sleep 10
done
echo "FAILED: bridge did not come up — check AE for a blocking dialog" >&2
exit 1
