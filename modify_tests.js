import fs from 'node:fs';
import path from 'node:path';
import { Project, Node, SyntaxKind } from 'ts-morph';

const repoRoot = process.cwd();
const playwrightRoot = path.join(repoRoot, 'playwright');
const testsRoot = path.join(playwrightRoot, 'tests');
const tsConfigPath = path.join(testsRoot, 'tsconfig.json');
const dryRun = process.env.MODIFY_TESTS_DRY_RUN === '1';

if (!fs.existsSync(playwrightRoot)) {
	console.error('[modify_tests] Missing playwright directory at', playwrightRoot);
	process.exit(1);
}
if (!fs.existsSync(tsConfigPath)) {
	console.error('[modify_tests] Missing tests tsconfig at', tsConfigPath);
	process.exit(1);
}

const TARGET_METHODS = new Set(['evaluate', 'evaluateHandle', 'evaluateAll']);

// Patchright limitation: init scripts don't run on about:blank/data: URLs.
// Keep this surgical and simple: rewrite only the known failing upstream tests.
function applyPatchrightWorkarounds(sourceFile, relativePath) {
	let text = sourceFile.getFullText();
	const original = text;

	const replaceAll = (from, to) => {
		if (text.includes(from))
			text = text.split(from).join(to);
	};
	const replaceOnce = (from, to) => {
		if (text.includes(from))
			text = text.replace(from, to);
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
			"  ]);\n  await popup.waitForLoadState();\n  expect(await popup.evaluate('callCount', undefined, false)).toEqual(1);"
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
		text = text.replace(/async \(\{([^}]*)\}\) => \{/g, (full, inside) => {
			if (!inside.includes('page') || inside.includes('server'))
				return full;
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
		// Patchright's modify_tests.js only adds isolatedContext=false to evaluate calls with
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

	if (text !== original) {
		sourceFile.replaceWithText(text);
		return true;
	}
	return false;
}

const FIXME_TARGETS = {
	'tests/page/page-basic.spec.ts': new Map([
		['has navigator.webdriver set to true', 'Patchright intentionally disables automation fingerprinting.'],
		['page.press should work for Enter', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
	]),
	'tests/page/page-network-response.spec.ts': new Map([
		['should report if request was fromServiceWorker', 'Patchright routing/injection changes service-worker attribution semantics.'],
	]),
	'tests/page/page-event-request.spec.ts': new Map([
		['should report requests and responses handled by service worker', 'Patchright routing/injection changes service-worker attribution semantics.'],
		['should report requests and responses handled by service worker with routing', 'Patchright routing/injection changes service-worker attribution semantics.'],
		['should report navigation requests and responses handled by service worker', 'Patchright routing/injection changes service-worker attribution semantics.'],
		['should report navigation requests and responses handled by service worker with routing', 'Patchright routing/injection changes service-worker attribution semantics.'],
	]),
	'tests/page/interception.spec.ts': new Map([
		['should intercept after a service worker', 'Patchright routing order differs after service-worker interception.'],
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
		['should wait for fonts to load', 'Known Patchright divergence: page.screenshot does not reliably block on webfonts, so the expected timeout/message is not deterministic.'],
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
		['serviceWorker(), and fromServiceWorker() work', 'Patchright routing/injection changes service-worker attribution semantics.'],
		['should emit console messages from service worker', 'Console CDP domain is disabled in Patchright, so console events are never emitted and the test hangs waiting for them.'],
		['should capture console.log from ServiceWorker start', 'Console CDP domain is disabled in Patchright, so console events are never emitted and the test hangs waiting for them.'],
	]),
	'tests/page/selectors-css.spec.ts': new Map([
		['should work with attribute selectors', 'Patchright selector engines are not fully atomic compared to upstream expectations.'],
	]),
	'tests/page/selectors-frame.spec.ts': new Map([
		['should capture after the enter-frame', 'Patchright selector engines are not fully atomic compared to upstream expectations.'],
	]),
	'tests/page/selectors-text.spec.ts': new Map([
		['should waitForSelector with distributed elements', 'Patchright selector engines are not fully atomic compared to upstream expectations.'],
	]),
	'tests/library/browsercontext-events.spec.ts': new Map([
		['console event should work @smoke', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['console event should work with element handles', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['console event should work in popup', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['console event should work in popup 2', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['console event should work in immediately closed popup', 'Known Patchright bug: Console CDP domain is disabled, so console events/messages are not reliably available.'],
		['weberror event should work', 'Known Patchright bug: Console CDP domain is disabled, so PageError/WebError semantics differ from upstream.'],
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
	]),
	'tests/library/selectors-register.spec.ts': new Map([
		['should work in main and isolated world', '$eval is deprecated by Playwright and not supported by Patchright.'],
	]),
	'tests/library/chromium/oopif.spec.ts': new Map([
		['should be able to click in iframe', 'Console CDP domain is disabled in Patchright, so console events are never emitted and the test hangs waiting for them.']
	])
};

const FIXME_TARGET_FILES = {
	'tests/page/page-event-console.spec.ts': 'Known Patchright bug: Console CDP domain is disabled, so ConsoleMessage semantics differ from upstream.',
	'tests/page/page-event-pageerror.spec.ts': 'Known Patchright bug: Console CDP domain is disabled, so PageError/WebError semantics differ from upstream.',
	'tests/page/workers.spec.ts': 'Known Patchright bug: Console CDP domain is disabled, so worker console/error propagation semantics differ from upstream.',
	'tests/page/selectors-register.spec.ts': 'Known Patchright bug: selector engines are not fully atomic compared to upstream expectations.',
	'tests/page/selectors-react.spec.ts': 'Known Patchright bug: selector engines are not fully atomic compared to upstream expectations.',
	'tests/page/selectors-vue.spec.ts': 'Known Patchright bug: selector engines are not fully atomic compared to upstream expectations.',
	'tests/library/route-web-socket.spec.ts': 'WebsocketRoutes do not work in Patchright.',
};

const FIXME_TARGET_LINES = {
	'tests/page/expect-boolean.spec.ts': new Map([
		[79, 'Patchright matcher error-message formatting differs from upstream expectations.'],
		[93, 'Patchright matcher error-message formatting differs from upstream expectations.'],
		[120, 'Patchright matcher error-message formatting differs from upstream expectations.'],
		[226, 'Patchright matcher error-message formatting differs from upstream expectations.'],
		[355, 'Patchright matcher error-message formatting differs from upstream expectations.'],
		[362, 'Patchright matcher error-message formatting differs from upstream expectations.'],
		[466, 'Patchright matcher error-message formatting differs from upstream expectations.'],
	]),
	'tests/page/expect-matcher-result.spec.ts': new Map([
		[73, 'Patchright matcher result message formatting differs from upstream expectations.'],
		[125, 'Patchright matcher result message formatting differs from upstream expectations.'],
	]),
	'tests/page/expect-misc.spec.ts': new Map([
		[588, 'Patchright matcher log formatting differs from upstream expectations.'],
		[598, 'Patchright matcher log formatting differs from upstream expectations.'],
		[617, 'Patchright strict-mode error formatting differs from upstream expectations.'],
	]),
	'tests/page/expect-timeout.spec.ts': new Map([
		[20, 'Patchright timeout error formatting differs from upstream expectations.'],
		[48, 'Patchright timeout error formatting differs from upstream expectations.'],
	]),
	'tests/page/expect-to-have-text.spec.ts': new Map([
		[208, 'Patchright text-matcher error formatting differs from upstream expectations.'],
		[298, 'Patchright text-matcher error formatting differs from upstream expectations.'],
	]),
	'tests/page/matchers.misc.spec.ts': new Map([
		[28, 'Patchright no-element error formatting differs from upstream expectations.'],
	]),
	'tests/page/page-click-scroll.spec.ts': new Map([
		[81, 'Patchright force-click hidden input error wording differs from upstream expectations.'],
	]),
	'tests/page/page-click.spec.ts': new Map([
		[604, 'Patchright trial-click error wording differs from upstream expectations.'],
	]),
	'tests/page/page-select-option.spec.ts': new Map([
		[349, 'Patchright selectOption timeout error wording differs from upstream expectations.'],
		[379, 'Patchright selectOption timeout error wording differs from upstream expectations.'],
	]),
	'tests/page/page-strict.spec.ts': new Map([
		[41, 'Patchright strict-mode selector error formatting differs from upstream expectations.'],
	]),
	'tests/page/page-wait-for-selector-1.spec.ts': new Map([
		[171, 'Patchright multi-match click log formatting differs from upstream expectations.'],
	]),
	'tests/page/workers.spec.ts': new Map([
		[338, 'Patchright offline worker error wording differs from upstream expectations.'],
	]),
};

function walkFiles(dirPath) {
	const result = [];
	for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
		const fullPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			result.push(...walkFiles(fullPath));
		} else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
			result.push(fullPath);
		}
	}
	return result;
}

function isFunctionLikeEvaluateExpressionArg(node) {
	return Node.isArrowFunction(node) || Node.isFunctionExpression(node);
}

function isStringLikeEvaluateExpressionArg(node) {
	return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) || Node.isTemplateExpression(node);
}

function shouldSkipForSafety(callExpression) {
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

function insertIsolatedContextArgument(callExpression) {
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

function normalizeIsolatedContextArgument(callExpression) {
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

function asStringLiteralValue(node) {
	if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
		return node.getLiteralText();
	return null;
}

function getTestBlockFunction(callExpression) {
	for (const arg of callExpression.getArguments()) {
		if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg))
			return arg;
	}
	return null;
}

function insertFixmeInTest(callExpression, reason, testBaseName) {
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

function isTestInvocation(callExpression) {
	const expr = callExpression.getExpression();
	if (Node.isIdentifier(expr))
		return ['it', 'test', 'playwrightTest'].includes(expr.getText());
	if (Node.isPropertyAccessExpression(expr) && Node.isIdentifier(expr.getExpression()))
		return ['it', 'test', 'playwrightTest'].includes(expr.getExpression().getText());
	return false;
}

function getTestBaseName(callExpression) {
	const expr = callExpression.getExpression();
	if (Node.isIdentifier(expr))
		return expr.getText();
	if (Node.isPropertyAccessExpression(expr) && Node.isIdentifier(expr.getExpression()))
		return expr.getExpression().getText();
	return 'it';
}

const targetSpecFiles = [
	...walkFiles(path.join(testsRoot, 'page')),
	...walkFiles(path.join(testsRoot, 'library')),
].sort();

const project = new Project({
	tsConfigFilePath: tsConfigPath,
	skipAddingFilesFromTsConfig: true,
});

const report = {
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
	const sourceFile = project.addSourceFileAtPath(filePath);
	if (!sourceFile)
		continue;
	report.filesVisited += 1;

	const relativePath = path.relative(playwrightRoot, filePath).replaceAll(path.sep, '/');
	const fixmeMap = FIXME_TARGETS[relativePath] || null;
	const fileLevelFixmeReason = FIXME_TARGET_FILES[relativePath] || null;
	const fixmeLineMap = FIXME_TARGET_LINES[relativePath] || null;

	let isolatedInFile = 0;
	let normalizedInFile = 0;
	let fixmesInFile = 0;
	let workaroundInFile = 0;

	for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
		if (normalizeIsolatedContextArgument(callExpr)) {
			normalizedInFile += 1;
			report.isolatedContextNormalizations += 1;
			continue;
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

	if (!fileLevelFixmeReason && fixmeLineMap) {
		const targets = [...fixmeLineMap.entries()].sort((a, b) => b[0] - a[0]);
		for (const [targetLine, reason] of targets) {
			const candidates = sourceFile
				.getDescendantsOfKind(SyntaxKind.CallExpression)
				.filter(isTestInvocation)
				.map(callExpr => ({
					callExpr,
					lineDistance: Math.abs(callExpr.getStartLineNumber() - targetLine),
				}))
				.filter(candidate => candidate.lineDistance <= 6)
				.sort((a, b) => a.lineDistance - b.lineDistance || b.callExpr.getStartLineNumber() - a.callExpr.getStartLineNumber());

			if (candidates.length === 0)
				continue;

			const matchedCall = candidates[0].callExpr;
			const testBaseName = getTestBaseName(matchedCall);
			if (insertFixmeInTest(matchedCall, reason, testBaseName)) {
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

if (!dryRun) {
	await project.save();
}

console.log(`[modify_tests] mode=${dryRun ? 'dry-run' : 'write'}`);
console.log(`[modify_tests] filesVisited=${report.filesVisited} filesChanged=${report.filesChanged}`);
console.log(`[modify_tests] isolatedContextInsertions=${report.isolatedContextInsertions} fixmeInsertions=${report.fixmeInsertions}`);
console.log(`[modify_tests] isolatedContextNormalizations=${report.isolatedContextNormalizations}`);
console.log(`[modify_tests] patchrightWorkaroundFiles=${report.patchrightWorkaroundFiles}`);
console.log(`[modify_tests] skippedUnsafeEvaluateCalls=${report.skippedUnsafeEvaluateCalls}`);

for (const changed of report.changedFiles) {
	console.log(`[modify_tests] changed ${changed.file} (+isolated=${changed.isolatedContextInsertions}, ~isolated=${changed.isolatedContextNormalizations}, +fixme=${changed.fixmeInsertions}, +patchrightWorkaround=${changed.patchrightWorkaround})`);
}
