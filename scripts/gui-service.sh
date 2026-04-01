#!/bin/zsh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-}"
GUI_ENTRY="${REPO_ROOT}/dist/guiServer.js"

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

if [ ! -f "${GUI_ENTRY}" ]; then
  echo "Built GUI entry not found at ${GUI_ENTRY}. Run the GUI build first."
  exit 1
fi

exec "${NODE_PATH}" "${GUI_ENTRY}"
