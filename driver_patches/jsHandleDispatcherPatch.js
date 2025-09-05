import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/dispatchers/jsHandleDispatcher.ts
// ----------------------------
export function patchJSHandleDispatcher(project) {
    // Add source file to the project
    const jsHandleDispatcherSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/dispatchers/jsHandleDispatcher.ts");

    // ------- workerDispatcher Class -------
    const jsHandleDispatcherClass = jsHandleDispatcherSourceFile.getClass("JSHandleDispatcher");

    // -- evaluateExpression Method --
    const jsHandleDispatcherEvaluateExpressionMethod = jsHandleDispatcherClass.getMethod("evaluateExpression");
    const jsHandleDispatcherEvaluateExpressionReturn = jsHandleDispatcherEvaluateExpressionMethod.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
    const jsHandleDispatcherEvaluateExpressionCall = jsHandleDispatcherEvaluateExpressionReturn.getFirstDescendantByKind(SyntaxKind.CallExpression).getFirstDescendantByKind(SyntaxKind.CallExpression);
    // add isolatedContext Bool Param
    if (jsHandleDispatcherEvaluateExpressionCall && jsHandleDispatcherEvaluateExpressionCall.getExpression().getText().includes("this._object.evaluateExpression")) {
      // Add the new argument to the function call
      jsHandleDispatcherEvaluateExpressionCall.addArgument("params.isolatedContext");
    }

    // -- evaluateExpressionHandle Method --
    const jsHandleDispatcherEvaluateExpressionHandleMethod = jsHandleDispatcherClass.getMethod("evaluateExpressionHandle");
    const jsHandleDispatcherEvaluateExpressionHandleCall = jsHandleDispatcherEvaluateExpressionHandleMethod.getFirstDescendantByKind(SyntaxKind.CallExpression);
    // add isolatedContext Bool Param
    if (jsHandleDispatcherEvaluateExpressionHandleCall && jsHandleDispatcherEvaluateExpressionHandleCall.getExpression().getText().includes("this._object.evaluateExpression")) {
      // Add the new argument to the function call
      jsHandleDispatcherEvaluateExpressionHandleCall.addArgument("params.isolatedContext");
    }
}