#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-v1.60.0}"

if [ ! -d playwright/.git ]; then
  git clone https://github.com/microsoft/playwright --branch "$PLAYWRIGHT_VERSION" playwright
else
  git -C playwright reset --hard
  git -C playwright clean -fd
  git -C playwright fetch --tags --depth=1 origin "$PLAYWRIGHT_VERSION"
  git -C playwright checkout "$PLAYWRIGHT_VERSION"
fi

npm install
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
