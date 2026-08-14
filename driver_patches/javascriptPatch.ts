import type { Project } from "ts-morph";

// --------------------
// server/javascript.ts
// --------------------
export function patchJavascript(project: Project) {
	// Add source file to the project
	const javascriptSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/javascript.ts");
	const executionContextDelegateInterface = javascriptSourceFile.getInterfaceOrThrow("ExecutionContextDelegate");
	executionContextDelegateInterface.addMethod({
		name: "findFunctions",
		hasQuestionToken: true,
		parameters: [
			{ name: "context", type: "ExecutionContext" },
			{ name: "name", type: "string" },
		],
		returnType: "Promise<JSHandle[]>",
	});

	javascriptSourceFile.getClassOrThrow("ExecutionContext").addMethod({
		name: "findFunctions",
		isAsync: true,
		parameters: [{ name: "name", type: "string" }],
		returnType: "Promise<JSHandle[]>",
		statements: `
			const utilityScript = await this._utilityScript();
			const callback = await utilityScript.evaluateHandle((utilityScript: any, name) => utilityScript.takeFunctionCallback(name), name);
			if (callback._objectId)
				return [callback];
			callback.dispose();
			if (!this.delegate.findFunctions)
				return [];
			return this.raceAgainstContextDestroyed(this.delegate.findFunctions(this, name));
		`,
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
