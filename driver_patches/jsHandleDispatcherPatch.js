import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/dispatchers/jsHandleDispatcher.ts
// ----------------------------
export function patchJSHandleDispatcher(project) {
    // Add source file to the project
    const jsHandleDispatcherSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/dispatchers/jsHandleDispatcher.ts");

    // ------- workerDispatcher Class -------
    const jsHandleDispatcherClass = jsHandleDispatcherSourceFile.getClass("JSHandleDispatcher");

    const patchCall = (methodName, calleeText) => {
      const method = jsHandleDispatcherClass.getMethod(methodName);
      if (!method)
        return;

      const targetCalls = method
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter(call => call.getExpression().getText() === calleeText);

      for (const call of targetCalls) {
        const args = call.getArguments().map(a => a.getText());
        if (!args.includes("params.isolatedContext"))
          call.addArgument("params.isolatedContext");
      }
    };

    patchCall("evaluateExpression", "this._object.evaluateExpression");
    patchCall("evaluateExpressionHandle", "this._object.evaluateExpressionHandle");
}