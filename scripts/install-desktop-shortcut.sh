#!/bin/zsh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Claw Dev"
DESKTOP_DIR="${HOME}/Desktop"
APP_DIR="${DESKTOP_DIR}/${APP_NAME}.app"
COMMAND_PATH="${DESKTOP_DIR}/${APP_NAME}.command"
BUILD_ROOT="$(mktemp -d)"
BUILD_APP_DIR="${BUILD_ROOT}/${APP_NAME}.app"
ICON_SOURCE="${REPO_ROOT}/assets/desktop/claw-dev-launcher-icon.png"
ICON_NAME="claw-dev-launcher"
ICONSET_DIR="$(mktemp -d)/${ICON_NAME}.iconset"
TEMP_ICNS_PATH="$(mktemp -u)/${ICON_NAME}.icns"

cleanup() {
  rm -rf "$(dirname "${ICONSET_DIR}")"
  rm -rf "$(dirname "${TEMP_ICNS_PATH}")"
  rm -rf "${BUILD_ROOT}"
}

trap cleanup EXIT

if [ ! -f "${ICON_SOURCE}" ]; then
  echo "Missing icon source at ${ICON_SOURCE}" >&2
  exit 1
fi

rm -rf "${APP_DIR}"
rm -f "${COMMAND_PATH}"
mkdir -p "${ICONSET_DIR}"

create_iconset() {
  local size file
  for size in 16 32 128 256 512; do
    file="${ICONSET_DIR}/icon_${size}x${size}.png"
    sips -s format png -z "${size}" "${size}" "${ICON_SOURCE}" --out "${file}" >/dev/null

    if [ "${size}" -lt 512 ]; then
      sips -s format png -z "$((size * 2))" "$((size * 2))" "${ICON_SOURCE}" \
        --out "${ICONSET_DIR}/icon_${size}x${size}@2x.png" >/dev/null
    fi
  done

  cp "${ICONSET_DIR}/icon_512x512.png" "${ICONSET_DIR}/icon_512x512@2x.png"
  mkdir -p "$(dirname "${TEMP_ICNS_PATH}")"
  iconutil -c icns "${ICONSET_DIR}" -o "${TEMP_ICNS_PATH}"
}

build_app() {
  local launcher_command
  launcher_command="cd ${REPO_ROOT} && ${REPO_ROOT}/scripts/launch-desktop.sh"

  osacompile -o "${BUILD_APP_DIR}" <<EOF
on run
  try
    tell application "Terminal"
      activate
      do script "/bin/zsh -lc " & quoted form of "${launcher_command}"
    end tell
  on error errMsg number errNum
    display dialog "Claw Dev could not launch. " & errMsg buttons {"OK"} default button "OK"
  end try
end run
EOF

  mkdir -p "${BUILD_APP_DIR}/Contents/Resources"
  cp "${TEMP_ICNS_PATH}" "${BUILD_APP_DIR}/Contents/Resources/applet.icns"
  cp "${BUILD_APP_DIR}/Contents/Resources/applet.icns" "${BUILD_APP_DIR}/Contents/Resources/droplet.icns" 2>/dev/null || true
  xattr -cr "${BUILD_APP_DIR}" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleName ${APP_NAME}" "${BUILD_APP_DIR}/Contents/Info.plist" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${APP_NAME}" "${BUILD_APP_DIR}/Contents/Info.plist" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.smittypnw.clawdev.desktop" "${BUILD_APP_DIR}/Contents/Info.plist" >/dev/null 2>&1 || true
}

write_command_launcher() {
  cat > "${COMMAND_PATH}" <<EOF
#!/bin/zsh
cd "${REPO_ROOT}"
exec "${REPO_ROOT}/scripts/launch-desktop.sh"
EOF
  chmod +x "${COMMAND_PATH}"
}

create_iconset
build_app
write_command_launcher

mv "${BUILD_APP_DIR}" "${DESKTOP_DIR}/"

if [ ! -d "${APP_DIR}" ]; then
  echo "Desktop app bundle was not created correctly at ${APP_DIR}" >&2
  exit 1
fi

echo "Installed desktop launchers at ${APP_DIR} and ${COMMAND_PATH}"
