/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { expect, contextTest as it } from '../../config/browserTest';

it('should keep isolated and main execution contexts separate across APIs @patchright', async ({ page, server }) => {
  server.setRoute('/patchright-context.html', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><button id="target">target</button><iframe src="/patchright-context-frame.html"></iframe><script>window.mainMarker = "main"</script>');
  });
  server.setRoute('/patchright-context-frame.html', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><script>window.frameMarker = "frame-main"</script>');
  });

  await page.goto(server.PREFIX + '/patchright-context.html');
  expect(await page.evaluate(() => window['mainMarker'])).toBeUndefined();
  expect(await page.evaluate(() => window['mainMarker'], undefined, undefined, false)).toBe('main');

  await page.evaluate(() => window['isolatedMarker'] = 'isolated');
  expect(await page.evaluate(() => window['isolatedMarker'], undefined, undefined, false)).toBeUndefined();

  const frame = page.frames()[1];
  expect(await frame.evaluate(() => window['frameMarker'])).toBeUndefined();
  expect(await frame.evaluate(() => window['frameMarker'], undefined, undefined, false)).toBe('frame-main');

  const target = page.locator('#target');
  expect(await target.evaluate(() => window['mainMarker'])).toBeUndefined();
  expect(await target.evaluate(() => window['mainMarker'], undefined, undefined, false)).toBe('main');
  expect(await page.locator('button').evaluateAll(() => window['mainMarker'], undefined, false)).toBe('main');

  await page.reload();
  expect(await page.evaluate(() => window['mainMarker'], undefined, undefined, false)).toBe('main');
  expect(await page.evaluate(() => window['mainMarker'])).toBeUndefined();
});

it('should preserve main-world handles and accept context selection for workers @patchright', async ({ page, server }) => {
  await page.goto(server.PREFIX + '/drag-n-drop.html');
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer(), undefined, undefined, false);
  await page.locator('#source').dispatchEvent('dragstart', { dataTransfer });
  await page.locator('#target').dispatchEvent('drop', { dataTransfer });
  await expect(page.locator('#target > #source')).toHaveCount(1);

  const workerPromise = page.waitForEvent('worker');
  await page.evaluate(() => {
    new Worker(URL.createObjectURL(new Blob(['self.answer = 42'], { type: 'text/javascript' })));
  }, undefined, undefined, false);
  const worker = await workerPromise;
  expect(await worker.evaluate(() => self['answer'])).toBe(42);
  expect(await worker.evaluate(() => self['answer'], undefined, false)).toBe(42);
});

// Keep the driver in a child: an unbounded microtask retry would starve its own
// timers. The runner's normal timeout and childProcess teardown still work.
it('should stop context acquisition after a navigation crash @patchright', async ({ server, childProcess, browserName, launchOptions, headless, channel }) => {
  it.skip(browserName !== 'chromium');
  server.setRoute('/context-crash.html', (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<script src="/context-pending.js"></script>');
  });
  server.setRoute('/context-pending.js', () => {});

  const child = childProcess({ command: [process.execPath, '-e', `
    const assert = require('node:assert/strict');
    const { chromium } = require(${JSON.stringify(require.resolve('playwright-core'))});
    (async () => {
      const browser = await chromium.launch(${JSON.stringify({ ...launchOptions, headless, channel })});
      try {
        const page = await browser.newPage();
        await page.goto(${JSON.stringify(server.EMPTY_PAGE)});
        const cdp = await page.context().newCDPSession(page);
        page.once('framenavigated', () => {
          void cdp.send('Page.crash').catch(() => {});
        });
        await assert.rejects(page.goto(${JSON.stringify(server.PREFIX + '/context-crash.html')}, {
          waitUntil: 'domcontentloaded',
        }), /Page crashed/);
        await new Promise(resolve => setTimeout(resolve, 0));
      } finally {
        await browser.close();
      }
      console.log('%% context lifecycle complete');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `] });
  await child.cleanExit();
  expect(child.outputLines()).toEqual(['context lifecycle complete']);
});

for (const world of ['main', 'utility', 'iframe']) {
  it(`should reject a late ${world} context after ${world === 'iframe' ? 'frame detachment' : 'page close'} @patchright`, async ({ server, childProcess, browserName, launchOptions, headless, channel }) => {
    it.skip(browserName !== 'chromium');
    // Inspect the local driver inside the child so this also runs in driver mode,
    // where the parent test's toImpl fixture is intentionally unavailable.
    const child = childProcess({ command: [process.execPath, '-e', `
      const assert = require('node:assert/strict');
      const { chromium } = require(${JSON.stringify(require.resolve('playwright-core'))});
      (async () => {
        const browser = await chromium.launch(${JSON.stringify({ ...launchOptions, headless, channel })});
        try {
          const page = await browser.newPage();
          await page.goto(${JSON.stringify(server.PREFIX + '/frames/one-frame.html')});
          const impl = page._connection.toImpl(page);
          const world = ${JSON.stringify(world)};
          const frame = world === 'iframe' ? impl.mainFrame().childFrames()[0] : impl.mainFrame();
          const apiWorld = world === 'iframe' ? 'main' : world;
          const cdp = await page.context().newCDPSession(page);
          const session = impl.delegate._sessionForFrame(frame);
          const client = session._client;
          const originalSend = client._sendMayFail;
          const originalRegister = session._onExecutionContextCreated;
          // Reset the same cache fields as a new-document navigation.
          const cache = world === 'utility' ? '_isolatedWorld' : world === 'iframe' ? '_iframeWorld' : '_mainWorld';
          frame[cache] = undefined;
          frame[cache + 'ContextPromise'] = undefined;

          let ready, release;
          const held = new Promise(resolve => ready = resolve);
          const released = new Promise(resolve => release = resolve);
          let calls = 0;
          let terminal = false;
          let staleRegistrations = 0;
          client._sendMayFail = async function(method, params) {
            const result = await originalSend.call(this, method, params);
            const matches = world === 'iframe' ? method === 'DOM.resolveNode' :
              world === 'main' ? method === 'Runtime.evaluate' && params.expression === 'globalThis' :
              method === 'Page.createIsolatedWorld' && params.frameId === frame._id;
            if (!matches || ++calls !== 1)
              return result;
            const id = world === 'utility' ? result?.executionContextId :
              world === 'iframe' ? result?.object?.objectId : result?.result?.objectId;
            assert.ok(id, 'must hold a genuine successful CDP acquisition result');
            ready();
            await released;
            return result;
          };
          session._onExecutionContextCreated = function(...args) {
            if (terminal)
              ++staleRegistrations;
            return originalRegister.apply(this, args);
          };
          try {
            // Observe rejection before closing/detaching to avoid unhandled errors.
            const pending = frame._context(apiWorld).then(value => ({ value }), error => ({ error }));
            await Promise.race([held, pending.then(() => {
              throw new Error('Context acquisition settled before the CDP result was held');
            })]);
            if (world === 'iframe') {
              const detached = page.waitForEvent('framedetached');
              await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("iframe").remove()' });
              await detached;
              assert.ok(frame._isDetached());
            } else {
              await page.close();
              assert.ok(impl.isClosedOrClosingOrCrashed());
            }
            terminal = true;
            release();
            const outcome = await pending;
            assert.equal(staleRegistrations, 0, 'must not register a context after close/detach');
            assert.ok(outcome.error, 'pending context acquisition must reject');
            assert.match(outcome.error.message, /closed|detached/i);
            await assert.rejects(frame._context(apiWorld), /closed|detached/i);
            assert.equal(calls, 1, 'must not retry context acquisition after close/detach');
          } finally {
            client._sendMayFail = originalSend;
            session._onExecutionContextCreated = originalRegister;
            release();
          }
        } finally {
          await browser.close();
        }
        console.log('%% context lifecycle complete');
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `] });
    await child.cleanExit();
    expect(child.outputLines()).toEqual(['context lifecycle complete']);
  });
}

it('should reject cached contexts after a renderer crash @patchright', async ({ server, childProcess, browserName, launchOptions, headless, channel }) => {
  it.skip(browserName !== 'chromium');
  const child = childProcess({ command: [process.execPath, '-e', `
    const assert = require('node:assert/strict');
    const { chromium } = require(${JSON.stringify(require.resolve('playwright-core'))});
    (async () => {
      const browser = await chromium.launch(${JSON.stringify({ ...launchOptions, headless, channel })});
      try {
        const page = await browser.newPage();
        await page.goto(${JSON.stringify(server.EMPTY_PAGE)});
        const impl = page._connection.toImpl(page);
        const frame = impl.mainFrame();
        await frame._context('main');
        await frame._context('utility');
        const cdp = await page.context().newCDPSession(page);
        const crashed = page.waitForEvent('crash');
        void cdp.send('Page.crash').catch(() => {});
        await crashed;
        assert.ok(impl.isClosedOrClosingOrCrashed());
        assert.ok(frame._mainWorld && frame._isolatedWorld, 'contexts must still be cached');
        await assert.rejects(frame._context('main'), /closed/i);
        await assert.rejects(frame._context('utility'), /closed/i);
      } finally {
        await browser.close();
      }
      console.log('%% context lifecycle complete');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `] });
  await child.cleanExit();
  expect(child.outputLines()).toEqual(['context lifecycle complete']);
});
