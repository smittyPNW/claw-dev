#!/bin/zsh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_ENTRY="${REPO_ROOT}/dist/telegramBot.js"
PID_DIR="${HOME}/.claw-dev"
PID_FILE="${PID_DIR}/telegram.pid"
LOG_FILE="${PID_DIR}/telegram.log"

needs_build() {
  if [ ! -f "${DIST_ENTRY}" ]; then
    return 0
  fi

  if find "${REPO_ROOT}/src" -type f \( -name '*.ts' -o -name '*.tsx' \) -newer "${DIST_ENTRY}" | head -n 1 | grep -q .; then
    return 0
  fi

  return 1
}

ensure_build() {
  if needs_build; then
    (cd "${REPO_ROOT}" && ./node_modules/.bin/tsc -p tsconfig.json)
  fi
}

is_running() {
  if [ -f "${PID_FILE}" ]; then
    local pid
    pid="$(cat "${PID_FILE}")"
    if [ -n "${pid}" ] && kill -0 "${pid}" >/dev/null 2>&1 && ps -o command= -p "${pid}" | grep -E "telegramBot\\.(js|ts)" >/dev/null 2>&1; then
      return 0
    fi
  fi

  if pgrep -f "telegramBot\\.(js|ts)" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

ensure_build
mkdir -p "${PID_DIR}"

if is_running; then
  echo "Claw Dev Telegram already running"
  exit 0
fi

nohup node "${DIST_ENTRY}" >> "${LOG_FILE}" 2>&1 &
echo $! > "${PID_FILE}"

echo "Started Claw Dev Telegram"
