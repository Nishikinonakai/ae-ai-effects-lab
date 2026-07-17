#!/bin/bash
# bridge_down.sh — hard-stop AE and leave a clean slate for bridge_up.sh.
#
# Lesson from 2026-07-17 (render-hang postmortem): a wedged AE ignores SIGTERM, so a
# plain `pkill` leaves a ZOMBIE instance that races the next one on ae_command.json —
# every subsequent run then "hangs" no matter what the draft contains. Kill -9, VERIFY
# the process table is empty, and reset the bridge queue files before relaunching.
#
# usage: ./bridge_down.sh   (then ./bridge_up.sh)
set -e
BRIDGE_DIR="$HOME/Documents/ae-mcp-bridge"

pkill -9 -f "After Effects 2022.app/Contents/MacOS/After Effects" 2>/dev/null || true
pkill -9 -f "After Effects 2022.app/Contents/MacOS/aerendercore" 2>/dev/null || true
# orphan crash reporters from dead sessions (harmless but they pile up)
pkill -9 -f "After Effects 2022.app/Contents/MacOS/crashpad_handler" 2>/dev/null || true

for i in $(seq 1 15); do
  if ! pgrep -f "After Effects 2022.app/Contents/MacOS/(After Effects|aerendercore)" > /dev/null; then
    # reset queue files so a stale pending/running command can't confuse the next panel
    [ -d "$BRIDGE_DIR" ] && printf '{"status":"idle"}' > "$BRIDGE_DIR/ae_command.json" 2>/dev/null || true
    echo "AE down, bridge queue reset."
    exit 0
  fi
  sleep 1
done
echo "FAILED: AE process still alive after kill -9" >&2
pgrep -fl "After Effects" >&2
exit 1
