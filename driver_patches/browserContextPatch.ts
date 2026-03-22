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
	const initializeMethod = browserContextClass.getMethodOrThrow("_initialize");
	// Getting the service worker registration call
	const initializeMethodCall = assertDefined(
		initializeMethod
		.getDescendantsOfKind(SyntaxKind.CallExpression)
		.find((call) =>
			call.getExpression().getText().includes("addInitScript") &&
			call.getArguments().some((arg) =>
				arg.getText().includes("navigator.serviceWorker.register")
			)
		)
	);
	// Replace the service worker registration call with a custom one, which is less obvious
	initializeMethodCall
		.getArguments()[1]
		.replaceWithText("`navigator.serviceWorker.register = async () => { };`");

	// -- exposeBinding Method --
	const exposeBindingMethod = browserContextClass.getMethodOrThrow("exposeBinding");
	// Remove old loop and logic for localFrames and isolated world creation
	exposeBindingMethod.getStatements().forEach((statement) => {
		const text = statement.getText();
		// Check if the statement matches the patterns
		if (text.includes("this.doAddInitScript(binding.initScript)"))
			statement.replaceWithText("await this.doExposeBinding(binding);");
		else if (
			text.includes("this.safeNonStallingEvaluateInAllFrames(binding.initScript.source, 'main')") ||
			text.includes("this.exposePlaywrightBindingIfNeeded()")
		)
			statement.remove();
	});

	// -- _removeExposedBindings Method --
	const removeExposedBindingsMethod = browserContextClass.getMethodOrThrow("removeExposedBindings");
	removeExposedBindingsMethod.setBodyText(`
		for (const key of this._pageBindings.keys()) {
			if (!key.startsWith('__pw'))
				this._pageBindings.delete(key);
		}
		await this.doRemoveExposedBindings();
	`);

	// -- _removeInitScripts Method --
	const removeInitScriptsMethod = browserContextClass.getMethodOrThrow("removeInitScripts");
	removeInitScriptsMethod.setBodyText(`
		this.initScripts.splice(0, this.initScripts.length);
		await this.doRemoveInitScripts();
	`);

	// -- defaultNewContextParamValues ClassVar --
	const defaultContextExpression = browserContextSourceFile
		.getVariableDeclarationOrThrow("defaultNewContextParamValues")
		.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
	// Add focusControl Parameter
	if (!defaultContextExpression.getProperty("focusControl"))
		defaultContextExpression.addPropertyAssignment({ name: "focusControl", initializer: "false" });
}
