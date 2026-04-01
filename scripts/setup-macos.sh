#!/bin/zsh

set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Claw Dev macOS setup is only available on macOS."
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

/bin/zsh "${REPO_ROOT}/scripts/install-launch-agent.sh"
/bin/zsh "${REPO_ROOT}/scripts/install-desktop-shortcut.sh"

echo "Claw Dev macOS setup complete."
