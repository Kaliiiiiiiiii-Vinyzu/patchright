import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ---------------
// server/clock.ts
// ---------------
export function patchClock(project: Project) {
	// Add source file to the project
	const clockSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/clock.ts");

	// ------- Page Class -------
	const clockClass = clockSourceFile.getClassOrThrow("Clock");

	// -- _installIfNeeded Method --
	const installIfNeededMethod = clockClass.getMethodOrThrow("_installIfNeeded");
	const installIfNeededGuard = assertDefined(
		installIfNeededMethod
			.getBodyOrThrow()
			.asKindOrThrow(SyntaxKind.Block)
			.getStatements()
			.find((statement) => statement.getKind() === SyntaxKind.IfStatement && statement.getText().includes("this._initScripts.length"))
	);
	installIfNeededGuard.replaceWithText(`
		if (this._initScripts.length) {
			const initScriptSources = JSON.stringify(this._initScripts.map((initScript) => initScript.source));
			await this._evaluateInFrames(\`(() => {
				if (globalThis.__pwClock?.controller)
					return;
				for (const source of \${initScriptSources})
					(0, eval)(source);
			})();\`);
			return;
		}
	`);

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