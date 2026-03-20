import { type Project, SyntaxKind } from "ts-morph";

// ---------------
// server/clock.ts
// ---------------
export function patchClock(project: Project) {
	// Add source file to the project
	const clockSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/clock.ts");

	// ------- Page Class -------
	const clockClass = clockSourceFile.getClassOrThrow("Clock");

	// -- _evaluateInFrames Method --
	const evaluateInFramesMethod = clockClass.getMethodOrThrow("_evaluateInFrames");
	// Modify the constructor's body to include Custom Code
	evaluateInFramesMethod
		.getBodyOrThrow()
		.asKindOrThrow(SyntaxKind.Block)
		.insertStatements(0, `
			// Dont ask me why this works
			const frames = this._browserContext.pages().flatMap((page) => page.frames());
			await Promise.all(frames.map(async (frame) => {
				try {
					await frame.evaluateExpression("");
				} catch {}
			}));
		`);
}