#!/bin/zsh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-}"
TSX_ENTRY="${REPO_ROOT}/node_modules/tsx/dist/cli.mjs"
GUI_ENTRY="${REPO_ROOT}/src/guiServer.ts"

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

cd "${REPO_ROOT}"
NODE_PATH="$(resolve_node_path)"
if [ -z "${NODE_PATH}" ]; then
  echo "Could not find Node.js to start the Claw Dev GUI service."
  exit 1
fi

exec "${NODE_PATH}" "${TSX_ENTRY}" "${GUI_ENTRY}"
