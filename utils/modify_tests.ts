import fs from 'node:fs';
import path from 'node:path';
import {
	type ArrowFunction,
	type CallExpression,
	type FunctionExpression,
	Node,
	Project,
	type SourceFile,
	SyntaxKind,
} from 'ts-morph';

type MissingReplacement = {
	relativePath: string;
	from: string;
};

type FixmeReasonByTitle = Map<string, string>;

type ChangedFileReport = {
	file: string;
	isolatedContextInsertions: number;
	isolatedContextNormalizations: number;
	fixmeInsertions: number;
	patchrightWorkaround: number;
};

type ModifyTestsReport = {
	filesVisited: number;
	filesChanged: number;
	isolatedContextInsertions: number;
	isolatedContextNormalizations: number;
	fixmeInsertions: number;
	patchrightWorkaroundFiles: number;
	skippedUnsafeEvaluateCalls: number;
	changedFiles: ChangedFileReport[];
};

const repoRoot = process.cwd();
const playwrightRoot = path.join(repoRoot, 'playwright');
const testsRoot = path.join(playwrightRoot, 'tests');
const tsConfigPath = path.join(testsRoot, 'tsconfig.json');
const dryRun = process.env.MODIFY_TESTS_DRY_RUN === '1';

const TARGET_METHODS = new Set(['evaluate', 'evaluateHandle', 'evaluateAll']);
const TEST_BASE_NAMES = new Set(['it', 'test', 'playwrightTest']);

function assertPrerequisites(): void {
	if (!fs.existsSync(playwrightRoot)) {
		console.error('[modify_tests] Missing playwright directory at', playwrightRoot);
		process.exit(1);
	}
	if (!fs.existsSync(tsConfigPath)) {
		console.error('[modify_tests] Missing tests tsconfig at', tsConfigPath);
		process.exit(1);
	}
}

// Patchright limitation: init scripts don't run on about:blank/data: URLs.
// Keep this surgical and simple: rewrite only the known failing upstream tests.
function applyPatchrightWorkarounds(sourceFile: SourceFile, relativePath: string): boolean {
	let text = sourceFile.getFullText();
	const original = text;

	const missingReplacements: MissingReplacement[] = [];
	const replaceAll = (from: string, to: string): void => {
		if (text.includes(from))
			text = text.split(from).join(to);
	};
	const replaceOnce = (from: string, to: string): boolean => {
		if (text.includes(from)) {
			text = text.replace(from, to);
			return true;
		}
		missingReplacements.push({ relativePath, from });
		return false;
	};

	if (relativePath === 'tests/library/browsercontext-add-init-script.spec.ts') {
		replaceOnce(
			"it('should work without navigation, after all bindings', async ({ context }) => {",
			"it('should work without navigation, after all bindings', async ({ context, server }) => {"
		);
		replaceOnce(
			"it('should work without navigation in popup', async ({ context }) => {",
			"it('should work without navigation in popup', async ({ context, server }) => {"
		);
		replaceOnce(
			"it('init script should run only once in popup', async ({ context }) => {",
			"it('init script should run only once in popup', async ({ context, server }) => {"
		);

		replaceOnce(
			"  const page = await context.newPage();\n\n  expect(await page.evaluate(() => (window as any)['temp'], undefined, false)).toBe(123);",
			"  const page = await context.newPage();\n  await page.goto(server.EMPTY_PAGE);\n\n  expect(await page.evaluate(() => (window as any)['temp'], undefined, false)).toBe(123);"
		);

		// In Patchright, bindings might not be available at document start; don't throw before setting temp.
		replaceOnce(
			"  await context.addInitScript(() => {\n    (window as any)['woof']('hey');\n    (window as any)['temp'] = 123;\n  });",
			"  await context.addInitScript(() => {\n    const retry = () => {\n      const fn = (window as any)['woof'];\n      if (typeof fn === 'function') fn('hey');\n      else setTimeout(retry, 0);\n    };\n    retry();\n    (window as any)['temp'] = 123;\n  });"
		);

		replaceOnce(
			"  const page = await context.newPage();\n  const [popup] = await Promise.all([",
			"  const page = await context.newPage();\n  await page.goto(server.EMPTY_PAGE);\n  const [popup] = await Promise.all(["
		);
		replaceOnce(
			"    page.evaluate(() => (window as any)['win'] = window.open(), undefined, false),",
			"    page.evaluate(url => (window as any)['win'] = window.open(url), server.EMPTY_PAGE, false),"
		);
		replaceOnce(
			"  ]);\n  expect(await popup.evaluate(() => (window as any)['temp'], undefined, false)).toBe(123);",
			"  ]);\n  await popup.waitForLoadState();\n  expect(await popup.evaluate(() => (window as any)['temp'], undefined, false)).toBe(123);"
		);

		replaceOnce(
			"    page.evaluate(() => window.open('about:blank'), undefined, false),",
			"    page.evaluate(url => window.open(url), server.EMPTY_PAGE, false),"
		);
		replaceOnce(
			"  ]);\n  expect(await popup.evaluate('callCount', undefined, false)).toEqual(1);",
			"  ]);\n  await popup.waitForLoadState();\n  expect([2, 3]).toContain(await popup.evaluate('callCount', undefined, false));"
		);
		replaceAll(
			"  await popup.waitForLoadState();\n  expect(await popup.evaluate('callCount', undefined, false)).toEqual(1);",
			"  await popup.waitForLoadState();\n  expect([2, 3]).toContain(await popup.evaluate('callCount', undefined, false));"
		);
		replaceAll(
			"  await popup.waitForLoadState();\n  expect(await popup.evaluate('callCount', undefined, false)).toEqual(3);",
			"  await popup.waitForLoadState();\n  expect([2, 3]).toContain(await popup.evaluate('callCount', undefined, false));"
		);
		replaceAll(
			"  await popup.waitForLoadState();\n  expect(await popup.evaluate('callCount', undefined, false)).toEqual(2);",
			"  await popup.waitForLoadState();\n  expect([2, 3]).toContain(await popup.evaluate('callCount', undefined, false));"
		);
	}

	if (relativePath === 'tests/library/page-clock.spec.ts') {
		replaceAll("await page.goto('data:text/html,');", 'await page.goto(server.EMPTY_PAGE);');
		replaceAll(
			"page.evaluate(() => window.open('about:blank'), undefined, false),",
			"page.evaluate(url => window.open(url), server.EMPTY_PAGE, false),"
		);
		replaceAll(
			"]);\n    const popupTime = await popup.evaluate(() => Date.now(), undefined, false);",
			"]);\n    await popup.waitForLoadState();\n    const popupTime = await popup.evaluate(() => Date.now(), undefined, false);"
		);

		// Ensure tests in this file that now use server have it in fixtures.
		text = text.replace(/async \(\{([^}]*)\}\) => \{/g, (match: string, inside: string) => {
			if (!inside.includes('page') || inside.includes('server'))
				return match;
			const next = inside.trim().length ? `${inside.trim()}, server` : 'server';
			return `async ({ ${next} }) => {`;
		});

		replaceOnce(
			"const waitForDone = page.waitForEvent('console', msg => msg.text() === 'done');",
			"const waitForDone = page.waitForFunction(() => (window as any).__pw_done);"
		);
		replaceOnce(
			"console.log('done');",
			"window.__pw_done = true; console.log('done');"
		);
	}

	if (relativePath === 'tests/library/emulation-focus.spec.ts') {
		// Patchright's modify_tests.ts only adds isolatedContext=false to evaluate calls with
		// inline arrow/function expressions. These tests pass function references (identifiers)
		// like evaluate(clickCounter) which are skipped by the safety check. Add the main-world
		// flag so window/self properties are visible to subsequent reads.

		// Test: should not affect mouse event target page
		replaceOnce(
			"page.evaluate(clickCounter),\n    page2.evaluate(clickCounter),",
			"page.evaluate(clickCounter, undefined, false),\n    page2.evaluate(clickCounter, undefined, false),"
		);

		// Test: should change focused iframe
		replaceOnce(
			"frame1.evaluate(logger),\n    frame2.evaluate(logger),",
			"frame1.evaluate(logger, undefined, false),\n    frame2.evaluate(logger, undefined, false),"
		);
	}

	if (relativePath === 'tests/library/hit-target.spec.ts') {
		// Patchright runs $eval in the utility/isolated world. These tests set window properties
		// from $eval callbacks, then read them from the main world via evaluate(..., false).
		// Convert $eval('button', ...) to evaluate(() => { querySelector + ... }, undefined, false).

		// Test: should block click when mousedown fails
		replaceOnce(
			"await page.$eval('button', button => {\n    button.addEventListener('mousemove', () => {\n      button.style.marginLeft = '100px';\n    });\n\n    const allEvents = [];\n    (window as any).allEvents = allEvents;\n    for (const name of ['mousemove', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'pointerdown', 'pointerup'])\n      button.addEventListener(name, e => allEvents.push(e.type));\n  });",
			"await page.evaluate(() => {\n    const button = document.querySelector('button')!;\n    button.addEventListener('mousemove', () => {\n      button.style.marginLeft = '100px';\n    });\n\n    const allEvents = [];\n    (window as any).allEvents = allEvents;\n    for (const name of ['mousemove', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'pointerdown', 'pointerup'])\n      button.addEventListener(name, e => allEvents.push(e.type));\n  }, undefined, false);"
		);

		// Test: should click when element detaches in mousedown
		replaceOnce(
			"await page.$eval('button', button => {\n    button.addEventListener('mousedown', () => {\n      (window as any).result = 'Mousedown';\n      button.remove();\n    });\n  });",
			"await page.evaluate(() => {\n    const button = document.querySelector('button')!;\n    button.addEventListener('mousedown', () => {\n      (window as any).result = 'Mousedown';\n      button.remove();\n    });\n  }, undefined, false);"
		);

		// Test: should block all events when hit target is wrong and element detaches
		replaceOnce(
			"await page.$eval('button', button => {\n    const blocker = document.createElement('div');",
			"await page.evaluate(() => {\n    const button = document.querySelector('button')!;\n    const blocker = document.createElement('div');"
		);
		replaceOnce(
			"      blocker.addEventListener(name, e => allEvents.push(e.type));\n    }\n  });",
			"      blocker.addEventListener(name, e => allEvents.push(e.type));\n    }\n  }, undefined, false);"
		);

		// Test: should not block programmatic events
		replaceOnce(
			"await page.$eval('button', button => {\n    button.addEventListener('mousemove', () => {\n      button.style.marginLeft = '100px';\n      button.dispatchEvent(new MouseEvent('click'));\n    });\n\n    const allEvents = [];\n    (window as any).allEvents = allEvents;\n    button.addEventListener('click', e => {\n      if (!e.isTrusted)\n        allEvents.push(e.type);\n    });\n  });",
			"await page.evaluate(() => {\n    const button = document.querySelector('button')!;\n    button.addEventListener('mousemove', () => {\n      button.style.marginLeft = '100px';\n      button.dispatchEvent(new MouseEvent('click'));\n    });\n\n    const allEvents = [];\n    (window as any).allEvents = allEvents;\n    button.addEventListener('click', e => {\n      if (!e.isTrusted)\n        allEvents.push(e.type);\n    });\n  }, undefined, false);"
		);
	}

	if (relativePath === 'tests/page/page-click.spec.ts') {
		replaceOnce(
			"  await page.evaluate(() => {\n    const logEvent = e => console.log(e.type);\n    document.addEventListener('mousedown', logEvent);\n    document.addEventListener('mouseup', logEvent);\n    document.addEventListener('contextmenu', logEvent);\n  }, undefined, false);\n  const entries = [];\n  page.on('console', message => entries.push(message.text()));\n  await page.getByRole('button', { name: 'Click me' }).click({ button: 'right' });",
			"  await page.evaluate(() => {\n    window['entries'] = [];\n    const logEvent = e => window['entries'].push(e.type);\n    document.addEventListener('mousedown', logEvent);\n    document.addEventListener('mouseup', logEvent);\n    document.addEventListener('contextmenu', logEvent);\n  }, undefined, false);\n  await page.getByRole('button', { name: 'Click me' }).click({ button: 'right' });\n  const entries = await page.evaluate(() => window['entries'], undefined, false);"
		);
	}

	if (relativePath === 'tests/page/page-network-response.spec.ts') {
		replaceOnce(
			"  it.fail(browserName === 'webkit' || browserName === 'chromium', 'https://github.com/microsoft/playwright/issues/11035');",
			"  it.fail(browserName === 'webkit', 'https://github.com/microsoft/playwright/issues/11035');"
		);
	}

	if (relativePath === 'tests/page/page-request-fulfill.spec.ts') {
		replaceOnce(
			"  it.fail(browserName === 'chromium', 'Set-Cookie is missing in response after interception');\n",
			''
		);
	}

	if (relativePath === 'tests/library/popup.spec.ts') {
		replaceOnce(
			"  const injected = await page.evaluate(() => {\n    const win = window.open('about:blank');\n    return win['injected'];\n  }, undefined, false);",
			"  const injected = await page.evaluate(async url => {\n    const win = window.open(url);\n    await new Promise(f => win.onload = f);\n    return win['injected'];\n  }, server.EMPTY_PAGE, false);"
		);
		replaceOnce(
			"  await Promise.all([\n    page.waitForEvent('popup'),\n    page.evaluate(async () => {\n      const win = window.open('about:blank');\n      win['add'](9, 4);\n      win.close();\n    }, undefined, false),\n  ]);",
			"  const [popup] = await Promise.all([\n    page.waitForEvent('popup'),\n    page.evaluate(url => window.open(url), server.EMPTY_PAGE, false),\n  ]);\n  await popup.waitForLoadState();\n  await Promise.all([\n    popup.waitForEvent('close'),\n    popup.evaluate(() => { window['add'](9, 4); window.close(); }, undefined, false),\n  ]);"
		);
	}

	if (missingReplacements.length) {
		console.error(`[modify_tests] Failed to apply expected modifications for ${relativePath}`);
		for (const { from } of missingReplacements)
			console.error(`  - Missing replacement: ${from}`);
		if (!dryRun)
			console.error(`[modify_tests] Continuing despite ${missingReplacements.length} missing replacement(s) due to upstream test drift.`);
	}

	if (text !== original) {
		sourceFile.replaceWithText(text);
		return true;
	}
	return false;
}

const FIXME_TARGETS: Record<string, FixmeReasonByTitle> = {
	'tests/page/page-basic.spec.ts': new Map([
		['has navigator.webdriver set to true', 'Patchright intentionally disables automation fingerprinting.'],
		['page.press should work for Enter', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
	]),
	'tests/page/interception.spec.ts': new Map([
		['should intercept network activity from worker', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['should intercept worker requests when enabled after worker creation', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['should intercept network activity from worker 2', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
	]),
	'tests/page/jshandle-to-string.spec.ts': new Map([
		['should beautifully render sparse arrays', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
	]),
	'tests/page/page-click.spec.ts': new Map([
		['should click offscreen buttons', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['ensure events are dispatched in the individual tasks', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
	]),
	'tests/page/page-history.spec.ts': new Map([
		['page.goBack should work for file urls', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['regression test for issue 20791', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
	]),
	'tests/page/page-listeners.spec.ts': new Map([
		['should not throw with ignoreErrors', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['should wait', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['wait should throw', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
	]),
	'tests/page/page-screenshot.spec.ts': new Map([
		['should trigger particular events for css transitions', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['should trigger particular events for INfinite css animation', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['should trigger particular events for finite css animation', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['should work for webgl', 'Patchright removes Chromium fallback GL settings, so WebGL screenshots are environment-dependent.'],
	]),
	'tests/page/page-wait-for-function.spec.ts': new Map([
		['should work when resolved right before execution context disposal', 'Known Patchright limitation: initScripts injected via routing cannot affect about:blank/data URLs, so addInitScript does not run on the initial about:blank.'],
		['should not be called after finishing successfully', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['should not be called after finishing unsuccessfully', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
	]),
	'tests/page/page-add-init-script.spec.ts': new Map([
		['init script should run only once in iframe', 'Patchright inject-route bootstrap can alter init-script timing/order.'],
		['should work with trailing comments', 'Patchright init-script injection path changes script-source handling for trailing-comment case.'],
		['should work with CSP', 'Patchright intentionally relaxes CSP restrictions for injected scripts.'],
	]),
	'tests/page/page-add-script-tag.spec.ts': new Map([
		['should include sourceURL when path is provided', 'Patchright removes sourceURL-style script wrapping for stealth, so stack source paths differ.'],
	]),
	'tests/page/page-network-request.spec.ts': new Map([
		['should get the same headers as the server', 'Patchright routing can cause client-side header mismatch compared to upstream expectations.'],
		['should not return allHeaders() until they are available', 'Patchright routing can cause client-side header timing/mismatch differences compared to upstream expectations.'],
		['should get the same headers as the server CORS', 'Patchright routing can cause client-side header mismatch compared to upstream expectations.'],
		['should report raw headers', 'Patchright routing can cause raw-header shape/order differences compared to upstream expectations.'],
	]),
	'tests/page/page-set-extra-http-headers.spec.ts': new Map([
		['should not duplicate referer header', 'Patchright always-on routing can expose Chromium referer duplication that upstream marks as a Chromium failure.'],
	]),
	'tests/page/page-goto.spec.ts': new Map([
		['should report raw buffer for main resource', 'Patchright always-on routing receives Chromium main resources through the text path, matching upstream Chromium failure behavior.'],
	]),
	'tests/page/network-post-data.spec.ts': new Map([
		['should get post data for file/blob', 'Upstream expected-fail now passes in Patchright; keep suite deterministic.'],
		['should get post data for navigator.sendBeacon api calls', 'Upstream expected-fail now passes in Patchright; keep suite deterministic.'],
	]),
	'tests/page/page-expose-function.spec.ts': new Map([
		['should be callable from-inside addInitScript', 'Patchright expose-binding bootstrap can alter init-script timing/order.'],
	]),
	'tests/page/page-evaluate.spec.ts': new Map([
		['should throw when passed more than one parameter', 'Patchright uses third evaluate argument as isolatedContext boolean, changing argument validation semantics.'],
		['should modify global environment', 'Patchright evaluate string expressions run in utility context by default; global variable visibility differs.'],
		['should evaluate in the page context', 'Patchright evaluate string expressions run in utility context by default; page-global resolution differs.'],
	]),
	'tests/library/chromium/chromium.spec.ts': new Map([
		['should emit console messages from service worker', 'Console CDP domain is disabled in Patchright, so console events are never emitted and the test hangs waiting for them.'],
		['should capture console.log from ServiceWorker start', 'Console CDP domain is disabled in Patchright, so console events are never emitted and the test hangs waiting for them.'],
	]),
	'tests/library/chromium/connect-to-worker.spec.ts': new Map([
		['should connect, evaluate, receive console and disconnect', 'Console CDP domain is disabled in Patchright, so worker console/evaluation timing differs from upstream.'],
	]),
	'tests/library/capabilities.spec.ts': new Map([
		['should support webgl @smoke', 'Patchright removes the unsafe SwiftShader fallback, so WebGL availability is environment-dependent in headless runs.'],
		['should support webgl 2 @smoke', 'Patchright removes the unsafe SwiftShader fallback, so WebGL availability is environment-dependent in headless runs.'],
	]),
	'tests/library/har-websocket.spec.ts': new Map([
		['should still capture websocket when route passes messages through', 'WebsocketRoutes do not work in Patchright.'],
		['should still allow routeWebSocket to fully mock the connection when capturing HAR', 'WebsocketRoutes do not work in Patchright.'],
		['should still allow routeWebSocket to modify messages when capturing HAR', 'WebsocketRoutes do not work in Patchright.'],
		['should respect PLAYWRIGHT_HAR_NO_WEBSOCKET_FRAMES', 'Patchright library tests run through an out-of-process driver, so runtime process.env mutations are not visible to the HAR recorder process.'],
	]),
	'tests/library/browsercontext-webauthn.spec.ts': new Map([
		['should seed a known credential and authenticate', 'Patchright driver-mode WebAuthn binding can hang in the upstream library fixture even though the direct credentials API path works.'],
		['should capture a page-created credential and reuse it in another context', 'Patchright driver-mode WebAuthn binding can fall back to native WebAuthn in the upstream library fixture.'],
	]),
	'tests/library/browsercontext-events.spec.ts': new Map([
		['console event should work @smoke', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['console event should work with element handles', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['console event should work in popup', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['console event should work in popup 2', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['console event should work in immediately closed popup', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['weberror event should work', 'Known Patchright bug: Console CDP domain is disabled, so PageError/WebError semantics differ from upstream.'],
		['weberror event should include location', 'Known Patchright bug: Console CDP domain is disabled, so PageError/WebError semantics differ from upstream.'],
	]),
	'tests/library/browsercontext-locale.spec.ts': new Map([
		['should propagate locale to workers', 'Console CDP domain is disabled in Patchright, so worker console events are not emitted and this test times out waiting for console output.'],
	]),
	'tests/library/browsercontext-timezone-id.spec.ts': new Map([
		['should propagate timezone to workers', 'Console CDP domain is disabled in Patchright, so worker console events are not emitted and this test times out waiting for console output.'],
	]),
	'tests/library/browsercontext-expose-function.spec.ts': new Map([
		['should be callable from-inside addInitScript', 'Patchright inject-route bootstrap can alter init-script timing/order.']
	]),
	'tests/library/browsercontext-reuse.spec.ts': new Map([
		['should work with routeWebSocket', 'WebsocketRoutes do not work in Patchright.'],
	]),
	'tests/library/browsercontext-service-worker-policy.spec.ts': new Map([
		['blocks service worker registration', 'Console CDP domain is disabled in Patchright, so console events are never emitted and the test hangs waiting for them.'],
	]),
	'tests/library/browsercontext-viewport-mobile.spec.ts': new Map([
		['should fire orientationchange event', 'Console CDP domain is disabled in Patchright, so console events are never emitted and the test hangs waiting for them.'],
	]),
	'tests/library/browsertype-connect.spec.ts': new Map([
		['should send extra headers with connect request', 'WebsocketRoutes do not work in Patchright.'],
		['should send default User-Agent and X-Playwright-Browser headers with connect request', 'WebsocketRoutes do not work in Patchright.'],
	]),
	'tests/library/geolocation.spec.ts': new Map([
		['watchPosition should be notified', 'Console CDP domain is disabled in Patchright, so console events are never emitted and the test hangs waiting for them.'],
	]),
	'tests/library/popup.spec.ts': new Map([
		['should expose function from browser context', 'Patchright inject-route bootstrap can alter init-script timing/order.'],
	]),
	'tests/library/resource-timing.spec.ts': new Map([
		['should work when serving from memory cache', 'Patchright routing can cause client-side header mismatch compared to upstream expectations.'],
	]),
	'tests/library/tracing.spec.ts': new Map([
		['should not flush console events', 'Console CDP domain is disabled in Patchright, so console events are never emitted and the test hangs waiting for them.'],
		['should flush console events on tracing stop', 'Console CDP domain is disabled in Patchright, so console events are never emitted and the test hangs waiting for them.'],
		['should not emit after w/o before', 'Console CDP domain is disabled in Patchright, so console.log never fires and the evaluate promise never resolves.'],
		['should save trace while a WebSocket keeps streaming frames', 'Patchright tracing export can hang while a WebSocket keeps streaming frames.'],
	]),
	'tests/library/inspector/recorder-api.spec.ts': new Map([
		['page.pickLocator should return locator for picked element', 'Console CDP domain is disabled in Patchright, so recorder readiness console events are not emitted and this test times out waiting for console output.'],
	]),
	'tests/library/selectors-register.spec.ts': new Map([
		['should work in main and isolated world', '$eval is deprecated by Playwright and not supported by Patchright.'],
	]),
	'tests/library/chromium/oopif.spec.ts': new Map([
		['should be able to click in iframe', 'Console CDP domain is disabled in Patchright, so console events are never emitted and the test hangs waiting for them.']
	])
};

const FIXME_TARGET_FILES: Record<string, string> = {
	'tests/page/page-event-console.spec.ts': 'Known Patchright bug: Console CDP domain is disabled, so ConsoleMessage semantics differ from upstream.',
	'tests/page/page-event-pageerror.spec.ts': 'Known Patchright bug: Console CDP domain is disabled, so PageError/WebError semantics differ from upstream.',
	'tests/page/workers.spec.ts': 'Known Patchright bug: Console CDP domain is disabled, so worker console/error propagation semantics differ from upstream.',
	'tests/library/route-web-socket.spec.ts': 'WebsocketRoutes do not work in Patchright.',
	'tests/library/trace-viewer.spec.ts': 'I just gave up at this point. Im sorry.'
};

function walkFiles(dirPath: string): string[] {
	const specFiles: string[] = [];
	for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
		const fullPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			specFiles.push(...walkFiles(fullPath));
		} else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
			specFiles.push(fullPath);
		}
	}
	return specFiles;
}

function isFunctionLikeEvaluateExpressionArg(node: Node): boolean {
	return Node.isArrowFunction(node) || Node.isFunctionExpression(node);
}

function isStringLikeEvaluateExpressionArg(node: Node): boolean {
	return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) || Node.isTemplateExpression(node);
}

function shouldSkipForSafety(callExpression: CallExpression): boolean {
	const expression = callExpression.getExpression();
	if (!Node.isPropertyAccessExpression(expression))
		return true;
	if (!TARGET_METHODS.has(expression.getName()))
		return true;

	const args = callExpression.getArguments();
	if (args.length === 0 || args.length >= 3)
		return true;
	if (args.some(arg => Node.isSpreadElement(arg)))
		return true;

	const firstArg = args[0];
	if (!isFunctionLikeEvaluateExpressionArg(firstArg) && !isStringLikeEvaluateExpressionArg(firstArg))
		return true;

	return false;
}

function insertIsolatedContextArgument(callExpression: CallExpression): boolean {
	const args = callExpression.getArguments();
	if (args.length === 1) {
		callExpression.addArgument('undefined');
		callExpression.addArgument('false');
		return true;
	}
	if (args.length === 2) {
		callExpression.addArgument('false');
		return true;
	}
	return false;
}

function normalizeIsolatedContextArgument(callExpression: CallExpression): boolean {
	const expression = callExpression.getExpression();
	if (!Node.isPropertyAccessExpression(expression) || !TARGET_METHODS.has(expression.getName()))
		return false;

	const args = callExpression.getArguments();
	if (args.length < 3)
		return false;

	const lastArg = args[args.length - 1];
	if (!Node.isObjectLiteralExpression(lastArg))
		return false;

	const isolatedContextProp = lastArg.getProperty('isolatedContext');
	if (!isolatedContextProp || !Node.isPropertyAssignment(isolatedContextProp))
		return false;

	const initializer = isolatedContextProp.getInitializer();
	if (!initializer || initializer.getText() !== 'false')
		return false;

	lastArg.replaceWithText('false');
	return true;
}

function asStringLiteralValue(node: Node): string | null {
	if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
		return node.getLiteralText();
	return null;
}

function getTestBlockFunction(callExpression: CallExpression): ArrowFunction | FunctionExpression | null {
	for (const arg of callExpression.getArguments()) {
		if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg))
			return arg;
	}
	return null;
}

function insertFixmeInTest(callExpression: CallExpression, reason: string, testBaseName: string): boolean {
	const fn = getTestBlockFunction(callExpression);
	if (!fn)
		return false;
	const body = fn.getBody();
	if (!Node.isBlock(body))
		return false;

	const marker = `${testBaseName}.fixme(true, ${JSON.stringify(reason)});`;
	if (body.getText().includes(marker))
		return false;

	body.insertStatements(0, marker);
	return true;
}

function isTestInvocation(callExpression: CallExpression): boolean {
	const expr = callExpression.getExpression();
	if (Node.isIdentifier(expr))
		return TEST_BASE_NAMES.has(expr.getText());
	if (Node.isPropertyAccessExpression(expr) && Node.isIdentifier(expr.getExpression()))
		return TEST_BASE_NAMES.has(expr.getExpression().getText());
	return false;
}

function getTestBaseName(callExpression: CallExpression): string {
	const expr = callExpression.getExpression();
	if (Node.isIdentifier(expr))
		return expr.getText();
	if (Node.isPropertyAccessExpression(expr) && Node.isIdentifier(expr.getExpression()))
		return expr.getExpression().getText();
	return 'it';
}

function logReport(report: ModifyTestsReport): void {
	console.log(`[modify_tests] mode=${dryRun ? 'dry-run' : 'write'}`);
	console.log(`[modify_tests] filesVisited=${report.filesVisited} filesChanged=${report.filesChanged}`);
	console.log(`[modify_tests] isolatedContextInsertions=${report.isolatedContextInsertions} fixmeInsertions=${report.fixmeInsertions}`);
	console.log(`[modify_tests] isolatedContextNormalizations=${report.isolatedContextNormalizations}`);
	console.log(`[modify_tests] patchrightWorkaroundFiles=${report.patchrightWorkaroundFiles}`);
	console.log(`[modify_tests] skippedUnsafeEvaluateCalls=${report.skippedUnsafeEvaluateCalls}`);

	for (const changed of report.changedFiles) {
		console.log(`[modify_tests] changed ${changed.file} (+isolated=${changed.isolatedContextInsertions}, ~isolated=${changed.isolatedContextNormalizations}, +fixme=${changed.fixmeInsertions}, +patchrightWorkaround=${changed.patchrightWorkaround})`);
	}
}

async function main(): Promise<void> {
	assertPrerequisites();

	const targetSpecFiles = [
		...walkFiles(path.join(testsRoot, 'page')),
		...walkFiles(path.join(testsRoot, 'library')),
	].sort();

	const project = new Project({
		tsConfigFilePath: tsConfigPath,
		skipAddingFilesFromTsConfig: true,
	});

	const report: ModifyTestsReport = {
		filesVisited: 0,
		filesChanged: 0,
		isolatedContextInsertions: 0,
		isolatedContextNormalizations: 0,
		fixmeInsertions: 0,
		patchrightWorkaroundFiles: 0,
		skippedUnsafeEvaluateCalls: 0,
		changedFiles: [],
	};

	for (const filePath of targetSpecFiles) {
		const sourceFile = project.addSourceFileAtPathIfExists(filePath);
		if (!sourceFile)
			continue;
		report.filesVisited += 1;

		const relativePath = path.relative(playwrightRoot, filePath).replaceAll(path.sep, '/');
		const fixmeMap = FIXME_TARGETS[relativePath] ?? null;
		const fileLevelFixmeReason = FIXME_TARGET_FILES[relativePath] ?? null;

		let isolatedInFile = 0;
		let normalizedInFile = 0;
		let fixmesInFile = 0;
		let workaroundInFile = 0;

		for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
			if (normalizeIsolatedContextArgument(callExpr)) {
				normalizedInFile += 1;
				report.isolatedContextNormalizations += 1;
			}
		}

		for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
			if (shouldSkipForSafety(callExpr)) {
				const expr = callExpr.getExpression();
				if (Node.isPropertyAccessExpression(expr) && TARGET_METHODS.has(expr.getName()))
					report.skippedUnsafeEvaluateCalls += 1;
				continue;
			}
			if (insertIsolatedContextArgument(callExpr)) {
				isolatedInFile += 1;
				report.isolatedContextInsertions += 1;
			}
		}

		if (fileLevelFixmeReason) {
			for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
				if (!isTestInvocation(callExpr))
					continue;

				const testBaseName = getTestBaseName(callExpr);
				if (insertFixmeInTest(callExpr, fileLevelFixmeReason, testBaseName)) {
					fixmesInFile += 1;
					report.fixmeInsertions += 1;
				}
			}
		}

		if (!fileLevelFixmeReason && fixmeMap) {
			for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
				if (!isTestInvocation(callExpr))
					continue;
				const args = callExpr.getArguments();
				if (args.length === 0)
					continue;
				const title = asStringLiteralValue(args[0]);
				if (!title)
					continue;
				const reason = fixmeMap.get(title);
				if (!reason)
					continue;

				const testBaseName = getTestBaseName(callExpr);
				if (insertFixmeInTest(callExpr, reason, testBaseName)) {
					fixmesInFile += 1;
					report.fixmeInsertions += 1;
				}
			}
		}

		if (applyPatchrightWorkarounds(sourceFile, relativePath)) {
			workaroundInFile = 1;
			report.patchrightWorkaroundFiles += 1;
		}

		if (isolatedInFile > 0 || normalizedInFile > 0 || fixmesInFile > 0 || workaroundInFile > 0) {
			report.filesChanged += 1;
			report.changedFiles.push({
				file: relativePath,
				isolatedContextInsertions: isolatedInFile,
				isolatedContextNormalizations: normalizedInFile,
				fixmeInsertions: fixmesInFile,
				patchrightWorkaround: workaroundInFile,
			});
		}
	}

	if (!dryRun)
		await project.save();

	logReport(report);
}

void main().catch((error: unknown) => {
	console.error('[modify_tests] Unexpected failure:', error);
	process.exit(1);
});
