#!/bin/zsh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

if [ ! -d "${HOME}/Desktop" ]; then
  exit 0
fi

if [ "${CLAW_DEV_AUTO_SETUP:-0}" = "1" ]; then
  /bin/zsh "${REPO_ROOT}/scripts/setup-macos.sh"
  exit 0
fi

echo "Claw Dev postinstall finished without changing macOS services or Desktop shortcuts."
echo "Run 'npm run setup:macos' when you want the LaunchAgent and Desktop app installed."
