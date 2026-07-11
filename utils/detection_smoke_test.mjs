import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { chromium } from "../playwright/packages/playwright-core/index.mjs";

const pageHtml = `<!doctype html>
<button id="click">click</button>
<iframe src="/frame"></iframe>
<script>
  window.clicks = 0;
  document.querySelector('#click').addEventListener('click', () => ++window.clicks);
</script>`;

const frameHtml = "<!doctype html><p>frame</p>";

function evaluateInMainWorld(target, pageFunction, argument) {
  return target.evaluate(pageFunction, argument, false);
}

function detectLeaks() {
  const knownPlaywrightGlobals = [
    "__pwInitScripts",
    "__playwright__binding__",
    "__playwright__binding__controller__",
  ];
  const globals = Object.getOwnPropertyNames(globalThis).filter(
    (name) =>
      knownPlaywrightGlobals.includes(name) ||
      /^__(?:pw|playwright)/i.test(name),
  );

  return { webdriver: navigator.webdriver, globals };
}

async function detectRuntimeSerialization() {
  let stackReads = 0;
  const error = new Error("patchright-runtime-smoke");
  Object.defineProperty(error, "stack", {
    get() {
      stackReads++;
      return "";
    },
  });

  console.log(error);
  await new Promise((resolve) => setTimeout(resolve, 50));
  return stackReads;
}

async function assertUndetected(target, label) {
  const { webdriver, globals } = await evaluateInMainWorld(target, detectLeaks);
  assert.notEqual(webdriver, true, `${label}: navigator.webdriver is true`);
  assert.deepEqual(
    globals,
    [],
    `${label}: Playwright globals leaked: ${globals.join(", ")}`,
  );

  const stackReads = await evaluateInMainWorld(
    target,
    detectRuntimeSerialization,
  );
  assert.equal(
    stackReads,
    0,
    `${label}: Runtime/Console serialization read Error.stack ${stackReads} time(s)`,
  );
}

async function startTestServer() {
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(request.url === "/frame" ? frameHtml : pageHtml);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert(address && typeof address === "object");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function main() {
  const { server, origin } = await startTestServer();
  const userDataDir = await mkdtemp(
    path.join(os.tmpdir(), "patchright-detection-"),
  );
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chrome",
      headless: false,
      viewport: null,
    });

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(origin);
    await assertUndetected(page, "initial page");

    await page.locator("#click").click();
    assert.equal(await evaluateInMainWorld(page, () => globalThis.clicks), 1);
    await context.addInitScript(() => {
      globalThis.userInitScript = true;
    });
    await context.exposeFunction("userBinding", () => 42);
    await page.reload();
    assert.equal(
      await evaluateInMainWorld(page, () => globalThis.userInitScript),
      true,
    );
    assert.equal(
      await evaluateInMainWorld(page, () => globalThis.userBinding()),
      42,
    );
    await assertUndetected(page, "automated page");

    const frame = page
      .frames()
      .find((candidate) => candidate !== page.mainFrame());
    assert(frame, "iframe was not created");
    await assertUndetected(frame, "iframe");

    const popupPromise = page.waitForEvent("popup");
    await evaluateInMainWorld(page, (url) => open(url), `${origin}/popup`);
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await assertUndetected(popup, "popup");
  } finally {
    await context?.close();
    server.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}

await main();
console.log("Patchright detection smoke test passed");
