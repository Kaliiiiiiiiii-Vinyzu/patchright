#!/bin/bash

rm -rf playwright 2>/dev/null || true
git clone https://github.com/microsoft/playwright --branch v1.58.2
cd playwright
npm ci
node "../patchright_nodejs_patch.js"
node utils/generate_channels.js
npm run build
npx playwright install-deps
npx playwright install chromium
cd ..
node modify_tests.js
cd playwright
PWTEST_MODE=driver npx playwright test --config=tests/library/playwright.config.ts --project=chromium-page --max-failures=0 --reporter=null | tee -a ../test_output.txt
PWTEST_MODE=driver npx playwright test --config=tests/library/playwright.config.ts --project=chromium-library --max-failures=0 --reporter=null | tee -a ../test_output.txt
