#!/bin/zsh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-}"

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
  echo "Could not find Node.js to start the Claw Dev GUI."
  exit 1
fi

"${NODE_PATH}" "${REPO_ROOT}/scripts/ensure-gui.mjs" --open
