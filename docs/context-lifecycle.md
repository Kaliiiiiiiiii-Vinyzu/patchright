# Context lifecycle fix (1.63.0)

Branch `fix/context-lifecycle-1.63` is a source-only fix based on:

| Component | Baseline |
| --- | --- |
| Patchright driver | `v1.63.0`, `f34b86146dd4e6b54eeacb023af0dbfe19ee09db` |
| Node client submodule | `5d40f66fb35d61d9611d459266a87a3ad7637009` |
| Playwright source | `v1.63.0`, `1b025d7e20a026371cd5f98ba0cdce48892737c8` |

This is not a published npm package or a port to newer Patchright versions.
Installing the driver repository directly as an npm dependency does not build
usable client packages. No consuming application's dependency pins are changed.

## Failure and fix

After a renderer crash, context acquisition can repeatedly receive no execution
context ID from `_sendMayFail`. Recursive `Frame._context` calls then starve the
Node event loop: timers, navigation rejection, and browser shutdown stop making
progress. Navigation itself acquires a utility context, so application evaluation
is not required to trigger the failure. A successful CDP result that arrives after
a terminal lifecycle transition can also register a stale context.

`driver_patches/framesPatch.ts` now generates a local lifecycle check at method
entry and immediately after each of the three acquisition awaits: iframe main,
top-level main, and utility. Detached frames keep their existing error; closed,
closing, crashed, or disconnected targets throw `TargetClosedError`. The entry
check also rejects calls that would otherwise return a cached context.

Live missing-ID retries, promise coalescing, cross-document invalidation, world
selection, and session replacement behavior remain unchanged. `_sendMayFail` is
not modified globally, and a closed frame session alone is not treated as a
terminal target. `patchright.patch` contains the corresponding generated
source comparison; the TypeScript patcher, not that documentation file, drives
the build.

## Build and reproduce

Use a disposable checkout, Node.js 24, npm, Git, Docker, Bash, and GNU `timeout`.
The existing rebuild script resets and cleans its nested `playwright/` checkout;
do not keep unpublished work there. Pin the version explicitly: the upstream
script's default is older than this branch's baseline.

```sh
git clone --branch fix/context-lifecycle-1.63 https://github.com/ehopealot/patchright.git
cd patchright
git submodule update --init --recursive
PLAYWRIGHT_VERSION=v1.63.0 npm run rebuild
npm run typecheck
npm run format:check -- driver_patches/framesPatch.ts
docker pull mcr.microsoft.com/playwright:v1.63.0-noble
npm run test:context-lifecycle
```

The tests import the locally built `playwright/packages/playwright-core`, not an
installed release or the driver's container copy. Containers have no network and
mount the checkout read-only. `PATCHRIGHT_TEST_IMAGE` can select another local
image with Node.js 24, the matching Chromium build, and browser dependencies.

- `npm run test:context-lifecycle -- crash`: public-API reproduction using a
  loopback page with a pending script, then `Page.crash` at navigation commit.
  Requires navigation rejection, a responsive Node timer, and completed shutdown.
- `npm run test:context-lifecycle -- races`: 21 real-driver scenarios. Test-only
  interception holds genuine successful CDP results across crash, page/context
  close, unexpected owned-browser transport loss, and iframe detach. It verifies
  rejection, no stale registration, no additional terminal acquisition request,
  cached-context rejection, live retries/coalescing, and fresh DOM after navigation.

The wrapper enforces external SIGKILL deadlines (35 and 160 seconds) and removes
only its own uniquely named container, including detached Chromium children.
Do not rely on an in-process watchdog or ordinary SIGTERM when reproducing the
unfixed bug: its microtask loop can prevent both from running.

## Verification

Against the unmodified source-built baseline, the crash reproduction exceeded
its external deadline (exit 137), and the race suite failed its first case with
one stale context registration where zero was expected. After rebuilding with
the source fix, the crash reproduction and all 21 race scenarios passed.

The patcher typecheck, changed-patcher formatting check, and two existing custom
execution-context API tests also passed. The full generated Playwright
TypeScript check has 312 pre-existing diagnostics on this baseline; the patched
build has the same diagnostics after normalizing source locations, with none
added. This is not a clean full-driver typecheck or a full upstream-suite result.
No claim is made about newer releases or detection behavior.
