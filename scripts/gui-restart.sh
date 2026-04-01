#!/bin/zsh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

/bin/zsh "${REPO_ROOT}/scripts/gui-stop.sh"
sleep 1
/bin/zsh "${REPO_ROOT}/scripts/gui-start.sh"
