#!/usr/bin/env bash
set -euo pipefail

# A broken driver starves Node timers and signal handlers. Force an external
# deadline and remove the owned container, including detached Chromium children.
cd "$(dirname "$0")/.."
image="${PATCHRIGHT_TEST_IMAGE:-mcr.microsoft.com/playwright:v1.63.0-noble}"
name="patchright-context-lifecycle-$$-${RANDOM}"
cleanup() {
  timeout --signal=KILL 10s docker rm --force "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$#" -eq 0 ]; then
  set -- crash races
fi
for suite in "$@"; do
  case "$suite" in
    crash) script=utils/context_lifecycle_crash_repro.mjs; deadline=35s ;;
    races) script=utils/context_lifecycle_test.mjs; deadline=160s ;;
    *) echo "Unknown suite: $suite (expected crash or races)" >&2; exit 2 ;;
  esac
  timeout --signal=KILL "$deadline" docker run --rm --init --network none \
    --name "$name" --shm-size=256m --entrypoint node \
    --volume "$PWD:/work:ro" --workdir /work "$image" "$script"
done
