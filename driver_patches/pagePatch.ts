import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// --------------
// server/page.ts
// --------------
export function patchPage(project: Project) {
	// Add source file to the project
	const pageSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/page.ts");
	const selectorParserImport = pageSourceFile.getImportDeclarationOrThrow("@isomorphic/selectorParser");
	if (!selectorParserImport.getNamedImports().some(namedImport => namedImport.getName() === "splitSelectorByFrame"))
		selectorParserImport.addNamedImport("splitSelectorByFrame");
	pageSourceFile.addImportDeclaration({
		moduleSpecifier: "./dom",
		namespaceImport: "domValue",
	});
	// Add the custom import and comment at the start of the file
	pageSourceFile.addImportDeclaration({
		moduleSpecifier: "./pageBinding",
		namedImports: ["createPageBindingScript", "deliverBindingResult"],
	});

	// ------- Page Class -------
	const pageClass = pageSourceFile.getClassOrThrow("Page");

	// -- exposeBinding Method --
	const pageExposeBindingMethod = pageClass.getMethodOrThrow("exposeBinding");
	pageExposeBindingMethod.setBodyText(`
		if (this._pageBindings.has(name))
			throw new Error(\`Function "\${name}" has been already registered\`);
		if (this.browserContext._pageBindings.has(name))
			throw new Error(\`Function "\${name}" has been already registered in the browser context\`);
		const binding = new PageBinding(this, name, playwrightBinding, !!noGlobal);
		this._pageBindings.set(name, binding);
		if (binding.noGlobal) {
			for (const frame of this.frames()) {
				for (const context of [frame.mainContext(), frame.utilityContext()])
					context.then(context => binding.dispatchFunction(this, context)).catch(() => {});
			}
		} else {
			await this.delegate.exposeBinding(binding);
		}
		return binding;
	`);

	// -- removeExposedBinding Method --
	const removeExposedBindingMethod = pageClass.getMethodOrThrow("removeExposedBinding");
	const deleteBindingStatement = assertDefined(
		removeExposedBindingMethod
			.getStatements()
			.find(statement => statement.getText().includes("this._pageBindings.delete")),
	);
	removeExposedBindingMethod.insertStatements(
		deleteBindingStatement.getChildIndex() + 1,
		`
		if (binding.noGlobal) {
			await binding.disposeFunctionCallbacks();
			return;
		}
	`,
	);

	// -- allInitScripts Method --
	pageClass.getMethodOrThrow("allInitScripts").remove();

	// -- allBindings Method --
	pageClass.addMethod({
		name: "allBindings",
	});
	const allBindingsMethod = pageClass.getMethodOrThrow("allBindings");
	allBindingsMethod.setBodyText(`
		return [...this.browserContext._pageBindings.values(), ...this._pageBindings.values()];
	`);

	// ------- PageBinding Class -------
	const pageBindingClass = pageSourceFile.getClassOrThrow("PageBinding");
	// Content modified from https://raw.githubusercontent.com/microsoft/playwright/471930b1ceae03c9e66e0eb80c1364a1a788e7db/packages/playwright-core/src/server/page.ts
	pageBindingClass.replaceWithText(`
		export class PageBinding extends DisposableObject {
			readonly source: string;
			readonly name: string;
			readonly playwrightFunction: frames.FunctionWithSource;
			readonly initScript: InitScript;
			readonly noGlobal: boolean;
			readonly cleanupScript: string;
			private _callbackBridges = new Set<js.JSHandle>();
			private _functionCallbacksDisposed = false;
			forClient?: unknown;

			constructor(parent: BrowserContext | Page, name: string, playwrightFunction: frames.FunctionWithSource, noGlobal: boolean) {
				super(parent);
				this.name = name;
				this.playwrightFunction = playwrightFunction;
				this.noGlobal = noGlobal;
				this.initScript = new InitScript(parent, noGlobal ? '' : createPageBindingScript(name, false));
				this.source = noGlobal ? '' : this.initScript.source;
				this.cleanupScript = noGlobal ? '' : \`delete globalThis[\${JSON.stringify(name)}];\`;
			}

			async dispatchFunction(page: Page, context: js.ExecutionContext) {
				for (let retryDelay = 10; !this._functionCallbacksDisposed && page.getBinding(this.name) === this; retryDelay = Math.min(retryDelay * 2, 1000)) {
					const bridges = await context.findFunctions(this.name).catch(() => []);
					let installed = false;
					for (const bridge of bridges) {
						const claimed = await bridge.evaluate((bridge: any) => bridge({ type: 'claim' })).catch(() => false);
						if (!claimed) {
							bridge.dispose();
							continue;
						}
						if (this._functionCallbacksDisposed || page.getBinding(this.name) !== this) {
							await bridge.evaluate((bridge: any) => bridge({ type: 'dispose' })).catch(() => {});
							bridge.dispose();
							continue;
						}
						installed = true;
						this._callbackBridges.add(bridge);
						this._dispatchFunctionCalls(page, context, bridge).catch(() => {});
					}
					if (installed)
						return;
					const retry = await context.raceAgainstContextDestroyed(
						new Promise<boolean>(resolve => setTimeout(() => resolve(true), retryDelay))
					).catch(() => false);
					if (!retry)
						return;
				}
			}

			private async _dispatchFunctionCalls(page: Page, context: js.ExecutionContext, bridge: js.JSHandle) {
				try {
					while (page.getBinding(this.name) === this) {
						const call = await bridge.evaluate((bridge: any) => bridge({ type: 'next' }));
						if (!call)
							break;
						this._dispatchFunctionCall(page, context, bridge, call).catch(() => {});
					}
				} finally {
					this._callbackBridges.delete(bridge);
					bridge.dispose();
				}
			}

			private async _dispatchFunctionCall(page: Page, context: js.ExecutionContext, bridge: js.JSHandle, call: any) {
				try {
					if (!Array.isArray(call.serializedArgs))
						throw new Error('serializedArgs is not an array. This can happen when Array.prototype.toJSON is defined incorrectly');
					const frame = context.attribution.frame;
					if (!frame)
						throw new Error('Function callback must run in a frame');
					const args = call.serializedArgs.map((arg: any) => parseEvaluationResultValue(arg));
					const result = await this.playwrightFunction({ frame, page, context: page.browserContext }, ...args);
					await bridge.evaluate((bridge: any, { seq, result }) => bridge({ type: 'resolve', seq, result }), { seq: call.seq, result });
				} catch (error) {
					await bridge.evaluate((bridge: any, { seq, error }) => bridge({ type: 'reject', seq, error }), { seq: call.seq, error }).catch(() => {});
				}
			}

			async disposeFunctionCallbacks() {
				this._functionCallbacksDisposed = true;
				const bridges = [...this._callbackBridges];
				this._callbackBridges.clear();
				await Promise.all(bridges.map(async bridge => {
					await bridge.evaluate((bridge: any) => bridge({ type: 'dispose' })).catch(() => {});
					bridge.dispose();
				}));
			}

			static async dispatch(page: Page, payload: string, context: dom.FrameExecutionContext) {
				const { name, seq, serializedArgs } = JSON.parse(payload) as BindingPayload;

				const deliver = async (deliverPayload: any) => {
					let deliveryError: any;
					try {
						await context.evaluate(deliverBindingResult, deliverPayload);
						return;
					} catch (e) {
						deliveryError = e;
					}
					const frame = context.frame;
					if (!frame) {
						debugLogger.log('error', deliveryError);
						return;
					}
					const mainContext = await frame.mainContext().catch(() => null);
					const utilityContext = await frame.utilityContext().catch(() => null);
					for (const ctx of [mainContext, utilityContext]) {
						if (!ctx || ctx === context)
							continue;
						try {
							await ctx.evaluate(deliverBindingResult, deliverPayload);
							return;
						} catch {
						}
					}
					debugLogger.log('error', deliveryError);
				};

				try {
					assert(context.world);
					const binding = page.getBinding(name);
					if (!binding)
						throw new Error(\`Function "\${name}" is not exposed\`);

					if (!Array.isArray(serializedArgs))
						throw new Error(\`serializedArgs is not an array. This can happen when Array.prototype.toJSON is defined incorrectly\`);
					const args = serializedArgs.map(a => parseEvaluationResultValue(a));
					const result = await binding.playwrightFunction({ frame: context.frame, page, context: page.browserContext }, ...args);
					await deliver({ name, seq, result });
				} catch (error) {
					await deliver({ name, seq, error });
				}
			}

			override async dispose(): Promise<void> {
				await this.parent.removeExposedBinding(this);
			}
		}
	`);

	// ------- InitScript Class -------
	const initScriptClass = pageSourceFile.getClassOrThrow("InitScript");
	// -- InitScript Constructor --
	const initScriptConstructorAssignment = assertDefined(
		initScriptClass
			.getConstructors()[0]
			.getStatements()
			.find(s => s.getKind() === SyntaxKind.ExpressionStatement && s.getText().includes("this.source = `(() => {")),
	);
	initScriptConstructorAssignment.replaceWithText("this.source = `(() => { ${source} })();`;");

	// ------- Worker Class -------
	const workerClass = pageSourceFile.getClassOrThrow("Worker");
	// -- evaluateExpression Method --
	// -- evaluateExpressionHandle Method --
	for (const evaluateMethodName of ["evaluateExpression", "evaluateExpressionHandle"]) {
		const workerEvaluateMethod = workerClass.getMethodOrThrow(evaluateMethodName);
		workerEvaluateMethod.addParameter({
			name: "isolatedContext",
			type: "boolean",
			hasQuestionToken: true,
		});
		workerEvaluateMethod.replaceWithText(
			workerEvaluateMethod.getText().replace(/await this\._executionContextPromise/g, "context"),
		);
		// Insert the new line of code after the responseAwaitStatement
		workerEvaluateMethod.insertStatements(0, `
			let context = await this._executionContextPromise;
			if (context instanceof domValue.FrameExecutionContext) {
				const frame = context.frame;
				if (frame) {
					if (isolatedContext) context = await frame.utilityContext();
					else if (!isolatedContext) context = await frame.mainContext();
				}
			}
		`);
	}

	const pagePerformLocatorHandlersCheckpointMethod = pageClass.getMethodOrThrow("_performLocatorHandlersCheckpoint");
	const waitForHiddenStatement = pagePerformLocatorHandlersCheckpointMethod
		.getDescendantsOfKind(SyntaxKind.ExpressionStatement)
		.find(
			statement =>
				statement.getText() ===
				"await this.mainFrame().waitForSelector(progress, handler.selector, false, { state: 'hidden' });",
		);
	if (waitForHiddenStatement)
		waitForHiddenStatement.replaceWithText(`
			const frameChunks = splitSelectorByFrame(handler.selector);
			if (frameChunks.length > 1 && !await this.mainFrame().isVisibleInternal(progress, stringifySelector(frameChunks[0]), { strict: true }))
				return;
			await this.mainFrame().waitForSelector(progress, handler.selector, false, { state: 'hidden' });
		`);
}
