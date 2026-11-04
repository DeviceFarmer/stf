#!/usr/bin/env bash
#
# Install the Playwright test runner, its Chromium bundle, and (only when the
# runner image is missing a shared library) its apt dependencies.
#
# Calling `playwright install --with-deps chromium` unconditionally runs bare
# `apt-get update && apt-get install -y` without apt-install.sh's HTTP and
# index-refresh timeouts, pulling optional font archives even though every
# shared library Chromium links against is already preinstalled on ubuntu-24.04.
# When a mirror stalls, that step eats the 15 minute timeout and bypasses the
# Android leg retry.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PW_DIR="${PLAYWRIGHT_DIR:-$ROOT_DIR/test/playwright}"
RETRY="$ROOT_DIR/.github/scripts/retry.sh"
APT_INSTALL="$ROOT_DIR/.github/scripts/apt-install.sh"
NPM_FLAGS="${NPM_INSTALL_FLAGS:---no-audit --no-fund}"

if [ ! -d "$PW_DIR/node_modules/@playwright/test" ]; then
  # Word-split NPM_FLAGS intentionally, matching ci.yml's `npm install $NPM_INSTALL_FLAGS`.
  # shellcheck disable=SC2086
  (cd "$PW_DIR" && bash "$RETRY" 3 npm install $NPM_FLAGS)
else
  echo "install-playwright: reusing cached $PW_DIR/node_modules"
fi

# When ~/.cache/ms-playwright was restored from actions/cache, Playwright sees
# its INSTALLATION_COMPLETE markers and exits immediately without touching the
# network. On a cache miss it downloads chromium, chromium-headless-shell and
# ffmpeg from cdn.playwright.dev without invoking apt.
(cd "$PW_DIR" && bash "$RETRY" 3 npx playwright install chromium)

launch_chromium() {
  (
    cd "$PW_DIR"
    node -e '
      const {chromium} = require("@playwright/test")
      chromium.launch().then(
        browser => browser.close(),
        err => {
          console.error(err && err.message ? err.message : err)
          process.exit(1)
        }
      )
    '
  )
}

if launch_chromium; then
  echo "install-playwright: headless Chromium launched cleanly"
  exit 0
fi

echo "::warning::Chromium failed to launch with preinstalled libraries, installing system dependencies"

dry_run="$(cd "$PW_DIR" && npx playwright install-deps --dry-run chromium 2>&1 || true)"
pkgs=()
while IFS= read -r pkg; do
  if [ -n "$pkg" ]; then
    pkgs+=("$pkg")
  fi
done <<EOF
$(printf '%s\n' "$dry_run" | node -e '
  const fs = require("fs")
  const text = fs.readFileSync(0, "utf8")
  const match = /apt-get\s+install\b([^\n]*)/.exec(text)
  if (!match) process.exit(0)
  for (const token of match[1].trim().split(/\s+/)) {
    if (token && !token.startsWith("-") && /^[a-z0-9][a-z0-9.+:-]*$/i.test(token)) {
      console.log(token)
    }
  }
')
EOF

if [ "${#pkgs[@]}" -gt 0 ]; then
  bash "$APT_INSTALL" "${pkgs[@]}"
else
  echo "::warning::could not parse package list from playwright install-deps --dry-run, running install-deps directly"
  (cd "$PW_DIR" && bash "$RETRY" 3 npx playwright install-deps chromium)
fi

launch_chromium
echo "install-playwright: headless Chromium launched cleanly after installing dependencies"
