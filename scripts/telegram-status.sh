#!/bin/zsh

set -euo pipefail

PID_FILE="${HOME}/.claw-dev/telegram.pid"

if [ -f "${PID_FILE}" ]; then
  PID="$(cat "${PID_FILE}")"
  if [ -n "${PID}" ] && kill -0 "${PID}" >/dev/null 2>&1 && ps -o command= -p "${PID}" | grep -E "telegramBot\\.(js|ts)" >/dev/null 2>&1; then
    echo "running pid=${PID}"
    exit 0
  fi
fi

if pgrep -f "telegramBot\\.(js|ts)" >/dev/null 2>&1; then
  echo "running"
else
  echo "stopped"
fi
