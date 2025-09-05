import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/chromium/crDevTools.ts
// ----------------------------
export function patchCRDevTools(project) {
    // Add source file to the project
    const crDevToolsSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crDevTools.ts");

    // ------- CRDevTools Class -------
    const crDevToolsClass = crDevToolsSourceFile.getClass("CRDevTools");

    // -- Install Method --
    const installMethod = crDevToolsClass.getMethod("install");
    // Find the specific `Promise.all` call
    const promiseAllCalls = installMethod
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((call) => call.getExpression().getText() === "Promise.all");
    // Removing Runtime.enable from the Promise.all call
    promiseAllCalls.forEach((call) => {
      const arrayLiteral = call.getFirstDescendantByKind(
        SyntaxKind.ArrayLiteralExpression,
      );
      if (arrayLiteral) {
        arrayLiteral.getElements().forEach((element) => {
          if (element.getText().includes("session.send('Runtime.enable'")) {
            arrayLiteral.removeElement(element);
          }
        });
      }
    });
}