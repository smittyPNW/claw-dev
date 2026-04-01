#!/bin/zsh

set -euo pipefail

PID_FILE="${HOME}/.claw-dev/telegram.pid"

if [ -f "${PID_FILE}" ]; then
  kill "$(cat "${PID_FILE}")" >/dev/null 2>&1 || true
  rm -f "${PID_FILE}"
fi

pkill -f "dist/telegramBot.js" >/dev/null 2>&1 || true
pkill -f "src/telegramBot.ts" >/dev/null 2>&1 || true
pkill -f "telegramBot\\.(js|ts)" >/dev/null 2>&1 || true

echo "Stopped Claw Dev Telegram"
