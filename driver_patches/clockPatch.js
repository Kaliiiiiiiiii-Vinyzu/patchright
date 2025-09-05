import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/clock.ts
// ----------------------------
export function patchClock(project) {
    // Add source file to the project
    const clockSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/clock.ts");

    // ------- Page Class -------
    const clockClass = clockSourceFile.getClass("Clock");

    // -- _evaluateInFrames Method --
    const evaluateInFramesMethod = clockClass.getMethod("_evaluateInFrames");
    // Modify the constructor's body to include Custom Code
    const evaluateInFramesMethodBody = evaluateInFramesMethod.getBody();
    evaluateInFramesMethodBody.insertStatements(0, `
      // Dont ask me why this works
      await Promise.all(this._browserContext.pages().map(async page => {
        await Promise.all(page.frames().map(async frame => {
          try {
            await frame.evaluateExpression("");
          } catch (e) {}
        }));
      }));
    `);
}