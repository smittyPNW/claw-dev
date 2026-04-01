#!/bin/zsh

set -euo pipefail

GUI_URL="${CLAW_GUI_URL:-http://127.0.0.1:${CLAW_GUI_PORT:-4310}}"
LABEL="com.smittypnw.clawdev.gui"

if curl -fsS "${GUI_URL}" >/dev/null 2>&1; then
  echo "running ${GUI_URL}"
else
  echo "stopped ${GUI_URL}"
fi

if [ "$(uname -s)" = "Darwin" ]; then
  launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | sed -n '1,20p' || true
fi
