#!/bin/zsh

set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "LaunchAgent install is only supported on macOS."
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.smittypnw.clawdev.gui"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${LAUNCH_AGENTS_DIR}/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/ClawDev"
SUPPORT_DIR="${HOME}/Library/Application Support/ClawDev"
WRAPPER_PATH="${SUPPORT_DIR}/gui-service.sh"
STDOUT_LOG="${LOG_DIR}/gui.stdout.log"
STDERR_LOG="${LOG_DIR}/gui.stderr.log"
GUI_PORT="${CLAW_GUI_PORT:-4310}"
DIST_ENTRY="${REPO_ROOT}/dist/guiServer.js"

needs_build() {
  if [ ! -f "${DIST_ENTRY}" ]; then
    return 0
  fi

  if find "${REPO_ROOT}/src" -type f \( -name '*.ts' -o -name '*.tsx' \) -newer "${DIST_ENTRY}" | head -n 1 | grep -q .; then
    return 0
  fi

  return 1
}

if needs_build; then
  (cd "${REPO_ROOT}" && node ./node_modules/typescript/bin/tsc -p tsconfig.json)
fi

mkdir -p "${LAUNCH_AGENTS_DIR}" "${LOG_DIR}" "${SUPPORT_DIR}"
touch "${STDOUT_LOG}" "${STDERR_LOG}"
cat > "${WRAPPER_PATH}" <<EOF
#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export CLAW_GUI_PORT="${GUI_PORT}"
NODE_BIN=""

resolve_node_path() {
  if [ -n "\${NODE_BIN}" ] && [ -x "\${NODE_BIN}" ]; then
    echo "\${NODE_BIN}"
    return 0
  fi

  for candidate in /usr/local/bin/node /opt/homebrew/bin/node /opt/homebrew/bin/nodejs /usr/bin/node; do
    if [ -x "\${candidate}" ]; then
      echo "\${candidate}"
      return 0
    fi
  done

  return 1
}

cd "${REPO_ROOT}"
NODE_PATH="\$(resolve_node_path)"
if [ -z "\${NODE_PATH}" ]; then
  echo "Could not find Node.js to start the Claw Dev GUI service."
  exit 1
fi
exec "\${NODE_PATH}" "${REPO_ROOT}/dist/guiServer.js"
EOF
chmod +x "${WRAPPER_PATH}"

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${WRAPPER_PATH}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${STDOUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${STDERR_LOG}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>CLAW_GUI_PORT</key>
    <string>${GUI_PORT}</string>
  </dict>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true

launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true

if ! launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  echo "Could not install ${LABEL}." >&2
  exit 1
fi

echo "Installed and started ${LABEL}"
