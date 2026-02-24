// ----------------------------
// server/chromium/crCoverage.ts
// ----------------------------
export function patchCRCoverage(project) {
    // Add source file to the project
    const crCoverageSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crCoverage.ts");

    const patchStartMethod = (coverageClass) => {
      const startMethod = coverageClass.getMethod("start");
      startMethod.getBody().getStatements().forEach((statement) => {
        const text = statement.getText();
        if (text.includes("'Runtime.executionContextsCleared', this._onExecutionContextsCleared.bind(this))") &&
            !text.includes("'Page.frameNavigated', this._onFrameNavigated.bind(this))")) {
          statement.replaceWithText(
            text.replace(
              "eventsHelper.addEventListener(this._client, 'Runtime.executionContextsCleared', this._onExecutionContextsCleared.bind(this)),",
              "eventsHelper.addEventListener(this._client, 'Runtime.executionContextsCleared', this._onExecutionContextsCleared.bind(this)),\n      eventsHelper.addEventListener(this._client, 'Page.frameNavigated', this._onFrameNavigated.bind(this)),"
            )
          );
        }
      });
    };

    const ensureFrameNavigatedMethod = (coverageClass, clearMethodName) => {
      if (coverageClass.getMethod("_onFrameNavigated"))
        return;
      coverageClass.addMethod({
        name: "_onFrameNavigated",
        parameters: [{ name: "event", type: "Protocol.Page.frameNavigatedPayload" }],
        statements: [
          "if (event.frame.parentId)",
          "  return;",
          `this.${clearMethodName}();`,
        ],
      });
    };

    const jsCoverageClass = crCoverageSourceFile.getClass("JSCoverage");
    patchStartMethod(jsCoverageClass);
    ensureFrameNavigatedMethod(jsCoverageClass, "_onExecutionContextsCleared");

    const cssCoverageClass = crCoverageSourceFile.getClass("CSSCoverage");
    patchStartMethod(cssCoverageClass);
    ensureFrameNavigatedMethod(cssCoverageClass, "_onExecutionContextsCleared");
}
