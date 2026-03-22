import { type Project, SyntaxKind } from "ts-morph";

// ------------------------------------
// server/dispatchers/pageDispatcher.ts
// ------------------------------------
export function patchPageDispatcher(project: Project) {
	// Add source file to the project
	const pageDispatcherSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/dispatchers/pageDispatcher.ts");

	// ------- workerDispatcher Class -------
	const workerDispatcherClass = pageDispatcherSourceFile.getClassOrThrow("WorkerDispatcher");

	// -- evaluateExpression Method --
	// -- evaluateExpressionHandle Method --
	for (const evaluateMethodName of ["evaluateExpression", "evaluateExpressionHandle"]) {
		const workerDispatcherEvaluateMethod = workerDispatcherClass.getMethodOrThrow(evaluateMethodName);
		const workerDispatcherEvaluateCall = workerDispatcherEvaluateMethod
			.getFirstDescendantByKindOrThrow(SyntaxKind.ReturnStatement)
			.getFirstDescendantByKindOrThrow(SyntaxKind.CallExpression)
			.getFirstDescendantByKindOrThrow(SyntaxKind.CallExpression)
		// Forward the isolatedContext param from the dispatcher to the underlying evaluateExpression call.
		if (workerDispatcherEvaluateCall.getExpression().getText().includes("this._object.evaluateExpression"))
			workerDispatcherEvaluateCall.addArgument("params.isolatedContext");
	}
}