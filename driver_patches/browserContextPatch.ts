import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ------------------------
// server/browserContext.ts
// ------------------------
export function patchBrowserContext(project: Project) {
	// Add source file to the project
	const browserContextSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/browserContext.ts");

	// ------- BrowserContext Class -------
	const browserContextClass = browserContextSourceFile.getClassOrThrow("BrowserContext");

	// -- _initialize Method --
	const initializeMethod = browserContextClass.getMethodOrThrow("initialize");
	// Getting the service worker registration call
	const initializeMethodCall = assertDefined(
		initializeMethod
			.getDescendantsOfKind(SyntaxKind.CallExpression)
			.find(
				call =>
					call.getExpression().getText().includes("addInitScript") &&
					call.getArguments().some(arg => arg.getText().includes("navigator.serviceWorker.register")),
			),
	);
	const initScriptArgument = assertDefined(
		initializeMethodCall.getArguments()[1] ?? initializeMethodCall.getArguments()[0],
	);
	// Replace the service worker registration call with a custom one, which is less obvious
	initScriptArgument.replaceWithText(
		"`if (navigator.serviceWorker) navigator.serviceWorker.register = async () => { };`",
	);

	// -- exposeBinding Method --
	const exposeBindingMethod = browserContextClass.getMethodOrThrow("exposeBinding");
	exposeBindingMethod.getDescendantsOfKind(SyntaxKind.ExpressionStatement).forEach(statement => {
		const text = statement.getText();
		if (text.includes("this.doAddInitScript(binding.initScript)"))
			statement.replaceWithText("if (!binding.noGlobal)\n\tawait this.doExposeBinding(binding);");
		else if (
			text.includes("this.safeNonStallingEvaluateInAllFrames(binding.initScript.source, 'main')") ||
			text.includes("this.exposePlaywrightBindingIfNeeded()")
		)
			statement.remove();
	});

	// -- removeExposedBinding Method --
	const removeExposedBindingMethod = browserContextClass.getMethodOrThrow("removeExposedBinding");
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

	// -- defaultNewContextParamValues ClassVar --
	const defaultContextExpression = browserContextSourceFile
		.getVariableDeclarationOrThrow("defaultNewContextParamValues")
		.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
	// Add focusControl Parameter
	if (!defaultContextExpression.getProperty("focusControl"))
		defaultContextExpression.addPropertyAssignment({ name: "focusControl", initializer: "false" });
}
