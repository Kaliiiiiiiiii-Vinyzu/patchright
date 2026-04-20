import { type Project, SyntaxKind } from "ts-morph";

// -----------------------------
// server/chromium/crCoverage.ts
// -----------------------------
export function patchCRCoverage(project: Project) {
	// Add source file to the project
	const crCoverageSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crCoverage.ts");

	// ------- JSCoverage Class -------
	// ------- CSSCoverage Class -------
	for (const coverageClassName of ["JSCoverage", "CSSCoverage"]) {
		const coverageClass = crCoverageSourceFile.getClassOrThrow(coverageClassName);

		// -- start Method --
		const startMethod = coverageClass.getMethodOrThrow("start");
		// Inject a 'Page.frameNavigated' listener after the existing 'Runtime.executionContextsCleared' listener
		const executionContextsCleared = "eventsHelper.addEventListener(this._client, 'Runtime.executionContextsCleared', this._onExecutionContextsCleared.bind(this)),";
		const frameNavigated = "eventsHelper.addEventListener(this._client, 'Page.frameNavigated', this._onFrameNavigated.bind(this)),";
		startMethod
			.getBodyOrThrow()
			.asKindOrThrow(SyntaxKind.Block)
			.getStatements()
			.forEach((statement) => {
				const text = statement.getText();
				if (text.includes(executionContextsCleared) && !text.includes(frameNavigated))
					statement.replaceWithText(text.replace(executionContextsCleared, `
						${executionContextsCleared}
						${frameNavigated}
					`));
			});

		// -- _onFrameNavigated Method --
		if (!coverageClass.getMethod("_onFrameNavigated")) {
		  coverageClass.addMethod({
		  	name: "_onFrameNavigated",
		  	parameters: [{ name: "event", type: "Protocol.Page.frameNavigatedPayload" }],
				statements: ["if (event.frame.parentId) return;", "this._onExecutionContextsCleared();"],
		  });
		} 
	}
}
