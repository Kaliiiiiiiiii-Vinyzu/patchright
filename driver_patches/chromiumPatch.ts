import { type Project, SyntaxKind } from "ts-morph";

// ---------------------------
// server/chromium/chromium.ts
// ---------------------------
export function patchChromium(project: Project) {
	// Add source file to the project
	const chromiumSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/chromium.ts");

	// ------- Chromium Class -------
	const chromiumClass = chromiumSourceFile.getClassOrThrow("Chromium");

	// -- _innerDefaultArgs Method --
	const innerDefaultArgsMethod = chromiumClass.getMethodOrThrow("_innerDefaultArgs");
	// Get all the if statements in the method and modify to always use the --headless=new flag
	innerDefaultArgsMethod.getDescendantsOfKind(SyntaxKind.IfStatement).forEach((ifStatement) => {
		if (ifStatement.getExpression().getText().includes("process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_NEW"))
			ifStatement.replaceWithText("chromeArguments.push('--headless=new');");
	});

	// Remove --enable-unsafe-swiftshader switches from innerDefaultArgs
	innerDefaultArgsMethod
		.getDescendantsOfKind(SyntaxKind.ExpressionStatement)
		.filter((statement) => {
			return statement.getText().includes("chromeArguments.push('--enable-unsafe-swiftshader')") || statement.getText().includes('chromeArguments.push("--enable-unsafe-swiftshader")');
		})
		.forEach((statement) => { statement.remove(); });
}
