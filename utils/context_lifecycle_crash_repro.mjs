// Public-API reproduction against the source-built driver; no internal hooks.
// Run in a disposable container with an EXTERNAL deadline; see docs/context-lifecycle.md.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { chromium } from '../playwright/packages/playwright-core/index.mjs';

const require = createRequire(import.meta.url);
const { name, version } = require('../playwright/packages/playwright-core/package.json');
assert.equal(name, 'playwright-core');
assert.equal(version, '1.63.0');
console.error(JSON.stringify({ driver: name, version }));
const watchdog = setTimeout(() => { console.error('NODE_WATCHDOG'); process.exit(3); }, 20_000);
const heartbeat = setInterval(() => console.error('NODE_HEARTBEAT'), 1000);
const site = http.createServer((req, res) => {
  if (req.url === '/hang') return;
  res.setHeader('content-type', 'text/html');
  res.end(req.url === '/crash' ? '<script src="/hang"></script>' : '<title>fixture</title>');
});
let browser;
try {
  site.listen(0, '127.0.0.1'); await once(site, 'listening');
  const origin = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  const cdp = await context.newCDPSession(page);
  page.once('crash', () => console.error('CRASH_EVENT'));
  page.once('framenavigated', () => {
    console.error('CRASH_SEND');
    void cdp.send('Page.crash').catch(() => {});
  });
  console.error('GOTO_BEGIN');
  await assert.rejects(page.goto(origin + '/crash', { waitUntil: 'domcontentloaded', timeout: 6000 }), /Page crashed/);
  console.error('GOTO_REJECTED_PAGE_CRASHED');
  await new Promise(resolve => setTimeout(resolve, 0));
  console.error('NODE_TIMER_RESPONSIVE');
} finally {
  console.error('CLOSE_BEGIN');
  await browser?.close();
  site.closeAllConnections(); site.close();
  clearTimeout(watchdog); clearInterval(heartbeat);
  console.error('CLOSE_END');
}
