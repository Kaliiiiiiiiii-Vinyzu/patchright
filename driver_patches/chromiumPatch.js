import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/chromium/chromium.ts
// ----------------------------
export function patchChromium(project) {
    // Add source file to the project
    const chromiumSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/chromium.ts");

    // ------- Chromium Class -------
    const chromiumClass = chromiumSourceFile.getClass("Chromium");

    // -- _innerDefaultArgs Method --
    const innerDefaultArgsMethod = chromiumClass.getMethod("_innerDefaultArgs");
    // Get all the if statements in the method
    const innerDefaultArgsMethodStatements = innerDefaultArgsMethod.getDescendantsOfKind(SyntaxKind.IfStatement);
    // Modifying the Code to always use the --headless=new flag
    innerDefaultArgsMethodStatements.forEach((ifStatement) => {
      const condition = ifStatement.getExpression().getText();
      if (condition.includes("process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_NEW")) {
        ifStatement.replaceWithText("chromeArguments.push('--headless=new');");
      }
    });

    const unsafeSwiftshaderArgsStatements = innerDefaultArgsMethod
      .getDescendantsOfKind(SyntaxKind.ExpressionStatement)
      .filter((statement) => {
        const text = statement.getText();
        return text.includes("chromeArguments.push('--enable-unsafe-swiftshader')")
          || text.includes('chromeArguments.push("--enable-unsafe-swiftshader")');
      });

    unsafeSwiftshaderArgsStatements.forEach((statement) => statement.remove());

    
}