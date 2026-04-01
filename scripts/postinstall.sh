#!/bin/zsh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

if [ ! -d "${HOME}/Desktop" ]; then
  exit 0
fi

/bin/zsh "${REPO_ROOT}/scripts/install-launch-agent.sh"
/bin/zsh "${REPO_ROOT}/scripts/install-desktop-shortcut.sh"
