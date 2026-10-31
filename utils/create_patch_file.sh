#!/usr/bin/env bash
# Writes patchright.patch by diffing ./playwright_not_patched (unpatched copy) against ./playwright (patched).
# Shared by the PR build and the main updater so both produce byte-identical patch files.
set -euo pipefail

# diff paths must read playwright/... and patchright/..., so swap the directories while diffing.
mv playwright patchright
mv playwright_not_patched playwright

echo "# NOTE: This patch file is generated automatically and is not used, it is only for documentation. The driver is actually patched using [patchright_driver_patch](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/blob/main/patchright_driver_patch.ts), see [the workflow](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/blob/main/.github/workflows/patch_file_updater.yml)" >patchright.patch
diff -ruN -x protocol.yml --minimal playwright patchright | sed -E 's/^(---|\+\+\+) .*/\1/' >>patchright.patch || true

rm -rf playwright
mv patchright playwright
