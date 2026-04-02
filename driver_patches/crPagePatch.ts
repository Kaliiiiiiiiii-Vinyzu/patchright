import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// -------------------------
// server/chromium/crPage.ts
// -------------------------
export function patchCRPage(project: Project) {
	// Add source file to the project
	const crPageSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crPage.ts");
	// Add the custom import and comment at the start of the file
	crPageSourceFile.addImportDeclaration({
		moduleSpecifier: "crypto",
		defaultImport: "crypto",
	});


	// ------- CRPage Class -------
	const crPageClass = crPageSourceFile.getClassOrThrow("CRPage");

	// -- CRPage Constructor --
	const crPageConstructor = assertDefined(
		crPageClass
		  .getConstructors()
			.find((ctor) => {
				const params = ctor.getParameters();
				return params[0]?.getName() === "client" && params[1]?.getName() === "targetId" && params[2]?.getName() === "browserContext" && params[3]?.getName() === "opener";
			})
	);

	// Swap legacy updateRequestInterception for direct network manager interception + unique script tag.
	const updateRequestInterceptionStatement = assertDefined(
		crPageConstructor
			.getStatements()
			.find((statement) => statement.getText() === "this.updateRequestInterception();")
	);
	updateRequestInterceptionStatement.replaceWithText(`
		this._networkManager.setRequestInterception(true);
		this.initScriptTag = crypto.randomBytes(20).toString('hex');
	`);

	// -- exposeBinding Method --
	crPageClass.addMethod({
		name: "exposeBinding",
		isAsync: true,
		parameters: [
			{ name: "binding", type: "PageBinding" },
		],
	});
	const crExposeBindingMethod = crPageClass.getMethodOrThrow("exposeBinding");
	// Initialize binding across all frame sessions and evaluate the binding source in all page frames
	crExposeBindingMethod.setBodyText(`
		await this._forAllFrameSessions(frame => frame._initBinding(binding));
		await Promise.all(this._page.frames().map(frame => frame.evaluateExpression(binding.source).catch(e => {})));
	`);

	// -- removeExposedBindings Method --
	crPageClass.addMethod({
		name: "removeExposedBindings",
		isAsync: true,
	});
	const crRemoveExposedBindingsMethod = crPageClass.getMethodOrThrow("removeExposedBindings");
	// Remove all exposed bindings from all frame sessions
	crRemoveExposedBindingsMethod.setBodyText(`
		await this._forAllFrameSessions(frame => frame._removeExposedBindings());
	`);

	// -- addInitScript Method --
	const addInitScriptMethod = crPageClass.getMethodOrThrow("addInitScript");
	// Insert a statement to push init scripts to the page's initScripts array for later evaluation
	addInitScriptMethod
		.getBodyOrThrow()
		.asKindOrThrow(SyntaxKind.Block)
		.insertStatements(0, "this._page.initScripts.push(initScript);");

	// -- _sessionForFrame Method --
	const sessionForFrameMethod = crPageClass.getMethodOrThrow("_sessionForFrame");
	// Replace the error message for detached frames with a more concise version
	const methodText = sessionForFrameMethod.getText();
	sessionForFrameMethod.replaceWithText(methodText.replace('Frame has been detached.', 'Frame was detached'));


	// ------- FrameSession Class -------
	const frameSessionClass = crPageSourceFile.getClassOrThrow("FrameSession");
	// Add Properties to the Frame Class
	frameSessionClass.addProperty({
		name: "_exposedBindingNames",
		type: "string[]",
		initializer: "[]",
	});
	frameSessionClass.addProperty({
		name: "_evaluateOnNewDocumentScripts",
		type: "string[]",
		initializer: "[]",
	});
	frameSessionClass.addProperty({
		name: "_parsedExecutionContextIds",
		type: "number[]",
		initializer: "[]",
	});
	frameSessionClass.addProperty({
		name: "_exposedBindingScripts",
		type: "string[]",
		initializer: "[]",
	});

	// -- _initialize Method --
	const initializeFrameSessionMethod = frameSessionClass.getMethodOrThrow("_initialize");
	const initializeFrameSessionMethodBody = initializeFrameSessionMethod.getBodyOrThrow().asKindOrThrow(SyntaxKind.Block);
	initializeFrameSessionMethod.insertStatements(0, `const pageEnablePromise = this._client.send('Page.enable');`);

	// Buffer dialog events for main frames so that dialogs on newly opened popups are never missed
	const addBrowserListenersStatement = assertDefined(
		initializeFrameSessionMethod
			.getStatements()
			.find((statement) => statement.getText().includes("this._addBrowserListeners()"))
	);
	initializeFrameSessionMethodBody.insertStatements(addBrowserListenersStatement.getChildIndex(), `
		let bufferedDialogEvents: any[] | undefined = this._isMainFrame() ? [] : undefined;
		if (bufferedDialogEvents)
			this._eventListeners.push(eventsHelper.addEventListener(this._client, 'Page.javascriptDialogOpening', (event: any) => bufferedDialogEvents ? bufferedDialogEvents.push(event) : undefined));
	`);

	const promisesDeclaration = initializeFrameSessionMethod.getVariableDeclarationOrThrow("promises");
	// Find the initializer array
	const promisesInitializer = promisesDeclaration.getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);
	// Find the relevant element inside the array that we need to update
	promisesInitializer
		.getElements()
		.filter((element) => 
			element.getText().includes("this._client.send('Runtime.enable'") ||
			element.getText().includes("this._client.send('Runtime.addBinding', { name: PageBinding.kPlaywrightBinding })")
		)
		.forEach((element) => { promisesInitializer.removeElement(element); });
	// Replace Page.enable send in promises with the early-started promise
	promisesInitializer
		.getElements()
		.filter((element) => element.getText().trim() === "this._client.send('Page.enable')")
		.forEach((element) => { element.replaceWithText("pageEnablePromise"); });
	
	// Find the relevant element inside the array that we need to update
	const pageGetFrameTreeElement = assertDefined(
		promisesInitializer
			.getElements()
			.find((element) => element.getText().startsWith("this._client.send('Page.getFrameTree'"))
	);
	const pageGetFrameTreeThenBlock = pageGetFrameTreeElement
		.asKindOrThrow(SyntaxKind.CallExpression)
		.getFirstDescendantByKindOrThrow(SyntaxKind.ArrowFunction)
		.getBody()
		.asKindOrThrow(SyntaxKind.Block);
	// Replay buffered dialog events after _addRendererListeners()
	const addRendererListenersIfStatement = assertDefined(
		pageGetFrameTreeThenBlock
			.getStatements()
			.find(
				(statement) =>
					statement.isKind(SyntaxKind.IfStatement) &&
					statement.getText().includes("this._addRendererListeners()"),
			)
	);
	addRendererListenersIfStatement
		.asKindOrThrow(SyntaxKind.IfStatement)
		.getThenStatement()
		.asKindOrThrow(SyntaxKind.Block)
		.addStatements(`
			// Replay any dialog events that arrived before _addRendererListeners
			const pendingDialogEvents = bufferedDialogEvents || [];
			bufferedDialogEvents = undefined;
			for (const event of pendingDialogEvents)
				this._onDialog(event);
		`);
	// Remove old loop and logic for localFrames and isolated world creation
	pageGetFrameTreeThenBlock
		.getStatements()
		.filter(
			(statement) =>
				statement.getText().includes("const localFrames = this._isMainFrame() ? this._page.frames()") ||
				statement.getText().includes("this._client._sendMayFail('Page.createIsolatedWorld', {"),
		)
		.forEach((statement) => { statement.remove() });
	// Find the non-initial navigation branch and ensure our localFrames setup is present.
	const lifecycleEventIfStatement = assertDefined(
		initializeFrameSessionMethodBody
			.getDescendantsOfKind(SyntaxKind.IfStatement)
			.find((statement) => statement.getText().includes("this._firstNonInitialNavigationCommittedFulfill()"))
	);
	const lifecycleEventElseBlock = assertDefined(
		lifecycleEventIfStatement
			.getElseStatement()
	);
	lifecycleEventElseBlock
		.asKindOrThrow(SyntaxKind.Block)
		.insertStatements(0, `
			const localFrames = this._isMainFrame() ? this._page.frames() : [this._page.frameManager.frame(this._targetId)!];
			for (const frame of localFrames) {
				this._page.frameManager.frame(frame._id)._context("utility").catch(() => {});
				for (const binding of this._crPage._browserContext._pageBindings.values())
					frame.evaluateExpression(binding.source).catch(e => {});
				for (const source of this._crPage._browserContext.initScripts)
					frame.evaluateExpression(source.source).catch(e => {});
				for (const source of this._crPage._page.initScripts)
					frame.evaluateExpression(source.source).catch(e => {});
			}
		`);
		
	// Allow focus control on pages https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/issues/137#event-20580557051
	const focusEmulationIfStatement = assertDefined(
		initializeFrameSessionMethodBody
			.getDescendantsOfKind(SyntaxKind.IfStatement)
			.find((statement) => 
				statement.getText().startsWith("if (this._isMainFrame()") &&
				statement.getText().includes("Emulation.setFocusEmulationEnabled")
			)
	);
	focusEmulationIfStatement.replaceWithText(`
		if (this._isMainFrame() && !this._crPage._browserContext._options.focusControl)
			promises.push(this._client.send("Emulation.setFocusEmulationEnabled", { enabled: true }));
	`);
	// Find and patch the initScript Evaluation Loop to inject pageBindings alongside initScripts for both main and utility contexts
	initializeFrameSessionMethodBody
		.getDescendantsOfKind(SyntaxKind.ForOfStatement)
		.filter((statement) => statement.getText().includes("this._crPage._page.allInitScripts()"))
		.forEach((statement) => {
			if (statement.getText().includes("frame.evaluateExpression(initScript.source)"))
				statement.replaceWithText(`
					for (const binding of this._crPage._browserContext._pageBindings.values()) frame.evaluateExpression(binding.source).catch(e => {});
					for (const initScript of this._crPage._browserContext.initScripts) frame.evaluateExpression(initScript.source).catch(e => {});
				`);
			else if (statement.getText().includes("promises.push(this._evaluateOnNewDocument("))
				statement.replaceWithText(`
					  for (const binding of this._crPage._page.allBindings()) promises.push(this._initBinding(binding));
					  for (const initScript of this._crPage._browserContext.initScripts) promises.push(this._evaluateOnNewDocument(initScript, 'main'));
					  for (const initScript of this._crPage._page.initScripts) promises.push(this._evaluateOnNewDocument(initScript, 'main'));
				`);
		});
	// Find the statement `promises.push(this._client.send('Runtime.runIfWaitingForDebugger'))`
	const promisePushStatements = initializeFrameSessionMethodBody
		.getStatements()
		.filter((statement) => statement.getText().includes("promises.push(this._client.send('Runtime.runIfWaitingForDebugger'))"));
	// Ensure the right statements were found
	if (promisePushStatements.length === 1) {
		// Replace the first `promises.push` statement with the new conditional code
		promisePushStatements[0].replaceWithText(`
			if (!(this._crPage._page._pageBindings.size || this._crPage._browserContext._pageBindings.size))
				promises.push(this._client.send('Runtime.runIfWaitingForDebugger'));
		`);
		initializeFrameSessionMethodBody.addStatements(`
			if (this._crPage._page._pageBindings.size || this._crPage._browserContext._pageBindings.size)
				await this._client.send('Runtime.runIfWaitingForDebugger');
		`);
	}

	// -- _initBinding Method --
	frameSessionClass.addMethod({
		name: "_initBinding",
		isAsync: true,
		parameters: [
			{
				name: "binding",
				initializer: "PageBinding",
			},
		],
	});
	const initBindingMethod = frameSessionClass.getMethodOrThrow("_initBinding");
	initBindingMethod.setBodyText(`
		// Remember this binding so future execution contexts get it in _onExecutionContextCreated.
		this._exposedBindingNames.push(binding.name);
		this._exposedBindingScripts.push(binding.source);

		// Install binding in all existing execution contexts.
		const contextIds = Array.from(this._contextIdToContext.keys());
		await Promise.all([
			this._client._sendMayFail('Runtime.addBinding', { name: binding.name }),
			...contextIds.map(executionContextId => this._client._sendMayFail('Runtime.addBinding', { name: binding.name, executionContextId })),
		]);

		// Evaluate binding bootstrap in all existing execution contexts.
		const evaluationPromises = contextIds.map(contextId =>
			this._client._sendMayFail('Runtime.evaluate', {
				expression: binding.source,
				contextId,
				awaitPromise: true,
			}).catch(e => { }),
		);
		await Promise.all(evaluationPromises);
	`);
			
	// -- _removeExposedBindings Method --
	frameSessionClass.addMethod({
		name: "_removeExposedBindings",
		isAsync: true,
	});
	const fsRemoveExposedBindingsMethod = frameSessionClass.getMethodOrThrow("_removeExposedBindings");
	fsRemoveExposedBindingsMethod.setBodyText(`
		const toRetain: string[] = [];
		const toRemove: string[] = [];
		for (const name of this._exposedBindingNames)
			(name.startsWith('__pw_') ? toRetain : toRemove).push(name);
		this._exposedBindingNames = toRetain;
		await Promise.all(toRemove.map(name => this._client.send('Runtime.removeBinding', { name })));
	`);

	// -- _onLifecycleEvent Method --
	const onLifecycleEventMethod = frameSessionClass.getMethodOrThrow("_onLifecycleEvent");
	onLifecycleEventMethod.setIsAsync(true);
	onLifecycleEventMethod.addStatements(`
		// Only do full init script cleanup on load to reduce CDP round-trip pressure.
		// Other lifecycle events just get a minimal runIfWaitingForDebugger call.
		if (event.name !== "load") {
		  await this._client._sendMayFail('Runtime.runIfWaitingForDebugger');
		  return;
		}
		await this._client._sendMayFail('Runtime.runIfWaitingForDebugger');
		var document = await this._client._sendMayFail("DOM.getDocument");
		if (!document) return
		var query = await this._client._sendMayFail("DOM.querySelectorAll", {
		  nodeId: document.root.nodeId,
		  selector: "[class=" + this._crPage.initScriptTag + "]"
		});
		if (!query) return
		for (const nodeId of query.nodeIds) await this._client._sendMayFail("DOM.removeNode", { nodeId: nodeId });
		await this._client._sendMayFail('Runtime.runIfWaitingForDebugger');
		// ensuring execution context
		try { await this._page.frameManager.frame(this._targetId)._context("utility") } catch { };
	`);

	// -- _onFrameNavigated Method --´
	const onFrameNavigatedMethod = frameSessionClass.getMethodOrThrow("_onFrameNavigated");
	onFrameNavigatedMethod.setIsAsync(true);
	onFrameNavigatedMethod.addStatements(`
		await this._client._sendMayFail('Runtime.runIfWaitingForDebugger');
		// patchright: For non-initial navigations, skip DOM cleanup since the document just changed
		// and init script tags haven't been re-added yet. The _onLifecycleEvent("load") handler
		// will perform cleanup after the page finishes loading.
		if (!initial) {
			try { await this._page.frameManager.frame(this._targetId)._context("utility") } catch { };
			return;
		}
		var document = await this._client._sendMayFail("DOM.getDocument");
		if (!document) return
		var query = await this._client._sendMayFail("DOM.querySelectorAll", {
			nodeId: document.root.nodeId,
			selector: "[class=" + this._crPage.initScriptTag + "]"
		});
		if (!query) return
		for (const nodeId of query.nodeIds) await this._client._sendMayFail("DOM.removeNode", { nodeId: nodeId });
		await this._client._sendMayFail('Runtime.runIfWaitingForDebugger');
		// ensuring execution context
		try { await this._page.frameManager.frame(this._targetId)._context("utility") } catch { };
	`);

	// -- _onExecutionContextCreated Method --
	const onExecutionContextCreatedMethod = frameSessionClass.getMethodOrThrow("_onExecutionContextCreated");
	onExecutionContextCreatedMethod.insertStatements(0, `
		for (const name of this._exposedBindingNames)
			this._client._sendMayFail('Runtime.addBinding', { name: name, executionContextId: contextPayload.id });
	`);
	onExecutionContextCreatedMethod.insertStatements(2, `
		if (contextPayload.auxData?.type === "worker") throw new Error("ExecutionContext is worker");
	`);
	// Replace the legacy worldName branching logic with a direct assignment from contextPayload.name.
	onExecutionContextCreatedMethod
		.getStatements()
		.filter((statement) =>
			statement.getText().includes("let worldName: types.World") ||
			statement.getText().includes("if (contextPayload.auxData && !!contextPayload.auxData.isDefault)") ||
			statement.getText().includes("worldName = 'main'") ||
			statement.getText().includes("else if (contextPayload.name === UTILITY_WORLD_NAME)") ||
			statement.getText().includes("worldName = 'utility'")
		)
		.forEach((statement, index) => {
			if (index === 0) statement.replaceWithText("let worldName = contextPayload.name;");
			else statement.remove();
		});
	// Guard _contextCreated to only register known worlds ('main' or 'utility')
	const contextCreatedIfStatement = assertDefined(
		onExecutionContextCreatedMethod
			.getDescendantsOfKind(SyntaxKind.IfStatement)
			.find((stmt) => stmt.getText().includes("if (worldName)") && stmt.getText().includes("_contextCreated"))
	);
	contextCreatedIfStatement.replaceWithText(`
		if (worldName && (worldName === 'main' || worldName === 'utility'))
			frame._contextCreated(worldName, context);
	`);
	// Execute all exposed binding scripts in the created execution context
	onExecutionContextCreatedMethod.addStatements(`
		for (const source of this._exposedBindingScripts) {
			this._client._sendMayFail("Runtime.evaluate", {
				expression: source,
				contextId: contextPayload.id,
				awaitPromise: true,
			})
		}
	`);

	// -- _onAttachedToTarget Method --
	const onAttachedToTargetMethod = frameSessionClass.getMethodOrThrow("_onAttachedToTarget");
	onAttachedToTargetMethod.setIsAsync(true);
	// Intercept the Runtime.executionContextCreated event to create execution contexts and extract globalThis objectId
	const sessionOnceCall = assertDefined(
		onAttachedToTargetMethod
			.getDescendantsOfKind(SyntaxKind.ExpressionStatement)
			.find((statement) => statement.getText().includes("session.once('Runtime.executionContextCreated'"))
	);
	sessionOnceCall
		.getParentIfKindOrThrow(SyntaxKind.Block)
		.insertStatements(sessionOnceCall.getChildIndex() + 1, `
			var globalThis = await session._sendMayFail('Runtime.evaluate', {
				expression: "globalThis",
				serializationOptions: { serialization: "idOnly" }
			});
			if (globalThis && globalThis.result) {
				var globalThisObjId = globalThis.result.objectId;
				var executionContextId = parseInt(globalThisObjId.split('.')[1], 10);
				worker.createExecutionContext(new CRExecutionContext(session, { id: executionContextId }));
			}
		`);
		
	// Remove `Runtime.enable` calls
	const runtimeStatementToRemove = assertDefined(
		onAttachedToTargetMethod
		.getStatements()
		.find((statement) => statement.getText().includes("session._sendMayFail('Runtime.enable');"))
	);
	runtimeStatementToRemove.remove();

	// -- _onBindingCalled Method --
	const onBindingCalledMethod = frameSessionClass.getMethodOrThrow("_onBindingCalled");
	// Fall back to the main frame context when no context is available for binding callbacks.
	const onBindingCalledIfStatement = assertDefined(
		onBindingCalledMethod
			.getDescendantsOfKind(SyntaxKind.IfStatement)
			.find((statement) =>
				statement.getExpression().getText() === "context" &&
					statement.getText().includes("await this._page.onBindingCalled(event.payload, context)"),
			)
	);
	onBindingCalledIfStatement.replaceWithText(`
		if (context) await this._page.onBindingCalled(event.payload, context);
		else await this._page._onBindingCalled(event.payload, (await this._page.mainFrame()._mainContext())) // This might be a bit sketchy but it works for now
	`);

	// -- _evaluateOnNewDocument Method --
	frameSessionClass
		.getMethodOrThrow("_evaluateOnNewDocument")
		.setBodyText(`this._evaluateOnNewDocumentScripts.push(initScript);		`);

	// -- _removeEvaluatesOnNewDocument Method --
	frameSessionClass
		.getMethodOrThrow("_removeEvaluatesOnNewDocument")
		.setBodyText(`
			const toRemove = new Set(initScripts);
			this._evaluateOnNewDocumentScripts = this._evaluateOnNewDocumentScripts.filter(script => !toRemove.has(script));
		`);

	// -- _adoptBackendNodeId Method --
	const adoptBackendNodeIdMethod = frameSessionClass.getMethodOrThrow("_adoptBackendNodeId");
	// Simplify the executionContextId lookup by accessing the delegate directly instead of casting through any.
	const resolveNodeResultStatement = assertDefined(
		adoptBackendNodeIdMethod
			.getVariableStatements()
			.find(
				(statement) =>
					statement.getText().includes("const result = await this._client._sendMayFail('DOM.resolveNode'") &&
					statement.getText().includes("executionContextId: (to.delegate as CRExecutionContext)._contextId"),
			)
	);
	const executionContextIdAssignment = assertDefined(
		resolveNodeResultStatement
			.getDescendantsOfKind(SyntaxKind.PropertyAssignment)
			.find((assignment) => assignment.getName() === "executionContextId")
	);
	executionContextIdAssignment.setInitializer("to.delegate._contextId");
}