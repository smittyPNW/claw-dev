#!/bin/zsh

set -euo pipefail

LABEL="com.smittypnw.clawdev.gui"
PID_FILE="${HOME}/.claw-dev/gui.pid"

if [ "$(uname -s)" = "Darwin" ]; then
  launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
else
  if [ -f "${PID_FILE}" ]; then
    kill "$(cat "${PID_FILE}")" >/dev/null 2>&1 || true
    rm -f "${PID_FILE}"
  fi
  pkill -f "dist/guiServer.js" >/dev/null 2>&1 || true
fi

echo "Stopped Claw Dev GUI"
