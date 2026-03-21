import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ----------------
// server/frames.ts
// ----------------
export function patchFrames(project: Project) {
	// Add source file to the project
	const framesSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/frames.ts");
	// Add the custom import and comment at the start of the file
	framesSourceFile.addImportDeclarations([
		{ moduleSpecifier: './chromium/crExecutionContext', namedImports: ['CRExecutionContext'] },
		{ moduleSpecifier: './dom', namedImports: ['FrameExecutionContext'] },
		{ moduleSpecifier: './chromium/crConnection', namedImports: ['CRSession'], isTypeOnly: true },
		{ moduleSpecifier: 'crypto', defaultImport: 'crypto' },
	]);

	// ------- FrameManager Class -------
	const frameManagerClass = framesSourceFile.getClassOrThrow("FrameManager");

	// -- frameCommittedNewDocumentNavigation Method --
	const frameCommittedNewDocumentNavigationMethod = frameManagerClass.getMethodOrThrow("frameCommittedNewDocumentNavigation");
	const clearLifecycleStatementIndex = frameCommittedNewDocumentNavigationMethod
		.getDescendantsOfKind(SyntaxKind.ExpressionStatement)
		.findIndex(stmt => stmt.getText().trim() === "frame._onClearLifecycle();");
	frameCommittedNewDocumentNavigationMethod.insertStatements(clearLifecycleStatementIndex - 2, [
		"frame._iframeWorld = undefined;",
		"frame._mainWorld = undefined;",
		"frame._isolatedWorld = undefined;"
	]);

	// ------- Frame Class -------
	const frameClass = framesSourceFile.getClassOrThrow("Frame");
	// Add Properties to the Frame Class
	frameClass.addProperties([
		{ name: "_isolatedWorld", type: "dom.FrameExecutionContext" },
		{ name: "_mainWorld",     type: "dom.FrameExecutionContext" },
		{ name: "_iframeWorld",  type: "dom.FrameExecutionContext" },
	]);

	// -- evalOnSelector Method --
	const evalOnSelectorMethod = frameClass.getMethodOrThrow("evalOnSelector");
	evalOnSelectorMethod.setBodyText(`
		const handle = await this.selectors.query(selector, { strict }, scope);
		if (!handle)
			throw new Error('Failed to find element matching selector "' + selector + '"');
		const result = await handle.evaluateExpression(expression, { isFunction }, arg, true);
		handle.dispose();
		return result;
	`);

	// -- evalOnSelectorAll Method --
	const evalOnSelectorAllMethod = frameClass.getMethodOrThrow("evalOnSelectorAll");
	evalOnSelectorAllMethod.addParameter({
			name: "isolatedContext",
			type: "boolean",
			hasQuestionToken: true,
	});
	evalOnSelectorAllMethod.setBodyText(`
		const maxAttempts = 3;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				isolatedContext = this.selectors._parseSelector(selector, { strict: false }).world !== "main" && isolatedContext;
				const arrayHandle = await this.selectors.queryArrayInMainWorld(selector, scope, isolatedContext);
				const result = await arrayHandle.evaluateExpression(expression, { isFunction }, arg, isolatedContext);
				arrayHandle.dispose();
				return result;
			} catch (e) {
				// Retry only on specific context mismatch errors, and only a bounded number of times.
				if ("JSHandles can be evaluated only in the context they were created!" !== e.message || attempt === maxAttempts) throw e;
				await new Promise(resolve => setTimeout(resolve, 50 * attempt));
			}
		}
	`);

	// -- dispatchEvent Method --
	const dispatchEventMethod = frameClass.getMethodOrThrow("dispatchEvent");
	dispatchEventMethod.setBodyText(`
		const eventInitHandles: js.JSHandle[] = [];
		const visited = new WeakSet();
		const collectHandles = (value: any) => {
			if (!value || typeof value !== "object")
				return;
			if (value instanceof js.JSHandle) {
				eventInitHandles.push(value);
				return;
			}
			if (visited.has(value))
				return;
			visited.add(value);
			if (Array.isArray(value)) {
				for (const item of value)
					collectHandles(item);
				return;
			}
			for (const propertyValue of Object.values(value))
				collectHandles(propertyValue);
		};
		collectHandles(eventInit);

		const handlesFrame = eventInitHandles[0]?._context?.frame;
		const allHandlesFromSameFrame = eventInitHandles.length > 0 && eventInitHandles.every(handle => handle._context?.frame === handlesFrame);
		const canRetryInSecondaryContext = allHandlesFromSameFrame && (handlesFrame !== this || !selector.includes("internal:control=enter-frame"));
		const callback = (injectedScript, element, data) => {
			injectedScript.dispatchEvent(element, data.type, data.eventInit);
		};
		try {
			await this._callOnElementOnceMatches(progress, selector, callback, { type, eventInit }, { mainWorld: true, ...options }, scope);
		} catch (e) {
			if ("JSHandles can be evaluated only in the context they were created!" === e.message && canRetryInSecondaryContext) {
				await this._callOnElementOnceMatches(progress, selector, callback, { type, eventInit }, { ...options }, scope);
				return;
			}
			throw e;
		}
	`);

	// -- querySelectorAll Method --
	const querySelectorAllMethod = frameClass.getMethodOrThrow("querySelectorAll");
	querySelectorAllMethod.setBodyText(`
		const metadata = { internal: false, log: [], method: "querySelectorAll" };
		const progress = {
			log: message => metadata.log.push(message),
			metadata,
			race: (promise) => Promise.race(Array.isArray(promise) ? promise : [promise])
		}
		return await this._retryWithoutProgress(progress, selector, {strict: null, performActionPreChecks: false}, async (result) => {
			if (!result || !result[0]) return [];
			return Array.isArray(result[1]) ? result[1] : [];
		}, 'returnAll', null);
	`);

	// -- querySelector Method --
	const querySelectorMethod = frameClass.getMethodOrThrow("querySelector");
	querySelectorMethod.setBodyText(`
		return this.querySelectorAll(selector, options).then((handles) => {
			if (handles.length === 0)
				return null;
			if (handles.length > 1 && options?.strict)
				throw new Error(\`Strict mode: expected one element matching selector "\${selector}", found \${handles.length}\`);
			return handles[0];
		});
	`);

	// -- _getFrameMainFrameContextId Method --
	frameClass.addMethod({
		name: "_getFrameMainFrameContextId",
		isAsync: true,
		parameters: [
			{ name: "client", type: "CRSession" },
		],
		returnType: "Promise<number>",
	});
	const getFrameMainFrameContextIdMethod = frameClass.getMethodOrThrow("_getFrameMainFrameContextId");
	getFrameMainFrameContextIdMethod.setBodyText(`
		try {
		  const frameOwner = await client._sendMayFail("DOM.getFrameOwner", { frameId: this._id });
		  if (!frameOwner?.nodeId)
		    return 0;

		  const describedNode = await client._sendMayFail("DOM.describeNode", { backendNodeId: frameOwner.backendNodeId });
		  if (!describedNode?.node.contentDocument)
		    return 0;

		  const resolvedNode = await client._sendMayFail("DOM.resolveNode", { backendNodeId: describedNode.node.contentDocument.backendNodeId });
		  if (!resolvedNode?.object?.objectId)
		    return 0;

		  return parseInt(resolvedNode.object.objectId.split(".")[1], 10);
		} catch (e) {}
		return 0;
	`);

	// -- _context Method --
	const contextMethod = frameClass.getMethodOrThrow("_context");
	contextMethod.setIsAsync(true);
	contextMethod.setBodyText(`
		if (this.isDetached())
			throw new Error('Frame was detached');

		let client;
		try {
			client = this._page.delegate._sessionForFrame(this)._client;
		} catch (e) {
			client = this._page.delegate._mainFrameSession._client;
		}

		var iframeExecutionContextId = await this._getFrameMainFrameContextId(client);
		const isMainFrame = this === this._page.mainFrame();
		const session = this._page.delegate._sessionForFrame(this);

		const registerContext = (executionContextId: number, worldName: string) => {
			const crContext = new CRExecutionContext(client, { id: executionContextId }, this._id);
			const frameContext = new FrameExecutionContext(crContext, this, worldName);
			session._onExecutionContextCreated({
				id: executionContextId,
				origin: worldName,
				name: worldName,
				auxData: { isDefault: isMainFrame, type: 'isolated', frameId: this._id },
			});
			return frameContext;
		};

		if (world === "main") {
			// Iframe Only
			if (!isMainFrame && iframeExecutionContextId && this._iframeWorld === undefined) {
				this._iframeWorld = registerContext(iframeExecutionContextId, world);
			} else if (this._mainWorld === undefined) {
				const globalThis = await client._sendMayFail('Runtime.evaluate', {
					expression: "globalThis",
					serializationOptions: { serialization: "idOnly" },
				});
				if (!globalThis) {
					if (this.isDetached()) throw new Error('Frame was detached');
					return;
				}
				const executionContextId = parseInt(globalThis.result.objectId.split('.')[1], 10);
				this._mainWorld = registerContext(executionContextId, world);
			}
		}

		if (world !== "main" && this._isolatedWorld === undefined) {
			const result = await client._sendMayFail('Page.createIsolatedWorld', {
				frameId: this._id, grantUniveralAccess: true, worldName: world,
			});
			if (!result) {
				if (this.isDetached()) throw new Error("Frame was detached");
				return;
			}
			this._isolatedWorld = registerContext(result.executionContextId, "utility");
		}

		if (world !== "main")
			return this._isolatedWorld;
		if (!isMainFrame && this._iframeWorld)
			return this._iframeWorld;
		return this._mainWorld;
	`);

	// -- _setContext Method --
	const setContentMethod = frameClass.getMethodOrThrow("setContent");
	setContentMethod.setBodyText(`
		await this.raceNavigationAction(progress, async () => {
			const waitUntil = options.waitUntil === void 0 ? "load" : options.waitUntil;
			progress.log(\`setting frame content, waiting until "\${waitUntil}"\`);
			const lifecyclePromise = new Promise((resolve, reject) => {
				this._onClearLifecycle();
				this._waitForLoadState(progress, waitUntil).then(resolve).catch(reject);
			});
			const setContentPromise = this._page.delegate._sessionForFrame(this)._client.send("Page.setDocumentContent", {
				frameId: this._id,
				html
			});
			await Promise.all([setContentPromise, lifecyclePromise]);

			return null;
		});
	`);

	// -- _retryWithProgressIfNotConnected Method --
	const retryWithProgressIfNotConnectedMethod = frameClass.getMethodOrThrow("_retryWithProgressIfNotConnected");
	if (!retryWithProgressIfNotConnectedMethod.getParameter("returnAction")) {
		retryWithProgressIfNotConnectedMethod.addParameter({
			name: "returnAction",
			type: "'returnOnNotResolved' | 'returnAll' | undefined",
		});
	}
	const retryParamNames = retryWithProgressIfNotConnectedMethod.getParameters().map(p => p.getName());
	if (retryParamNames.includes("options") && !retryParamNames.includes("strict")) {
		retryWithProgressIfNotConnectedMethod.setBodyText(`
			if (!(options as any)?.__patchrightSkipRetryLogWaiting)
				progress.log("waiting for " + this._asLocator(selector));
			return this.retryWithProgressAndTimeouts(progress, [0, 20, 50, 100, 100, 500], async continuePolling => {
				return this._retryWithoutProgress(progress, selector, options as any, action as any, returnAction, continuePolling);
			});
		`);
	} else if (retryParamNames.includes("strict") && retryParamNames.includes("performActionPreChecks")) {
		retryWithProgressIfNotConnectedMethod.setBodyText(`
			const normalizedOptions: any = { strict, performActionPreChecks };

			if (!(normalizedOptions as any)?.__patchrightSkipRetryLogWaiting)
				progress.log("waiting for " + this._asLocator(selector));
			return this.retryWithProgressAndTimeouts(progress, [0, 20, 50, 100, 100, 500], async continuePolling => {
				return this._retryWithoutProgress(progress, selector, normalizedOptions, action as any, returnAction, continuePolling);
			});
		`);
	} else {
		throw new Error("_retryWithProgressIfNotConnected has unsupported parameter signature");
	}

	// -- _retryWithoutProgress Method --
	frameClass.addMethod({
		name: "_retryWithoutProgress",
		isAsync: true,
		parameters: [
			{ name: "progress", type: "Progress" },
			{ name: "selector", type: "string" },
			{ name: "options", type: "{ performActionPreChecks: boolean; strict?: boolean | null; state?: 'attached' | 'detached' | 'visible' | 'hidden'; noAutoWaiting?: boolean; __testHookNoAutoWaiting?: boolean; __patchrightWaitForSelector?: boolean; __patchrightInitialScope?: dom.ElementHandle; __patchrightSkipRetryLogWaiting?: boolean }" },
			{ name: "action", type: "(result: dom.ElementHandle | [dom.ElementHandle, dom.ElementHandle[]] | null) => Promise<unknown>" },
			{ name: "returnAction", type: "'returnOnNotResolved' | 'returnAll' | undefined" },
			{ name: "continuePolling", type: "symbol" },
		],
	});
	const customRetryWithoutProgressMethod = frameClass.getMethodOrThrow("_retryWithoutProgress");
	customRetryWithoutProgressMethod.setBodyText(`
		if (options.performActionPreChecks)
			await this._page.performActionPreChecks(progress);

		const resolved = await this.selectors.resolveInjectedForSelector(
			selector,
			{ strict: options.strict },
			 (options as any).__patchrightInitialScope
		);

		if (!resolved) {
			if (returnAction === 'returnOnNotResolved' || returnAction === 'returnAll') {
				const result = await action(null);
				return result === "internal:continuepolling" ? continuePolling : result;
			}
			return continuePolling;
		}

		const utilityContext = await resolved.frame._utilityContext();
		const mainContext = await resolved.frame._mainContext();
		let client;
		try {
			client = this._page.delegate._sessionForFrame(resolved.frame)._client;
		} catch (e) {
			client = this._page.delegate._mainFrameSession._client;
		}

		const documentNode = await client._sendMayFail('Runtime.evaluate', {
			expression: "document",
			serializationOptions: { serialization: "idOnly" },
			contextId: utilityContext.delegate._contextId,
		});
		if (!documentNode)
			return continuePolling;

		let initialScope = new dom.ElementHandle(utilityContext, documentNode.result.objectId);

		if ((resolved as any).scope) {
			const scopeObjectId = (resolved as any).scope._objectId;
			if (scopeObjectId) {
				const describeResult = await client._sendMayFail('DOM.describeNode', {
					objectId: scopeObjectId,
				});
				const backendNodeId = describeResult?.node?.backendNodeId;

				if (backendNodeId) {
					const scopeInUtility = await client._sendMayFail('DOM.resolveNode', {
						backendNodeId,
						executionContextId: utilityContext.delegate._contextId
					});

					if (scopeInUtility?.object?.objectId) {
						initialScope = new dom.ElementHandle(utilityContext, scopeInUtility.object.objectId);
					}
				}
			}
		}
		(progress as any).__patchrightInitialScope = (resolved as any).scope;

		// Save parsed selector before _customFindElementsByParsed mutates it via parts.shift()
		const parsedSnapshot = (options as any).__patchrightWaitForSelector ? JSON.parse(JSON.stringify(resolved.info.parsed)) : null;
		let currentScopingElements;
		try {
			currentScopingElements = await this._customFindElementsByParsed(resolved, client, mainContext, initialScope, progress, resolved.info.parsed);
		} catch (e) {
			if ("JSHandles can be evaluated only in the context they were created!" === e.message)
				return continuePolling;
			if (e instanceof TypeError && e.message.includes("is not a function"))
				return continuePolling;
			await progress.race(resolved.injected.evaluateHandle((injected, { error }) => { throw error }, { error: e }));
		}

		if (currentScopingElements.length === 0) {
			if ((options as any).__testHookNoAutoWaiting || (options as any).noAutoWaiting)
				throw new dom.NonRecoverableDOMError('Element(s) not found');

			// CDP-based element search is non-atomic and can temporarily miss
			// elements during DOM mutations. Verify element absence in-page before reporting
			// "not found" to the waitForSelector callback.
			if (parsedSnapshot && (returnAction === 'returnOnNotResolved' || returnAction === 'returnAll')) {
				const elementCount = await resolved.injected.evaluate((injected, { parsed }) => {
					return injected.querySelectorAll(parsed, document).length;
				}, { parsed: parsedSnapshot }).catch(() => 0);
				if (elementCount > 0)
					return continuePolling;
			}
			if (returnAction === 'returnOnNotResolved' || returnAction === 'returnAll') {
				const result = await action(null);
				return result === "internal:continuepolling" ? continuePolling : result;
			}
			return continuePolling;
		}

		const resultElement = currentScopingElements[0];
		await resultElement._initializePreview().catch(() => {});

		let visibilityQualifier = '';
		if (options && (options as any).__patchrightWaitForSelector) {
			visibilityQualifier = await resultElement.evaluateInUtility(([injected, node]) => injected.utils.isElementVisible(node) ? 'visible' : 'hidden', {}).catch(() => '');
		}

		if (currentScopingElements.length > 1) {
			if (resolved.info.strict) {
				await progress.race(resolved.injected.evaluateHandle((injected, {
					info,
					elements
				}) => {
					throw injected.strictModeViolationError(info.parsed, elements);
				}, {
					info: resolved.info,
					elements: currentScopingElements
				}));
			}
			progress.log("  locator resolved to " + currentScopingElements.length + " elements. Proceeding with the first one: " + resultElement.preview());
		} else if (resultElement) {
			progress.log("  locator resolved to " + (visibilityQualifier ? visibilityQualifier + " " : "") + resultElement.preview().replace("JSHandle@", ""));
		}

		try {
			var result = null;
			if (returnAction === 'returnAll') {
				result = await action([resultElement, currentScopingElements]);
			} else {
				result = await action(resultElement);
			}
			if (result === 'error:notconnected') {
				progress.log('element was detached from the DOM, retrying');
				return continuePolling;
			} else if (result === 'internal:continuepolling') {
				return continuePolling;
			}
			// Verify no visible elements exist before accepting a null result to avoid stale CDP handles during mutations.
			if (parsedSnapshot && result === null && ((options as any).state === 'hidden' || (options as any).state === 'detached')) {
				const visibleCount = await resolved.injected.evaluate((injected, { parsed }) => {
					const elements = injected.querySelectorAll(parsed, document);
					return elements.filter(e => injected.utils.isElementVisible(e)).length;
				}, { parsed: parsedSnapshot }).catch(() => 0);
				if (visibleCount > 0)
					return continuePolling;
			}
			return result;
		} finally {}
	`);

	// -- waitForSelector Method --
	const waitForSelectorMethod = frameClass.getMethodOrThrow("waitForSelector");
	waitForSelectorMethod.setBodyText(`
		if ((options as any).visibility)
			throw new Error('options.visibility is not supported, did you mean options.state?');
		if ((options as any).waitFor && (options as any).waitFor !== 'visible')
			throw new Error('options.waitFor is not supported, did you mean options.state?');

		const { state = 'visible' } = options;
		if (!['attached', 'detached', 'visible', 'hidden'].includes(state))
			throw new Error(\`state: expected one of (attached|detached|visible|hidden)\`);

		if (performActionPreChecksAndLog)
			progress.log(\`waiting for \${this._asLocator(selector)}\${state === 'attached' ? '' : ' to be ' + state}\`);

		const promise = this._retryWithProgressIfNotConnected(progress, selector, { ...options, performActionPreChecks: true, __patchrightWaitForSelector: true, __patchrightInitialScope: scope }, async handle => {
			if (scope) {
				const scopeIsConnected = await scope.evaluateInUtility(([injected, node]) => node.isConnected, {}).catch(() => false);
				if (scopeIsConnected !== true) {
					if (state === 'hidden' || state === 'detached')
						return null;
					throw new dom.NonRecoverableDOMError('Element is not attached to the DOM');
				}
			}

			const attached = !!handle;
			var visible = false;

			if (attached) {
				if (handle.parentNode instanceof dom.ElementHandle) {
					visible = await handle.parentNode.evaluateInUtility(([injected, node, { handle }]) => {
						return handle ? injected.utils.isElementVisible(handle) : false;
					}, { handle });
				} else {
					visible = await handle.parentNode.evaluate((injected, { handle }) => {
						return handle ? injected.utils.isElementVisible(handle) : false;
					}, { handle });
				}
			}

			const success = {
				attached,
				detached: !attached,
				visible,
				hidden: !visible
			}[state];
			if (!success) return "internal:continuepolling";
			if (options.omitReturnValue) return null;

			const element = state === 'attached' || state === 'visible' ? handle : null;
			if (!element) return null;
			if (options.__testHookBeforeAdoptNode) await options.__testHookBeforeAdoptNode();
			try {
				return element;
			} catch (e) {
				return "internal:continuepolling";
			}
		}, "returnOnNotResolved");

		const resultPromise = scope ? scope._context._raceAgainstContextDestroyed(promise) : promise;
		return resultPromise.catch(e => {
			if (this.isDetached() && (e as any)?.message?.includes('Execution context was destroyed'))
				throw new Error('Frame was detached');
			throw e;
		});
	`);

	// -- waitForFunctionExpression Method --
	const waitForFunctionExpressionMethod = frameClass.getMethodOrThrow("waitForFunctionExpression");
	// Race the inner evaluate against _detachedScope so frame detachment immediately cancels the operation
	const matchingReturnStmts = waitForFunctionExpressionMethod.getDescendantsOfKind(SyntaxKind.ReturnStatement).filter(stmt => stmt.getText().includes('progress.race(handle.evaluateHandle(h => h.result))'));
	// Take the last (innermost) match to avoid replacing the outer
	// `return this.retryWithProgressAndTimeouts(...)` statement whose
	// getText() also contains the substring.
	const targetReturnStmt = matchingReturnStmts[matchingReturnStmts.length - 1];
	if (targetReturnStmt) {
		targetReturnStmt.replaceWithText('return await progress.race(this._detachedScope.race(handle.evaluateHandle(h => h.result)));');
	} else {
		// Upstream may already include _detachedScope wrapping; assert expected shape exists.
		assertDefined(
			waitForFunctionExpressionMethod
				.getDescendantsOfKind(SyntaxKind.ReturnStatement)
				.find(stmt => stmt.getText().includes('progress.race(this._detachedScope.race(handle.evaluateHandle(h => h.result)))'))
		);
	}

	// -- isVisibleInternal Method --
	const isVisibleInternalMethod = frameClass.getMethodOrThrow("isVisibleInternal");
	isVisibleInternalMethod.setBodyText(`
		try {
			const metadata = { internal: false, log: [], method: "isVisible" };
			const progress = {
				log: message => metadata.log.push(message),
				metadata,
				race: (promise) => Promise.race(Array.isArray(promise) ? promise : [promise])
			}
			progress.log("waiting for " + this._asLocator(selector));
			if (selector === ":scope") {
				const scopeParentNode = scope.parentNode || scope;
				if (scopeParentNode instanceof dom.ElementHandle) {
					return await scopeParentNode.evaluateInUtility(([injected, node, { scope: handle2 }]) => {
						const state = handle2 ? injected.elementState(handle2, "visible") : {
							matches: false,
							received: "error:notconnected"
						};
						return state.matches;
					}, { scope });
				} else {
					return await scopeParentNode.evaluate((injected, node, { scope: handle2 }) => {
						const state = handle2 ? injected.elementState(handle2, "visible") : {
							matches: false,
							received: "error:notconnected"
						};
						return state.matches;
					}, { scope });
				}
			} else {
				return await this._retryWithoutProgress(progress, selector, { ...options, performActionPreChecks: false}, async (handle) => {
					if (!handle) return false;
					if (handle.parentNode instanceof dom.ElementHandle) {
						return await handle.parentNode.evaluateInUtility(([injected, node, { handle: handle2 }]) => {
							const state = handle2 ? injected.elementState(handle2, "visible") : {
								matches: false,
								received: "error:notconnected"
							};
							return state.matches;
						}, { handle });
					} else {
						return await handle.parentNode.evaluate((injected, { handle: handle2 }) => {
							const state = handle2 ? injected.elementState(handle2, "visible") : {
								matches: false,
								received: "error:notconnected"
							};
							return state.matches;
						}, { handle });
					}
				}, "returnOnNotResolved", null);
			}
		} catch (e) {
			if (this.isNonRetriableError(e)) throw e;
			return false;
		}
	`);

	// -- _onDetached Method --
	const onDetachedMethod = frameClass.getMethodOrThrow("_onDetached");
	onDetachedMethod.setBodyText(`
		this._stopNetworkIdleTimer();
		this._detachedScope.close(new Error('Frame was detached'));
		for (const data of this._contextData.values()) {
			if (data.context)
				data.context.contextDestroyed('Frame was detached');
			data.contextPromise.resolve({ destroyedReason: 'Frame was detached' });
		}
		if (this._mainWorld)
			this._mainWorld.contextDestroyed('Frame was detached');
		if (this._iframeWorld)
			this._iframeWorld.contextDestroyed('Frame was detached');
		if (this._isolatedWorld)
			this._isolatedWorld.contextDestroyed('Frame was detached');
		if (this._parentFrame)
			this._parentFrame._childFrames.delete(this);
		this._parentFrame = null;
	`);

	// -- evaluateExpression Method --
	const evaluateExpressionMethod = frameClass.getMethodOrThrow("evaluateExpression");
	evaluateExpressionMethod.setBodyText(`
		const context = await this._detachedScope.race(this._context(options.world ?? "main"));
		return await this._detachedScope.race(context.evaluateExpression(expression, options, arg));
	`);

	// -- evaluateExpressionHandle Method --
	const evaluateExpressionHandleMethod = frameClass.getMethodOrThrow("evaluateExpressionHandle");
	evaluateExpressionHandleMethod.setBodyText(`
		const context = await this._detachedScope.race(this._context(options.world ?? "utility"));
		return await this._detachedScope.race(context.evaluateExpressionHandle(expression, options, arg));
	`);

	// -- nonStallingEvaluateInExistingContext Method --
	const nonStallingEvalMethod = frameClass.getMethodOrThrow("nonStallingEvaluateInExistingContext");
	nonStallingEvalMethod.setBodyText(`
		return this.raceAgainstEvaluationStallingEvents(async () => {
			try { await this._context(world); } catch {}
			const context = this._contextData.get(world)?.context;
			if (!context)
				throw new Error('Frame does not yet have the execution context');
			return context.evaluateExpression(expression, { isFunction: false });
		});
	`);

	// -- queryCount Method --
	const queryCountMethod = frameClass.getMethodOrThrow("queryCount");
	queryCountMethod.setBodyText(`
		const metadata = { internal: false, log: [], method: "queryCount" };
		const progress = {
			log: message => metadata.log.push(message),
			metadata,
			race: (promise) => Promise.race(Array.isArray(promise) ? promise : [promise])
		}
		return await this._retryWithoutProgress(progress, selector, {strict: null, performActionPreChecks: false }, async ([handle, handles] = []) => {
			if (!handle) return 0;
			return handles.length;
		}, 'returnAll', null);
	`);

	// -- _expectInternal Method --
	const expectInternalMethod = frameClass.getMethodOrThrow("_expectInternal");
	expectInternalMethod.setBodyText(`
		// The first expect check, a.k.a. one-shot, always finishes - even when progress is aborted.
		const race = (p) => noAbort ? p : progress.race(p);
		const isArray = options.expression === 'to.have.count' || options.expression.endsWith('.array');
		var log, matches, received, missingReceived;
		if (selector) {
			var frame, info;
			try {
				var { frame, info } = await race(this.selectors.resolveFrameForSelector(selector, { strict: true }));
			} catch (e) { }
			const action = async result => {
				if (!result) {
					if (options.expectedNumber === 0)
						return { matches: true };
					if (options.isNot && options.expectedNumber)
						return { matches: false, received: 0 };
					// expect(locator).toBeHidden() passes when there is no element.
					if (!options.isNot && options.expression === 'to.be.hidden')
						return { matches: true };
					// expect(locator).not.toBeVisible() passes when there is no element.
					if (options.isNot && options.expression === 'to.be.visible')
						return { matches: false };
					// expect(locator).toBeAttached({ attached: false }) passes when there is no element.
					if (!options.isNot && options.expression === 'to.be.detached')
						return { matches: true };
					// expect(locator).not.toBeAttached() passes when there is no element.
					if (options.isNot && options.expression === 'to.be.attached')
						return { matches: false };
					// expect(locator).not.toBeInViewport() passes when there is no element.
					if (options.isNot && options.expression === 'to.be.in.viewport')
						return { matches: false };
					// expect(locator).toHaveText([]) pass when there is no element.
					if (options.expression === "to.have.text.array") {
						if (options.expectedText.length === 0)
							return { matches: true, received: [] };
						if (options.isNot && options.expectedText.length !== 0)
							return { matches: false, received: [] };
					}
					// When none of the above applies, expect does not match.
					return { matches: options.isNot, missingReceived: true };
				}

				const handle = result[0];
				const handles = result[1];

				if (handle.parentNode instanceof dom.ElementHandle) {
					return await handle.parentNode.evaluateInUtility(async ([injected, node, { handle, options, handles }]) => {
						return await injected.expect(handle, options, handles);
					}, { handle, options, handles });
				} else {
					return await handle.parentNode.evaluate(async (injected, { handle, options, handles }) => {
						return await injected.expect(handle, options, handles);
					}, { handle, options, handles });
				}
			}

			if (noAbort) {
				var { log, matches, received, missingReceived } = await this._retryWithoutProgress(progress, selector, {strict: !isArray, performActionPreChecks: false}, action, 'returnAll', null);
			} else {
				var { log, matches, received, missingReceived } = await race(this._retryWithProgressIfNotConnected(progress, selector, { strict: !isArray, performActionPreChecks: false, __patchrightSkipRetryLogWaiting: true } as any, action, 'returnAll'));
			}
		} else {
			const world = options.expression === 'to.have.property' ? 'main' : 'utility';
			const context = await race(this._context(world));
			const injected = await race(context.injectedScript());
			var { matches, received, missingReceived } = await race(injected.evaluate(async (injected, { options, callId }) => {
				return { ...await injected.expect(undefined, options, []) };
			}, { options, callId: progress.metadata.id }));
		}


		if (log)
			progress.log(log);
		// Note: missingReceived avoids \`unexpected value "undefined"\` when element was not found.
		if (matches === options.isNot) {
			if (missingReceived) {
				lastIntermediateResult.errorMessage = 'Error: element(s) not found';
			} else {
				lastIntermediateResult.errorMessage = undefined;
				lastIntermediateResult.received = received;
			}
			lastIntermediateResult.isSet = true;
			if (!missingReceived) {
				const rendered = renderUnexpectedValue(options.expression, received);
				if (rendered !== undefined)
					progress.log('  unexpected value "' + rendered + '"');
			}
		}
		return { matches, received };
	`);

	// -- _callOnElementOnceMatches Method --
	const callOnElementOnceMatchesMethod = frameClass.getMethodOrThrow("_callOnElementOnceMatches");
	callOnElementOnceMatchesMethod.setBodyText(`
		const callbackText = body.toString();
		progress.log("waiting for " + this._asLocator(selector));
		var promise;
		if (selector === ":scope") {
			const scopeParentNode = scope.parentNode || scope;
			if (scopeParentNode instanceof dom.ElementHandle) {
				if (options?.mainWorld) {
					promise = (async () => {
						const mainContext = await this._mainContext();
						const adoptedScope = await this._page.delegate.adoptElementHandle(scope, mainContext);
						try {
							return await mainContext.evaluate(([injected, node, { callbackText: callbackText2, scope: handle2, taskData: taskData2 }]) => {
								const callback = injected.eval(callbackText2);
								return callback(injected, handle2, taskData2);
							}, [
								await mainContext.injectedScript(),
								adoptedScope,
								{ callbackText, scope: adoptedScope, taskData },
							]);
						} finally {
							adoptedScope.dispose();
						}
					})();
				} else {
					promise = scopeParentNode.evaluateInUtility(([injected, node, { callbackText: callbackText2, scope: handle2, taskData: taskData2 }]) => {
						const callback = injected.eval(callbackText2);
						return callback(injected, handle2, taskData2);
					}, {
						callbackText,
						scope,
						taskData
					});
				}
			} else {
				promise = scopeParentNode.evaluate((injected, { callbackText: callbackText2, scope: handle2, taskData: taskData2 }) => {
					const callback = injected.eval(callbackText2);
					return callback(injected, handle2, taskData2);
				}, {
					callbackText,
					scope,
					taskData
				});
			}
		} else {

			promise = this._retryWithProgressIfNotConnected(progress, selector, { ...options, performActionPreChecks: false }, async (handle) => {
				if (handle.parentNode instanceof dom.ElementHandle) {
					if (options?.mainWorld) {
						const mainContext = await handle._frame._mainContext();
						const adoptedHandle = await this._page.delegate.adoptElementHandle(handle, mainContext);
						try {
							return await mainContext.evaluate(([injected, node, { callbackText: callbackText2, handle: handle2, taskData: taskData2 }]) => {
								const callback = injected.eval(callbackText2);
								return callback(injected, handle2, taskData2);
							}, [
								await mainContext.injectedScript(),
								adoptedHandle,
								{ callbackText, handle: adoptedHandle, taskData },
							]);
						} finally {
							adoptedHandle.dispose();
						}
					}

					// Handling dispatch_event's in isolated and Main Contexts
					const [taskScope] = Object.values(taskData?.eventInit ?? {});
					if (taskScope) {
						const taskScopeContext = taskScope._context;
						const adoptedHandle = await handle._adoptTo(taskScopeContext);
						return await taskScopeContext.evaluate(([injected, node, { callbackText: callbackText2, adoptedHandle: handle2, taskData: taskData2 }]) => {
							const callback = injected.eval(callbackText2);
							return callback(injected, handle2, taskData2);
						}, [
							await taskScopeContext.injectedScript(),
							adoptedHandle,
							{ callbackText, adoptedHandle, taskData },
						]);
					}

					return await handle.parentNode.evaluateInUtility(([injected, node, { callbackText: callbackText2, handle: handle2, taskData: taskData2 }]) => {
						const callback = injected.eval(callbackText2);
						return callback(injected, handle2, taskData2);
					}, {
						callbackText,
						handle,
						taskData
					});
				} else {
					return await handle.parentNode.evaluate((injected, { callbackText: callbackText2, handle: handle2, taskData: taskData2 }) => {
						const callback = injected.eval(callbackText2);
						return callback(injected, handle2, taskData2);
					}, {
						callbackText,
						handle,
						taskData
					});
				}
			})
		}
		return scope ? scope._context._raceAgainstContextDestroyed(promise) : promise;
	`);

	// -- _customFindElementsByParsed Method --
	frameClass.addMethod({
		name: "_customFindElementsByParsed",
		isAsync: true,
		parameters: [
			{ name: "resolved", type: "{ injected: js.JSHandle<InjectedScript>, info: { parsed: ParsedSelector, strict: boolean }, frame: Frame, scope?: dom.ElementHandle }" },
			{ name: "client", type: "CRSession" },
			{ name: "context", type: "dom.FrameExecutionContext" },
			{ name: "documentScope", type: "dom.ElementHandle" },
			{ name: "progress", type: "Progress" },
			{ name: "parsed", type: "ParsedSelector" },
		],
	});
	const customFindElementsByParsedMethod = frameClass.getMethodOrThrow("_customFindElementsByParsed");
	customFindElementsByParsedMethod.setBodyText(`
		var parsedEdits = { ...parsed };
		// Note: We start scoping at document level
		var currentScopingElements = [documentScope];

		for (const part of [...parsed.parts]) {
			parsedEdits.parts = [part];
			var elements = [];

			if (part.name === "nth") {
				const partNth = Number(part.body);
				// Check if any Elements are currently scoped, else return empty array to continue polling
				if (currentScopingElements.length == 0)
					return [];

				if (partNth > currentScopingElements.length-1 || partNth < -(currentScopingElements.length-1)) {
					if (parsed.capture !== undefined)
						throw new Error("Can't query n-th element in a request with the capture.");
					return [];
				}
				currentScopingElements = [currentScopingElements.at(partNth)];
				continue;
			} else if (part.name === "internal:or") {
				var orredElements = await this._customFindElementsByParsed(resolved, client, context, documentScope, progress, part.body.parsed);
				elements = [...currentScopingElements, ...orredElements];
			} else if (part.name == "internal:and") {
				var andedElements = await this._customFindElementsByParsed(resolved, client, context, documentScope, progress, part.body.parsed);
				const backendNodeIds = new Set(andedElements.map(elem => elem.backendNodeId));
				elements = currentScopingElements.filter(elem => backendNodeIds.has(elem.backendNodeId));
			} else {
				for (const scope of currentScopingElements) {
					const describedScope = await client.send("DOM.describeNode", {
						objectId: scope._objectId,
						depth: -1,
						pierce: true
					});

					let findClosedShadowRoots = function(node, results = []) {
						if (!node || typeof node !== "object") return results;
						if (node.shadowRoots && Array.isArray(node.shadowRoots)) {
							for (const shadowRoot of node.shadowRoots) {
								if (shadowRoot.shadowRootType === "closed" && shadowRoot.backendNodeId) {
									results.push(shadowRoot.backendNodeId);
								}
								findClosedShadowRoots(shadowRoot, results);
							}
						}
						if (node.nodeName !== "IFRAME" && node.children && Array.isArray(node.children)) {
							for (const child of node.children) {
								findClosedShadowRoots(child, results);
							}
						}
						return results;
					};
					var shadowRootBackendIds = findClosedShadowRoots(describedScope.node);

					const shadowRoots = await Promise.all(
						shadowRootBackendIds.map(async backendNodeId => {
							const resolved = await client.send("DOM.resolveNode", {
								backendNodeId,
								contextId: context.delegate._contextId,
							});
							return new dom.ElementHandle(context, resolved.object.objectId);
						})
					);

					// Elements Queryed in the "current round"
					const queryGroups: { handles: any; parentNode: any }[] = [];
					for (var shadowRoot of shadowRoots) {
						const shadowHandles = await shadowRoot.evaluateHandleInUtility(
							([injected, node, { parsed, callId }]) => {
							 	const elements = injected.querySelectorAll(parsed, node);
								if (callId)
									injected.markTargetElements(new Set(elements), callId);
								return elements;
							}, {
								parsed: parsedEdits,
								callId: progress.metadata.id
							}
						);
						queryGroups.push({ handles: shadowHandles, parentNode: shadowRoot });
					}

					// Document Root Elements (not in CSR)
					const rootHandles = await scope.evaluateHandleInUtility(
						([injected, node, { parsed, callId }]) => {
						 	const elements = injected.querySelectorAll(parsed, node);
							if (callId)
								injected.markTargetElements(new Set(elements), callId);
							return elements;
						}, {
							parsed: parsedEdits,
							callId: progress.metadata.id
						}
					);
					queryGroups.push({ handles: rootHandles, parentNode: scope });

					// Querying and Sorting the elements by their backendNodeId
					for (const { handles, parentNode } of queryGroups) {
						const handlesAmount = await (await handles.getProperty("length")).jsonValue();
						for (var i = 0; i < handlesAmount; i++) {
						  if (parentNode instanceof dom.ElementHandle) {
								var element = await parentNode.evaluateHandleInUtility(
									([injected, node, { i, handles: elems }]) => elems[i],
									{ i, handles }
								);
							} else {
								var element = await parentNode.evaluateHandle(
									(injected, { i, handles: elems }) => elems[i],
									{ i, handles }
								);
							}

							// For other Functions/Utilities
							element.parentNode = parentNode;
							const resolvedElement = await client.send("DOM.describeNode", { objectId: element._objectId, depth: -1 });
							element.backendNodeId = resolvedElement.node.backendNodeId;
							element.nodePosition = await this.selectors._findElementPositionInDomTree(element, describedScope.node, context, "");
							elements.push(element);
						}
					}
				}
			}

			// Sorting elements by their nodePosition, which is a index to the Element in the DOM tree
			const getParts = (pos) => (pos || '').split('.').filter(Boolean).map(Number);
			elements.sort((a, b) => {
				const partsA = getParts(a.nodePosition);
				const partsB = getParts(b.nodePosition);

				for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
					const diff = (partsA[i] ?? -1) - (partsB[i] ?? -1);
					if (diff !== 0) return diff;
				}
				return 0;
			});

			// Remove duplicates by backendNodeId, keeping the first occurrence
			currentScopingElements = Array.from(
				new Map(elements.map(e => [e.backendNodeId, e])).values()
			);
		}

		return currentScopingElements;
	`);
}