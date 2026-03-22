import type { Project } from "ts-morph";

// --------------------
// server/javascript.ts
// --------------------
export function patchJavascript(project: Project) {
	// Add source file to the project
	const javascriptSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/javascript.ts");
	javascriptSourceFile.addImportDeclaration({
		moduleSpecifier: "./dom",
		namespaceImport: "domValue",
	});

	// -------JSHandle Class -------
	const jsHandleClass = javascriptSourceFile.getClassOrThrow("JSHandle");

	// -- evaluateExpression Method --
	const jsHandleEvaluateExpressionMethod = jsHandleClass.getMethodOrThrow("evaluateExpression");
	jsHandleEvaluateExpressionMethod.addParameter({
		name: "isolatedContext",
		type: "boolean",
		hasQuestionToken: true,
	});
	jsHandleEvaluateExpressionMethod.replaceWithText(
		jsHandleEvaluateExpressionMethod.getText().replace(/this\._context/g, "context")
	);
	// Initialize context with frame-specific context if needed
	jsHandleEvaluateExpressionMethod.insertStatements(0, `
		let context = this._context;
		if (context instanceof domValue.FrameExecutionContext) {
			const frame = context.frame;
			if (frame) {
				if (isolatedContext === true)
					context = await frame._utilityContext();
				else if (isolatedContext === false)
					context = await frame._mainContext();
			}
		}
		if (context !== this._context && context.adoptIfNeeded(this) === null)
			context = this._context;
	`);

	// -- evaluateExpressionHandle Method --
	const jsHandleEvaluateExpressionHandleMethod = jsHandleClass.getMethodOrThrow("evaluateExpressionHandle");
	jsHandleEvaluateExpressionHandleMethod.addParameter({
		name: "isolatedContext",
		type: "boolean",
		hasQuestionToken: true,
	});
	jsHandleEvaluateExpressionHandleMethod.replaceWithText(
			jsHandleEvaluateExpressionHandleMethod.getText().replace(/this\._context/g, "context")
	);
	// Initialize context with frame-specific context if needed
	jsHandleEvaluateExpressionHandleMethod.insertStatements(0, `
		let context = this._context;
		if (context instanceof domValue.FrameExecutionContext) {
			const frame = context.frame;
			if (frame) {
				if (isolatedContext === true)
					context = await frame._utilityContext();
				else if (isolatedContext === false)
					context = await frame._mainContext();
			}
		}
		if (context !== this._context && context.adoptIfNeeded(this) === null)
			context = this._context;
	`);
}