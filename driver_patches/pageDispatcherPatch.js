import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/dispatchers/pageDispatcher.ts
// ----------------------------
export function patchPageDispatcher(project) {
    // Add source file to the project
    const pageDispatcherSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/dispatchers/pageDispatcher.ts");

    // ------- workerDispatcher Class -------
    const workerDispatcherClass = pageDispatcherSourceFile.getClass("WorkerDispatcher");

    // -- evaluateExpression Method --
    const workerDispatcherEvaluateExpressionMethod = workerDispatcherClass.getMethod("evaluateExpression");
    const workerDispatcherEvaluateExpressionReturn = workerDispatcherEvaluateExpressionMethod.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
    const workerDispatcherEvaluateExpressionCall = workerDispatcherEvaluateExpressionReturn.getFirstDescendantByKind(SyntaxKind.CallExpression).getFirstDescendantByKind(SyntaxKind.CallExpression);
    // add isolatedContext Bool Param
    if (workerDispatcherEvaluateExpressionCall && workerDispatcherEvaluateExpressionCall.getExpression().getText().includes("this._object.evaluateExpression")) {
          // Add the new argument to the function call
          workerDispatcherEvaluateExpressionCall.addArgument("params.isolatedContext");
    }

    // -- evaluateExpressionHandle Method --
    const workerDispatcherEvaluateExpressionHandleMethod = workerDispatcherClass.getMethod("evaluateExpressionHandle");
    const workerDispatcherEvaluateExpressionHandleReturn = workerDispatcherEvaluateExpressionHandleMethod.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
    const workerDispatcherEvaluateExpressionHandleCall = workerDispatcherEvaluateExpressionHandleReturn.getFirstDescendantByKind(SyntaxKind.CallExpression).getFirstDescendantByKind(SyntaxKind.CallExpression);
    // add isolatedContext Bool Param
    if (workerDispatcherEvaluateExpressionHandleCall && workerDispatcherEvaluateExpressionHandleCall.getExpression().getText().includes("this._object.evaluateExpression")) {
          // Add the new argument to the function call
          workerDispatcherEvaluateExpressionHandleCall.addArgument("params.isolatedContext");
    }
}