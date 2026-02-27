import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/javascript.ts
// ----------------------------
export function patchJavascript(project) {
    // Add source file to the project
    const javascriptSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/javascript.ts");

    // -------JSHandle Class -------
    const jsHandleClass = javascriptSourceFile.getClass("JSHandle");

    // -- evaluateExpression Method --
    const jsHandleEvaluateExpressionMethod = jsHandleClass.getMethod("evaluateExpression");
    jsHandleEvaluateExpressionMethod.addParameter({
        name: "isolatedContext",
        type: "boolean",
        hasQuestionToken: true,
    });
    const jsHandleEvaluateExpressionMethodBody = jsHandleEvaluateExpressionMethod.getBody();
    jsHandleEvaluateExpressionMethodBody.replaceWithText(
        jsHandleEvaluateExpressionMethodBody.getText().replace(/this\._context/g, "context")
    );
    // Insert the new line of code after the responseAwaitStatement
    jsHandleEvaluateExpressionMethodBody.insertStatements(0,`
      let context = this._context;
      if (context.constructor.name === "FrameExecutionContext") {
          const frame = context.frame;
          if (frame) {
              if (isolatedContext === true) context = await frame._utilityContext();
              else if (isolatedContext === false) context = await frame._mainContext();
          }
      }
      if (context !== this._context && context.adoptIfNeeded(this) === null)
        context = this._context;
    `);

    // -- evaluateExpressionHandle Method --
    const jsHandleEvaluateExpressionHandleMethod = jsHandleClass.getMethod("evaluateExpressionHandle");
    jsHandleEvaluateExpressionHandleMethod.addParameter({
        name: "isolatedContext",
        type: "boolean",
        hasQuestionToken: true,
    });
    const jsHandleEvaluateExpressionHandleMethodBody = jsHandleEvaluateExpressionHandleMethod.getBody();
    jsHandleEvaluateExpressionHandleMethodBody.replaceWithText(
        jsHandleEvaluateExpressionHandleMethodBody.getText().replace(/this\._context/g, "context")
    );
    // Insert the new line of code after the responseAwaitStatement
    jsHandleEvaluateExpressionHandleMethodBody.insertStatements(0,`
      let context = this._context;
      if (context.constructor.name === "FrameExecutionContext") {
          const frame = this._context.frame;
          if (frame) {
              if (isolatedContext === true) context = await frame._utilityContext();
              else if (isolatedContext === false) context = await frame._mainContext();
          }
      }
      if (context !== this._context && context.adoptIfNeeded(this) === null)
        context = this._context;
    `);

        // ------- ExecutionContext Class -------
        // -- utilityScript Method --
        const executionContextClass = javascriptSourceFile.getClass("ExecutionContext");
        const utilityScriptMethod = executionContextClass.getMethod("utilityScript");
        const utilityScriptMethodBody = utilityScriptMethod.getBody();
        utilityScriptMethodBody.replaceWithText(
            utilityScriptMethodBody
                .getText()
                .replace(
                    "return new (module.exports.UtilityScript())(globalThis, ${isUnderTest()});",
                    "const utilityScript = new (module.exports.UtilityScript())(globalThis, ${isUnderTest()});\n        globalThis.builtins = utilityScript.builtins;\n        return utilityScript;",
                ),
        );
}