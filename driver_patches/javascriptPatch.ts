import type { Project } from "ts-morph";

// --------------------
// server/javascript.ts
// --------------------
export function patchJavascript(project: Project) {
	// Add source file to the project
	const javascriptSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/javascript.ts");
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
		jsHandleEvaluateExpressionMethod
			.getText()
			.replace(
				/this\.internalEvaluateExpression\(expression, options, arg\)/g,
				"this.internalEvaluateExpression(expression, options, arg)",
			),
	);

	// -- evaluateExpressionHandle Method --
	const jsHandleEvaluateExpressionHandleMethod = jsHandleClass.getMethodOrThrow("evaluateExpressionHandle");
	jsHandleEvaluateExpressionHandleMethod.addParameter({
		name: "isolatedContext",
		type: "boolean",
		hasQuestionToken: true,
	});
	jsHandleEvaluateExpressionHandleMethod.replaceWithText(
		jsHandleEvaluateExpressionHandleMethod
			.getText()
			.replace(
				/this\._evaluateExpressionHandle\(expression, options, arg\)/g,
				"this._evaluateExpressionHandle(expression, options, arg)",
			),
	);
}
