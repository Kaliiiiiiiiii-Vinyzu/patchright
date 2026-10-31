#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# Resolve the Playwright version: explicit env, then the latest release (like CI), then the current checkout.
if [ -z "${PLAYWRIGHT_VERSION:-}" ]; then
  PLAYWRIGHT_VERSION=$(curl --fail --silent "https://api.github.com/repos/microsoft/playwright/releases/latest" |
    grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' || true)
fi
if [ -z "$PLAYWRIGHT_VERSION" ] && [ -d playwright/.git ]; then
  PLAYWRIGHT_VERSION=$(git -C playwright describe --tags --exact-match 2>/dev/null || true)
fi
if [ -z "$PLAYWRIGHT_VERSION" ]; then
  echo "Could not determine the Playwright version, set PLAYWRIGHT_VERSION (e.g. v1.64.1)." >&2
  exit 1
fi
PLAYWRIGHT_VERSION="v${PLAYWRIGHT_VERSION#v}"
echo "Using Playwright $PLAYWRIGHT_VERSION"

if [ ! -d playwright/.git ]; then
  git clone https://github.com/microsoft/playwright --branch "$PLAYWRIGHT_VERSION" playwright
else
  git -C playwright reset --hard
  git -C playwright clean -fd
  git -C playwright fetch --tags --depth=1 origin "$PLAYWRIGHT_VERSION"
  git -C playwright checkout "$PLAYWRIGHT_VERSION"
fi

npm ci
(
  cd playwright
  npm ci
)

git -C . submodule update --init --recursive patchright-nodejs
npm run patch

(
  cd playwright
  node utils/generate_channels.js || true
  npm run build
)
