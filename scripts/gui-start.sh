#!/bin/zsh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.smittypnw.clawdev.gui"
GUI_URL="${CLAW_GUI_URL:-http://127.0.0.1:${CLAW_GUI_PORT:-4310}}"
DIST_ENTRY="${REPO_ROOT}/dist/guiServer.js"
PID_DIR="${HOME}/.claw-dev"
PID_FILE="${PID_DIR}/gui.pid"
LOG_FILE="${PID_DIR}/gui.log"

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
    (cd "${REPO_ROOT}" && node ./node_modules/typescript/bin/tsc -p tsconfig.json)
  fi
}

if [ "$(uname -s)" = "Darwin" ]; then
  ensure_build
  /bin/zsh "${REPO_ROOT}/scripts/install-launch-agent.sh"
  exit 0
fi

ensure_build

if curl -fsS "${GUI_URL}" >/dev/null 2>&1; then
  echo "Claw Dev GUI already running at ${GUI_URL}"
  exit 0
fi

mkdir -p "${PID_DIR}"

nohup node "${DIST_ENTRY}" >> "${LOG_FILE}" 2>&1 &
echo $! > "${PID_FILE}"

echo "Started Claw Dev GUI at ${GUI_URL}"
