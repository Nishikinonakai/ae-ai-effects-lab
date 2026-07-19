#!/bin/bash
# shell_up.sh — bring the whole product shell up in one command.
#
# The lab already scripted the two jobs PRD §七 calls the shell's core responsibilities:
# install/repair the panel, and heal the bridge. This wires them together with the kernel so the
# artist-facing product starts the way a product should — one command, idempotent, safe to re-run.
#
#   1. bridge_up.sh          — AE running + the MCP bridge panel answering (the kernel's hands)
#   2. install the panel     — copy ae-ai-panel.jsx into AE's ScriptUI Panels folder if changed
#   3. launch the panel      — via DoScriptFile, no Window-menu click needed
#   4. start the kernel      — the brain, watching ~/Documents/ae-ai-shell/request.json
#
# usage: ./shell/shell_up.sh [--no-panel]   (--no-panel: kernel only, for headless testing)
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
AE_APP="Adobe After Effects 2022"
PANEL_SRC="$REPO/shell/panel/ae-ai-panel.jsx"
PANEL_DIR="/Applications/$AE_APP/Scripts/ScriptUI Panels"
PANEL_DST="$PANEL_DIR/ae-ai-panel.jsx"
SHELL_DIR="$HOME/Documents/ae-ai-shell"

mkdir -p "$SHELL_DIR"

echo "→ bridge"
"$REPO/bridge_up.sh"

if [ "$1" != "--no-panel" ]; then
  echo "→ panel"
  # The ScriptUI Panels folder is root-owned; only ask for sudo when the file actually differs,
  # so a normal restart never prompts for a password.
  if [ ! -f "$PANEL_DST" ] || ! cmp -s "$PANEL_SRC" "$PANEL_DST"; then
    echo "   installing $(basename "$PANEL_DST") (needs admin — AE's panel folder is root-owned)"
    sudo cp "$PANEL_SRC" "$PANEL_DST"
    sudo chmod 644 "$PANEL_DST"
  else
    echo "   already up to date"
  fi
  osascript -e "tell application \"$AE_APP\" to DoScriptFile \"$PANEL_DST\"" >/dev/null 2>&1 \
    && echo "   panel opened" \
    || echo "   ⚠ could not open the panel automatically — open it from Window → ae-ai-panel.jsx"
fi

echo "→ kernel"
echo "   channel: $SHELL_DIR"
exec node "$REPO/shell/kernel.mjs" "${@:2}"
