import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// -----------------------------------
// server/chromium/crNetworkManager.ts
// -----------------------------------
export function patchCRNetworkManager(project: Project) {
	// Add source file to the project
	const crNetworkManagerSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crNetworkManager.ts");
	// Add the custom import and comment at the start of the file
	crNetworkManagerSourceFile.addImportDeclaration({
		moduleSpecifier: "crypto",
		defaultImport: "crypto",
	});

	// ------- CRNetworkManager Class -------
	const crNetworkManagerClass = crNetworkManagerSourceFile.getClassOrThrow("CRNetworkManager");
	crNetworkManagerClass.addProperties([
		{ name: "_alreadyTrackedNetworkIds", type: "Set<string>", initializer: "new Set()" },
	]);

	//  -- removeSession Method --
	const removeSessionMethod = crNetworkManagerClass.getMethodOrThrow("removeSession");
	// Clean up tracked network IDs when sessions are removed to avoid unbounded growth.
	const removeSessionBody = removeSessionMethod.getBodyOrThrow().asKindOrThrow(SyntaxKind.Block);
	const deleteSessionStatementIndex = removeSessionBody
		.getStatements()
		.findIndex(s => s.getText().includes("this._sessions.delete(session)"));
	if (deleteSessionStatementIndex !== -1)
		removeSessionBody.insertStatements(deleteSessionStatementIndex + 1, "if (!this._sessions.size) this._alreadyTrackedNetworkIds.clear();")

	// -- _onRequest Method --
	const onRequestMethod = crNetworkManagerClass.getMethodOrThrow("_onRequest");
	// Find the assignment statement you want to modify
	const routeAssignment = assertDefined(
		onRequestMethod
			.getDescendantsOfKind(SyntaxKind.BinaryExpression)
			.find((expr) => expr.getText().includes("route = new RouteImpl(requestPausedSessionInfo!.session, requestPausedEvent.requestId)"))
	);
	// Adding new parameter to the RouteImpl call
	routeAssignment.getRight().replaceWithText(
		"new RouteImpl(requestPausedSessionInfo!.session, requestPausedEvent.requestId, this._page, requestPausedEvent.networkId ?? requestPausedEvent.requestId, this)",
	);

	// -- _updateProtocolRequestInterceptionForSession Method --
	const updateProtocolRequestInterceptionForSessionMethod = crNetworkManagerClass.getMethodOrThrow("_updateProtocolRequestInterceptionForSession");
	// Replace cache disabled logic: keep cache enabled unless user has route interceptors
	updateProtocolRequestInterceptionForSessionMethod
		.getStatements()
		.filter((statement) => statement.getText().includes("const cachePromise = info.session.send('Network.setCacheDisabled', { cacheDisabled: enabled });"))
		.forEach((statement) => {
			statement.replaceWithText(`
				const hasHarRecorders = !!this._page?.browserContext?._harRecorders?.size;
				const userInterception = this._page ? this._page.needsRequestInterception() : false;
				const cachePromise = info.session.send('Network.setCacheDisabled', { cacheDisabled: userInterception || hasHarRecorders });
			`);
		});

	// -- setRequestInterception Method --
	// Always update cache state so user-added routes trigger cache bypass
	const setRequestInterceptionMethod = crNetworkManagerClass.getMethodOrThrow("setRequestInterception");
	setRequestInterceptionMethod
		.getBodyOrThrow()
		.asKindOrThrow(SyntaxKind.Block)
		.addStatements(`
			if (this._page)
				await this._forEachSession(info => info.session.send('Network.setCacheDisabled', { cacheDisabled: this._page.needsRequestInterception() }));
		`);


	// -- _onRequest Method --
	const onRequestHandlerMethod = crNetworkManagerClass.getMethodOrThrow("_onRequest");
	const onRequestHandlerMethodBody = onRequestHandlerMethod.getBodyOrThrow().asKindOrThrow(SyntaxKind.Block);
	const onRequestHandlerMethodStatements = onRequestHandlerMethodBody.getStatements();
	onRequestHandlerMethod
		.getBodyOrThrow()
		.asKindOrThrow(SyntaxKind.Block)
		.insertStatements(0, `
			if (this._alreadyTrackedNetworkIds.has(requestWillBeSentEvent.requestId))
				return;
		`);

	// Move `const isInterceptedOptionsPreflight` up before frame resolution so it's defined before first use
	const isInterceptedOptionsPreflightIndex = onRequestHandlerMethodStatements.findIndex(s => s.getText().includes('const isInterceptedOptionsPreflight'));
	if (isInterceptedOptionsPreflightIndex !== -1) {
		const preflightStatement = onRequestHandlerMethodStatements[isInterceptedOptionsPreflightIndex].getText();
		onRequestHandlerMethodStatements[isInterceptedOptionsPreflightIndex].remove();

		// Insert before the `let frame` statement so it's defined early enough
		const frameIndex = onRequestHandlerMethodStatements.findIndex(s => s.getText().startsWith('let frame'));
		if (frameIndex !== -1) {
			onRequestHandlerMethodBody.insertStatements(frameIndex, preflightStatement);
			// OPTIONS preflight bypass: when Patchright's always-on interception catches OPTIONS but no user routes exist
			onRequestHandlerMethodBody.insertStatements(frameIndex + 1, `
				if (isInterceptedOptionsPreflight && !(this._page || this._serviceWorker).needsRequestInterception()) {
					requestPausedSessionInfo!.session._sendMayFail('Fetch.continueRequest', { requestId: requestPausedEvent!.requestId });
					return;
				}
			`);
		}
	}
	// Guard null page delegate when resolving synthetic main-frame id.
	onRequestHandlerMethodStatements.forEach((statement) => {
		if (statement.getText().includes("if (!frame && this._page && requestWillBeSentEvent.frameId === (this._page?.delegate)._targetId)"))
			statement.replaceWithText(`
				const pageDelegate = this._page?.delegate;
				if (!frame && pageDelegate && requestWillBeSentEvent.frameId === pageDelegate._targetId) {
					frame = this._page.frameManager.frameAttached(requestWillBeSentEvent.frameId, null);
				}
			`);
	});

	// -- _onRequestPaused Method --
	const onRequestPausedMethod = crNetworkManagerClass.getMethodOrThrow("_onRequestPaused");
	onRequestPausedMethod
		.getBodyOrThrow()
		.asKindOrThrow(SyntaxKind.Block)
		.insertStatements(0, "if (this._alreadyTrackedNetworkIds.has(event.networkId)) return;");


	// ------- RouteImpl Class -------
	const routeImplClass = crNetworkManagerSourceFile.getClassOrThrow("RouteImpl");

	// -- RouteImpl Constructor --
	const routeImplConstructor = assertDefined(
		routeImplClass
			.getConstructors()
			.find((ctor) => ctor.getText().includes("constructor(session: CRSession, interceptionId: string)"))
	);
	// Get current parameters and add the new `page`, `networkId` and `sessionManager` parameter
	const routeImplConstructorParameters = routeImplConstructor.getParameters();
	routeImplConstructor.insertParameters(routeImplConstructorParameters.length, [
		{ name: 'page', type: 'Page | null' },
		{ name: 'networkId', type: 'string' },
		{ name: 'sessionManager', type: 'CRNetworkManager' },
	]);
	// Modify the constructor's body to include `this._page = page;` and other properties
	const routeImplConstructorBody = routeImplConstructor.getBodyOrThrow().asKindOrThrow(SyntaxKind.Block);
	routeImplConstructorBody.insertStatements(0, [
		'this._page = void 0;',
		'this._networkId = void 0;',
		'this._sessionManager = void 0;',
	]);
	routeImplConstructorBody.addStatements([
		'this._page = page;',
		'this._networkId = networkId;',
		'this._sessionManager = sessionManager;',
		"eventsHelper.addEventListener(this._session, 'Fetch.requestPaused', async e => await this._networkRequestIntercepted(e));",
	]);

	// -- _fixCSP Method --
	routeImplClass.addMethod({
		name: "_fixCSP",
		isAsync: false,
		parameters: [
			{ name: "csp", type: "string | null" }, 
			{ name: "scriptNonce", type: "string | null" },
		]
	});
	const fixCSPMethod = routeImplClass.getMethodOrThrow("_fixCSP");
	fixCSPMethod.setBodyText(`
		if (!csp || typeof csp !== 'string')
			return csp;

		// Split by semicolons and clean up
		const directives = csp.split(';')
			.map(d => d.trim())
			.filter(Boolean);

		const fixedDirectives = [];
		let hasScriptSrc = false;

		const addIfMissing = (values: string[], ...items: string[]) => {
			for (const item of items)
				if (!values.includes(item))
					values.push(item);
		};


		for (let directive of directives) {
			// Improved directive parsing to handle more edge cases
			const directiveMatch = directive.match(/^([a-zA-Z-]+)\\s+(.*)$/);
			if (!directiveMatch) {
				fixedDirectives.push(directive);
				continue;
			}

			const directiveName = directiveMatch[1].toLowerCase();
			const directiveValues = directiveMatch[2].split(/\\s+/).filter(Boolean);

			switch (directiveName) {
				case 'script-src':
					hasScriptSrc = true;

					// Add nonce if we have one and it's not already present
					if (scriptNonce && !directiveValues.some(v => v.includes(\`nonce-\${scriptNonce}\`)))
						directiveValues.push(\`'nonce-\${scriptNonce}'\`);

					// Add 'unsafe-eval' if not present
					addIfMissing(directiveValues, "'unsafe-eval'");

					// Add unsafe-inline if not present and no nonce is being used
					if (!scriptNonce)
						addIfMissing(directiveValues, "'unsafe-inline'");

					// Add wildcard for external scripts if not already present
					if (!directiveValues.includes("*") && !directiveValues.includes("'self'") && !directiveValues.some(v => v.includes("https:")))
						directiveValues.push("*");

					fixedDirectives.push(\`script-src \${directiveValues.join(' ')}\`);
					break;

				case 'style-src':
					// Add 'unsafe-inline' for styles if not present
					addIfMissing(directiveValues, "'unsafe-inline'");
					fixedDirectives.push(\`style-src \${directiveValues.join(' ')}\`);
					break;

				case 'img-src':
				case 'font-src':
					// Allow data: URLs for images/fonts if not already allowed
					if (!directiveValues.includes('*'))
						addIfMissing(directiveValues, 'data:');
					fixedDirectives.push(\`\${directiveName} \${directiveValues.join(' ')}\`);
					break;

				case 'connect-src':
					// Allow WebSocket connections if not already allowed
					if (!directiveValues.some(v => v.includes('ws:') || v.includes('wss:') || v === '*'))
						addIfMissing(directiveValues, 'ws:', 'wss:');
					fixedDirectives.push(\`connect-src \${directiveValues.join(' ')}\`);
					break;

				case 'frame-ancestors':
					// If completely blocked with 'none', allow 'self' at least
					let frameAncestorValues = directiveValues.includes("'none'") ? "'self'" : directiveValues.join(' ');
					fixedDirectives.push(\`frame-ancestors \${frameAncestorValues}\`);
					break;

				default:
					// Keep other directives as-is
					fixedDirectives.push(directive);
			}
		}

		// Add script-src if it doesn't exist (for our injected scripts)
		if (!hasScriptSrc) {
			fixedDirectives.push(
				scriptNonce
					? \`script-src 'self' 'unsafe-eval' 'nonce-\${scriptNonce}' *\`
					: \`script-src 'self' 'unsafe-eval' 'unsafe-inline' *\`
			);
		}

		return fixedDirectives.join('; ');
	`);

	// -- _injectIntoHead Method --
	routeImplClass.addMethod({
		name: "_injectIntoHead",
		isAsync: false,
		parameters: [
			{ name: "body", type: "string" }, 
			{ name: "injectionHTML", type: "string" },
		]
	});
	const injectIntoHeadMethod = routeImplClass.getMethodOrThrow("_injectIntoHead");
	injectIntoHeadMethod.setBodyText(`
		// Inject at END of <head>
		const lower = body.toLowerCase();
		const headStartIndex = lower.indexOf("<head");

		if (headStartIndex !== -1) {
			const headStartTagEndIndex = lower.indexOf(">", headStartIndex) + 1;
			const headEndTagIndex = lower.indexOf("</head>", headStartIndex);

			if (headEndTagIndex !== -1) {
				// Find the first <script> tag in <head>, skipping HTML comments
				const headContent = lower.slice(headStartTagEndIndex, headEndTagIndex);

				// Look for the first <script> tag in the head content but ignore comments
				let firstScriptIndex = -1;
				let searchPos = 0;

				while (searchPos < headContent.length) {
					const commentStart = headContent.indexOf("<!--", searchPos);
					const scriptStart = headContent.indexOf("<script", searchPos);

					// No more script tags, inject at the end of head content
					if (scriptStart === -1)
						break;

					if (commentStart !== -1 && commentStart < scriptStart) {
						const commentEnd = headContent.indexOf("-->", commentStart);
						if (commentEnd === -1)
							break;

						// Skip past the comment and keep searching
						searchPos = commentEnd + 3;
					} else {
					  // Found a script tag outside a comment
						firstScriptIndex = scriptStart;
						break;
					}
				}

				const insertAt =
					firstScriptIndex !== -1
						? headStartTagEndIndex + firstScriptIndex   // Before first <script>
						: headEndTagIndex;                   		 // Before </head>

				return body.slice(0, insertAt) + injectionHTML + body.slice(insertAt);
			}

			// No </head> found — inject right after the opening <head> tag
			return body.slice(0, headStartTagEndIndex) + injectionHTML + body.slice(headStartTagEndIndex);
		}

		// No <head> — try after <!DOCTYPE>
		const doctypeIndex = lower.indexOf("<!doctype");
		if (doctypeIndex === 0) {
			const doctypeEnd = body.indexOf(">", doctypeIndex) + 1;
			return body.slice(0, doctypeEnd) + injectionHTML + body.slice(doctypeEnd);
		}

		// Try after <html>
		const htmlTagIndex = lower.indexOf("<html");
		if (htmlTagIndex !== -1) {
			const htmlTagEnd = body.indexOf(">", htmlTagIndex) + 1;
			return body.slice(0, htmlTagEnd) +  \`<head>\${injectionHTML}</head>\` + body.slice(htmlTagEnd);
		}

		// Last resort — prepend to body
		return injectionHTML + body;
	`);

	// -- fulfill Method --
	const fulfillMethod = routeImplClass.getMethodOrThrow("fulfill");
	// Replace the body of the fulfill method with custom code
	fulfillMethod.setBodyText(`
		const isTextHtml = response.headers.some((header) => header.name.toLowerCase() === "content-type" && header.value.includes("text/html"));
		const pageDelegate = this._page?.delegate ?? null;
		const initScriptTag = pageDelegate?.initScriptTag ?? "";
		const allInjections = pageDelegate;
			? [...pageDelegate._mainFrameSession._evaluateOnNewDocumentScripts]
			: [];

		if (isTextHtml && allInjections.length && initScriptTag) {
			// Decode body if needed
			if (response.isBase64) {
				response.isBase64 = false;
				response.body = Buffer.from(response.body, "base64").toString("utf-8");
			}

			// CSP Detection and Fixing
			const cspHeaderNames = ["content-security-policy", "content-security-policy-report-only"];
			const extractNonce = (cspValue) => {
				const match = cspValue.match(/script-src[^;]*'nonce-([^'"\s;]+)'/i);
				return match?.[1] ?? null;
			};
		  let useNonce = false;
			let scriptNonce = null;

			// Fix CSP in headers
			for (const header of response.headers) {
				if (cspHeaderNames.includes(header.name.toLowerCase())) {
					const originalCsp = header.value ?? "";
					// Extract nonce if present
					const nonce = !useNonce && extractNonce(originalCsp);
					if (nonce) {
						scriptNonce = nonce;
						useNonce = true;
					}

					header.value = this._fixCSP(originalCsp, scriptNonce);
				}
			}

			// Fix CSP in meta tags
			if (typeof response.body === "string" && response.body.length) {
				response.body = response.body.replace(
					/<meta\b[^>]*http-equiv=(?:"|')?Content-Security-Policy(?:"|')?[^>]*>/gi,
					(match) => {
						const contentMatch = match.match(/\bcontent=(?:"|')([^"']*)(?:"|')/i);
						if (!contentMatch)
							return match;

						let originalCsp = contentMatch[1];
						// Decode HTML entities
						originalCsp = originalCsp
							.replace(/&amp;/g, '&')  // Must be first!
							.replace(/&lt;/g, '<')
							.replace(/&gt;/g, '>')
							.replace(/&quot;/g, '"')
							.replace(/&#x27;/g, "'")
							.replace(/&#x22;/g, '"')
							.replace(/&nbsp;/g, ' ')
							.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
							.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

						// Extract nonce if present
						const nonce = !useNonce && extractNonce(originalCsp);
						if (nonce) {
							scriptNonce = nonce;
							useNonce = true;
						}

						const fixedCsp = this._fixCSP(originalCsp, scriptNonce);
						// Re-encode for HTML
						const encodedCsp = fixedCsp.replace(/'/g, '&#x27;').replace(/"/g, '&#x22;');
						return match.replace(contentMatch[1], encodedCsp);
					}
				);
			}

			// Build injection HTML - only use nonce if one was found in existing CSP
			const nonceAttr = useNonce ? \`nonce="\${scriptNonce}"\` : '';
			let injectionHTML = "";
			allInjections.forEach((script) => {
				let scriptId = crypto.randomBytes(22).toString("hex");
				let scriptSource = script.source ?? script;
				injectionHTML += \`<script class="\${initScriptTag}" \${nonceAttr} id="\${scriptId}" type="text/javascript">document.getElementById("\${scriptId}")?.remove();\${scriptSource}</script>\`;
			});

			// Inject at END of <head>
			response.body = this._injectIntoHead(response.body, injectionHTML);
		}

		this._fulfilled = true;
		const body = response.isBase64 ? response.body : Buffer.from(response.body).toString("base64");
		const responseHeaders = splitSetCookieHeader(response.headers);
		await catchDisallowedErrors(async () => {
			await this._session.send("Fetch.fulfillRequest", {
				requestId: response.interceptionId ? response.interceptionId : this._interceptionId,
				responseCode: response.status,
				responsePhrase: network.statusText(response.status),
				responseHeaders,
				body
			});
		});
	`);

	// -- continue Method --
	const continueMethod = routeImplClass.getMethodOrThrow("continue");
	continueMethod.setBodyText(`		;
		this._alreadyContinuedParams = {
			requestId: this._interceptionId,
			url: overrides.url,
			headers: overrides.headers,
			method: overrides.method,
			postData: overrides.postData?.toString('base64'),
		};
		if (overrides.url && (overrides.url === 'http://patchright-init-script-inject.internal/' || overrides.url === 'https://patchright-init-script-inject.internal/')) {
			await catchDisallowedErrors(async () => {
				this._sessionManager._alreadyTrackedNetworkIds.add(this._networkId);
				try {
					await this._session._sendMayFail('Fetch.continueRequest', { requestId: this._interceptionId, interceptResponse: true });
				} catch (e) {
					this._sessionManager._alreadyTrackedNetworkIds.delete(this._networkId);
					throw e;
				}
			});
		} else {
			await catchDisallowedErrors(async () => {
				await this._session._sendMayFail('Fetch.continueRequest', this._alreadyContinuedParams);
			});
		}
	`);

	// -- _networkRequestIntercepted Method --
	routeImplClass.addMethod({
		name: "_networkRequestIntercepted",
		isAsync: true,
		parameters: [
			{ name: "event", type: "Protocol.Fetch.requestPausedPayload" },
		]
	});
	const networkRequestInterceptedMethod = routeImplClass.getMethodOrThrow("_networkRequestIntercepted");
	networkRequestInterceptedMethod.setBodyText(`
		if (this._networkId != event.networkId || !this._sessionManager._alreadyTrackedNetworkIds.has(event.networkId))
			return;

		const trackedNetworkId = event.networkId;
		try {
			if (event.resourceType !== 'Document')
				return;

			if (event.responseStatusCode >= 301 && event.responseStatusCode <= 308  || (event.redirectedRequestId && !event.responseStatusCode)) {
				await this._session.send('Fetch.continueRequest', { requestId: event.requestId, interceptResponse: true });
			} else {
				const responseBody = await this._session.send('Fetch.getResponseBody', { requestId: event.requestId });
				await this.fulfill({
					headers: event.responseHeaders,
					isBase64: true,
					body: responseBody.body,
					status: event.responseStatusCode,
					interceptionId: event.requestId,
					resourceType: event.resourceType,
				});
			}
		} catch (error) {
			if (error.message.includes("Can only get response body on HeadersReceived pattern matched requests.")) {
				await this._session.send("Fetch.continueRequest", { requestId: event.requestId, interceptResponse: true });
			} else {
				await this._session._sendMayFail("Fetch.continueRequest", { requestId: event.requestId });
			}
		} finally {
			this._sessionManager._alreadyTrackedNetworkIds.delete(trackedNetworkId);
		}
	`);
}
