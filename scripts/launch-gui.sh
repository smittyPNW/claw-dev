#!/bin/zsh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
/bin/zsh "${REPO_ROOT}/scripts/gui-start.sh"
open "${CLAW_GUI_URL:-http://127.0.0.1:${CLAW_GUI_PORT:-4310}}"
