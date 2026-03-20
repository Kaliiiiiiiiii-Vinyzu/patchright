import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ----------------------------------------
// server/dispatchers/jsHandleDispatcher.ts
// ----------------------------------------
export function patchJSHandleDispatcher(project: Project) {
	// Add source file to the project
	const jsHandleDispatcherSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/dispatchers/jsHandleDispatcher.ts");

	// ------- workerDispatcher Class -------
	const jsHandleDispatcherClass = jsHandleDispatcherSourceFile.getClassOrThrow("JSHandleDispatcher");

	// -- evaluateExpression Method --
	// -- evaluateExpressionHandle Method --
	for (const evaluateMethodName of ["evaluateExpression", "evaluateExpressionHandle"]) {
		const jsHandleDispatcherEvaluateMethod = jsHandleDispatcherClass.getMethodOrThrow(evaluateMethodName);
		// Pass isolatedContext through to evaluateExpression so the dispatcher preserves context state.
		const jsHandleDispatcherEvaluateExpressionCall = assertDefined(
			jsHandleDispatcherEvaluateMethod
				.getDescendantsOfKind(SyntaxKind.CallExpression)
				.find(call => call.getExpression().getText().includes("this._object.evaluateExpression"))
		);
		jsHandleDispatcherEvaluateExpressionCall.addArgument("params.isolatedContext");
	}
}