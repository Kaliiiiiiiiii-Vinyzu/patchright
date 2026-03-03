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
    // Find the call to this._object.evaluateExpression within the method body
    const jsHandleDispatcherEvaluateExpressionCall = jsHandleDispatcherEvaluateExpressionMethod
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find(call => call.getExpression().getText().includes("this._object.evaluateExpression"));
    // add isolatedContext Bool Param
    if (jsHandleDispatcherEvaluateExpressionCall) {
      // Add the new argument to the function call
      jsHandleDispatcherEvaluateExpressionCall.addArgument("params.isolatedContext");
    }

    // -- evaluateExpressionHandle Method --
    const jsHandleDispatcherEvaluateExpressionHandleMethod = jsHandleDispatcherClass.getMethod("evaluateExpressionHandle");
    // Find the call to this._object.evaluateExpressionHandle within the method body
    const jsHandleDispatcherEvaluateExpressionHandleCall = jsHandleDispatcherEvaluateExpressionHandleMethod
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find(call => call.getExpression().getText().includes("this._object.evaluateExpressionHandle"));
    // add isolatedContext Bool Param
    if (jsHandleDispatcherEvaluateExpressionHandleCall) {
      // Add the new argument to the function call
      jsHandleDispatcherEvaluateExpressionHandleCall.addArgument("params.isolatedContext");
    }
}