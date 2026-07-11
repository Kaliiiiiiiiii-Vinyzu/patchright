#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# Rebuild by default so tests never exercise stale patched sources.
if [ "${PATCHRIGHT_SKIP_REBUILD:-0}" != "1" ]; then
  bash utils/rebuild_local_package.sh
fi

(
  cd playwright
  # Install chromium browser
  npx playwright install chromium
)

# Modify playwright tests for patchright
npx tsx utils/modify_tests.ts

# Helper function to run tests with xvfb if available (Linux headless)
run_test() {
  if command -v xvfb-run &> /dev/null; then
    xvfb-run -a "$@"
  else
    "$@"
  fi
}

echo "Running Page Tests..."
(
  cd playwright
  PWTEST_MODE=driver run_test npx playwright test --config=tests/library/playwright.config.ts --project=chromium-page --max-failures=0 --retries=3
)

echo "Running Library Tests..."
(
  cd playwright
  PWTEST_MODE=driver run_test npx playwright test --config=tests/library/playwright.config.ts --project=chromium-library --max-failures=0 --retries=3
)
