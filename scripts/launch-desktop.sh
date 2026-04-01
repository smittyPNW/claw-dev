#!/bin/zsh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-}"
TSX_ENTRY="${REPO_ROOT}/node_modules/tsx/dist/cli.mjs"
TUI_ENTRY="${REPO_ROOT}/src/index.ts"

resolve_node_path() {
  if [ -n "${NODE_BIN}" ] && [ -x "${NODE_BIN}" ]; then
    echo "${NODE_BIN}"
    return 0
  fi

  for candidate in /usr/local/bin/node /opt/homebrew/bin/node /opt/homebrew/bin/nodejs /usr/bin/node; do
    if [ -x "${candidate}" ]; then
      echo "${candidate}"
      return 0
    fi
  done

  return 1
}

"${REPO_ROOT}/scripts/launch-gui.sh"

NODE_PATH="$(resolve_node_path)"
if [ -z "${NODE_PATH}" ]; then
  echo "Could not find Node.js to start the Claw Dev TUI."
  exit 1
fi

cd "${REPO_ROOT}"
exec "${NODE_PATH}" "${TSX_ENTRY}" "${TUI_ENTRY}" --interactive
