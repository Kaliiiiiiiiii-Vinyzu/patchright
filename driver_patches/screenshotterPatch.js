import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/screenshotter.ts
// ----------------------------
export function patchScreenshotter(project) {
    // Add source file to the project
    const screenshotterSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/screenshotter.ts");

    // ------- Screenshotter Class -------
    const screenshotterClass = screenshotterSourceFile.getClass("Screenshotter");

    // -- _preparePageForScreenshot Method --
    const prepareMethod = screenshotterClass.getMethod("_preparePageForScreenshot");
    const prepareMethodBody = prepareMethod.getBody();
    // Insert utility context initialization before the safeNonStallingEvaluateInAllFrames call
    const safeEvalStatement = prepareMethod
      .getDescendantsOfKind(SyntaxKind.ExpressionStatement)
      .find((stmt) => stmt.getText().includes("safeNonStallingEvaluateInAllFrames") && stmt.getText().includes("inPagePrepareForScreenshots"));
    if (safeEvalStatement) {
      const block = safeEvalStatement.getParentIfKindOrThrow(SyntaxKind.Block);
      block.insertStatements(safeEvalStatement.getChildIndex(), `
        await Promise.all(this._page.frames().map(async (f: any) => {
          try { await f._utilityContext(); } catch {}
        }));
      `);
    }
}
