import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// -----------------------
// server/screenshotter.ts
// -----------------------
export function patchScreenshotter(project: Project) {
	// Add source file to the project
	const screenshotterSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/screenshotter.ts");

	// ------- Screenshotter Class -------
	const screenshotterClass = screenshotterSourceFile.getClassOrThrow("Screenshotter");

	// -- _preparePageForScreenshot Method --
	const prepareMethod = screenshotterClass.getMethodOrThrow("_preparePageForScreenshot");
	// Insert utility context initialization before the safeNonStallingEvaluateInAllFrames call
	const safeEvalStatement = assertDefined(
		prepareMethod
			.getDescendantsOfKind(SyntaxKind.ExpressionStatement)
			.find((s) => s.getText().includes("safeNonStallingEvaluateInAllFrames") && s.getText().includes("inPagePrepareForScreenshots"))
	);
	safeEvalStatement
		.getParentIfKindOrThrow(SyntaxKind.Block)
		.insertStatements(safeEvalStatement.getChildIndex(), `
			await Promise.all(this._page.frames().map(async (f: any) => {
				try { await f._utilityContext(); } catch {}
			}));
		`);
	
}
