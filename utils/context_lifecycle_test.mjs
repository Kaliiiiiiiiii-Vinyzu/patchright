// Test-only interception of the source-built driver's CDP acquisition boundary.
// Public API cancellation alone is not proof that Frame._context stopped
// retrying or avoided registering a stale context. Run via test_context_lifecycle.sh.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '../playwright/packages/playwright-core/index.mjs';

const require = createRequire(import.meta.url);
assert.equal(require('../playwright/packages/playwright-core/package.json').version, '1.63.0');
const web = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<title>${req.url}</title><iframe srcdoc="<p>child</p>"></iframe>`);
});
web.listen(0, '127.0.0.1');
await once(web, 'listening');
const origin = `http://127.0.0.1:${web.address().port}`;
const cases = [];

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`deadline: ${label}`)), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}
function observe(promise) {
  return promise.then(value => ({ value }), error => ({ error }));
}
async function mustReject(promise) {
  const outcome = await bounded(observe(promise), 'server acquisition rejection');
  assert.ok(outcome.error, 'server Frame._context must reject, not return a stale context');
  assert.match(outcome.error.message, /closed|crashed|detached/i);
  // A broken microtask retry loop cannot pass even this short in-process timer.
  assert.equal(await bounded(delay(10, 'responsive'), 'Node timer'), 'responsive');
}
function resetWorld(frame, world) {
  // Exactly the fields invalidated by frameCommittedNewDocumentNavigation.
  const stem = world === 'utility' ? '_isolatedWorld' : world === 'iframe' ? '_iframeWorld' : '_mainWorld';
  frame[stem] = undefined;
  frame[`${stem}ContextPromise`] = undefined;
}
function matches(method, params, world, frame) {
  if (world === 'iframe') return method === 'DOM.resolveNode';
  if (world === 'main') return method === 'Runtime.evaluate' && params.expression === 'globalThis';
  return method === 'Page.createIsolatedWorld' && params.frameId === frame._id;
}
function holdAcquisition(frame, world, { missing = false } = {}) {
  const client = frame._page.delegate._sessionForFrame(frame)._client;
  const original = client._sendMayFail;
  const ready = Promise.withResolvers();
  const release = Promise.withResolvers();
  let calls = 0;
  client._sendMayFail = async function(method, params) {
    const result = await original.call(this, method, params);
    if (!matches(method, params, world, frame)) return result;
    if (++calls !== 1) return result;
    const id = world === 'utility' ? result?.executionContextId : (world === 'iframe' ? result?.object?.objectId : result?.result?.objectId);
    assert.ok(id, `must hold a genuine successful ${world} CDP result`);
    ready.resolve();
    await release.promise;
    return missing ? undefined : result;
  };
  return { ready: ready.promise, release: () => release.resolve(), calls: () => calls,
    restore: () => { client._sendMayFail = original; release.resolve(); } };
}
async function setup(world = 'main') {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin + '/before');
  const impl = page._connection.toImpl(page);
  const frame = world === 'iframe' ? impl.mainFrame().childFrames()[0] : impl.mainFrame();
  assert.ok(frame);
  return { browser, context, page, impl, frame, cdp: await context.newCDPSession(page) };
}
async function terminate(s, event) {
  if (event === 'crash') {
    const crashed = once(s.page, 'crash');
    void s.cdp.send('Page.crash').catch(() => {});
    await bounded(crashed, 'renderer crash');
    assert.ok(s.impl.isClosedOrClosingOrCrashed());
  } else if (event === 'page-close') {
    await s.page.close();
  } else if (event === 'context-close') {
    await s.context.close();
  } else if (event === 'disconnect') {
    const disconnected = once(s.browser, 'disconnected');
    const serverBrowser = s.page._connection.toImpl(s.browser);
    assert.equal(serverBrowser._startedClosing, false);
    // Unexpected loss of this test's owned Chromium, not browser.close().
    assert.equal(serverBrowser.options.browserProcess.process.kill('SIGKILL'), true);
    await bounded(disconnected, 'transport disconnect');
    assert.ok(s.impl.openScope.isClosed());
  } else {
    const detached = once(s.page, 'framedetached');
    await s.cdp.send('Runtime.evaluate', { expression: 'document.querySelector("iframe").remove()' });
    await bounded(detached, 'iframe detach');
    assert.ok(s.frame._isDetached());
  }
}
async function cleanup(s) {
  await bounded(s.browser.close(), 'browser teardown');
}
async function terminalRace(world, event, missing = false) {
  const s = await setup(world);
  const apiWorld = world === 'iframe' ? 'main' : world;
  resetWorld(s.frame, world);
  const gate = holdAcquisition(s.frame, world, { missing });
  const session = s.impl.delegate._sessionForFrame(s.frame);
  const originalRegister = session._onExecutionContextCreated;
  let terminal = false, staleRegistrations = 0;
  session._onExecutionContextCreated = function(...args) {
    if (terminal) staleRegistrations++;
    return originalRegister.apply(this, args);
  };
  try {
    const pending = observe(s.frame._context(apiWorld));
    await bounded(gate.ready, 'held successful context result');
    await terminate(s, event);
    terminal = true;
    gate.release();
    const outcome = await bounded(pending, 'pending acquisition');
    assert.equal(staleRegistrations, 0, 'no context registration after terminal transition');
    await mustReject(outcome.error ? Promise.reject(outcome.error) : Promise.resolve(outcome.value));
    await mustReject(s.frame._context(apiWorld));
    assert.equal(gate.calls(), 1, 'terminal acquisition must not send another CDP request');
  } finally {
    gate.restore();
    session._onExecutionContextCreated = originalRegister;
    await cleanup(s);
  }
}
async function cachedTerminal(event) {
  const s = await setup();
  try {
    await s.frame._context('main');
    await s.frame._context('utility');
    await terminate(s, event);
    // Cached contexts also pass through the entry lifecycle guard.
    assert.ok(s.frame._mainWorld && s.frame._isolatedWorld);
    await mustReject(s.frame._context('main'));
    await mustReject(s.frame._context('utility'));
  } finally { await cleanup(s); }
}
async function liveRetry(world) {
  const s = await setup(world);
  const apiWorld = world === 'iframe' ? 'main' : world;
  resetWorld(s.frame, world);
  // The iframe path falls back to top-level acquisition on a missing ID and
  // does not promise identical concurrent results in unpatched 1.63.0. Check
  // its successful coalescing here; main/utility exercise live missing-ID retry.
  const gate = holdAcquisition(s.frame, world, { missing: world !== 'iframe' });
  try {
    const first = s.frame._context(apiWorld);
    const second = s.frame._context(apiWorld);
    await bounded(gate.ready, 'live missing ID');
    assert.equal(gate.calls(), 1, 'concurrent acquisition is coalesced');
    gate.release();
    const [a, b] = await bounded(Promise.all([first, second]), 'live retry');
    assert.ok(a === b, 'concurrent successful acquisitions share one context');
    assert.equal(gate.calls(), world === 'iframe' ? 1 : 2);
    assert.equal(await a.evaluateExpression('1 + 1', {}), 2);
    assert.ok(await s.frame._context(apiWorld));
  } finally { gate.restore(); await cleanup(s); }
}
async function liveNavigation(world) {
  const s = await setup(world);
  resetWorld(s.frame, world);
  const gate = holdAcquisition(s.frame, world);
  const apiWorld = world === 'iframe' ? 'main' : world;
  try {
    const pending = s.frame._context(apiWorld);
    await bounded(gate.ready, 'old navigation context');
    if (world === 'iframe') {
      await s.page.frames()[1].goto(origin + '/after');
    } else await s.page.goto(origin + '/after');
    gate.release();
    const acquired = await bounded(pending, 'new navigation context');
    assert.ok(acquired === await s.frame._context(apiWorld), 'navigation result is the current cached context');
    assert.equal(await acquired.evaluateExpression('document.title', {}), '/after');
    assert.ok(gate.calls() >= 2, 'navigation invalidates the held acquisition promise');
  } finally { gate.restore(); await cleanup(s); }
}
async function run(name, fn) {
  console.error(`CASE ${name}`);
  await fn();
  cases.push(name);
}
try {
  for (const world of ['main', 'utility']) {
    for (const event of ['crash', 'page-close', 'context-close', 'disconnect']) {
      await run(`${world}:${event}:late-success`, () => terminalRace(world, event));
    }
    await run(`${world}:crash:missing-id`, () => terminalRace(world, 'crash', true));
  }
  await run('iframe:detach:late-success', () => terminalRace('iframe', 'detach'));
  for (const event of ['crash', 'page-close', 'context-close', 'disconnect']) {
    await run(`cached:${event}`, () => cachedTerminal(event));
  }
  for (const world of ['main', 'utility', 'iframe']) {
    await run(`${world}:${world === 'iframe' ? 'live-coalescing' : 'live-retry'}`, () => liveRetry(world));
    await run(`${world}:live-navigation`, () => liveNavigation(world));
  }
  console.log(JSON.stringify({ result: 'PASS', cases }));
} finally { web.closeAllConnections(); await new Promise(resolve => web.close(resolve)); }
