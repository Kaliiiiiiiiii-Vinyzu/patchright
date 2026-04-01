import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// --------------
// server/page.ts
// --------------
export function patchPage(project: Project) {
	// Add source file to the project
	const pageSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/page.ts");
	pageSourceFile.addImportDeclaration({
		moduleSpecifier: "./dom",
		namespaceImport: "domValue",
	});
	// Add the custom import and comment at the start of the file
	pageSourceFile.addImportDeclaration({
		moduleSpecifier: "./pageBinding",
		namedImports: ["createPageBindingScript", "deliverBindingResult", "takeBindingHandle"],
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
		const binding = new PageBinding(name, playwrightBinding, needsHandle);
		this._pageBindings.set(name, binding);
		await this.delegate.exposeBinding(binding);
	`);

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
		export class PageBinding {
			readonly source: string;
			readonly name: string;
			readonly playwrightFunction: frames.FunctionWithSource;
			readonly needsHandle: boolean;
			readonly internal: boolean;

			constructor(name: string, playwrightFunction: frames.FunctionWithSource, needsHandle: boolean) {
				this.name = name;
				this.playwrightFunction = playwrightFunction;
				this.source = createPageBindingScript(name, needsHandle);
				this.needsHandle = needsHandle;
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
					const mainContext = await frame._mainContext().catch(() => null);
					const utilityContext = await frame._utilityContext().catch(() => null);
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

					let result: any;
					if (binding.needsHandle) {
						const handle = await context.evaluateHandle(takeBindingHandle, { name, seq }).catch(e => null);
						result = await binding.playwrightFunction({ frame: context.frame, page, context: page._browserContext }, handle);
					} else {
						if (!Array.isArray(serializedArgs))
							throw new Error(\`serializedArgs is not an array. This can happen when Array.prototype.toJSON is defined incorrectly\`);
						const args = serializedArgs!.map(a => parseEvaluationResultValue(a));
						result = await binding.playwrightFunction({ frame: context.frame, page, context: page._browserContext }, ...args);
					}
					await deliver({ name, seq, result });
				} catch (error) {
					await deliver({ name, seq, error });
				}
			}
		}
	`);

	// ------- InitScript Class -------
	const initScriptClass = pageSourceFile.getClassOrThrow("InitScript");
	// -- InitScript Constructor --
	const initScriptConstructorAssignment = assertDefined(
		initScriptClass.getConstructors()[0]
			.getStatements()
			.find(s =>
				s.getKind() === SyntaxKind.ExpressionStatement &&
				s.getText().includes("this.source = `(() => {")
			)
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
			workerEvaluateMethod.getText().replace(/await this\._executionContextPromise/g, "context")
		);
		// Insert the new line of code after the responseAwaitStatement
		workerEvaluateMethod.insertStatements(0, `
			let context = await this._executionContextPromise;
			if (context instanceof domValue.FrameExecutionContext) {
				const frame = context.frame;
				if (frame) {
					if (isolatedContext) context = await frame._utilityContext();
					else if (!isolatedContext) context = await frame._mainContext();
				}
			}
		`);
	}
}