import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// --------------------------------------------
// server/trace/recorder/snapshotterInjected.ts
// --------------------------------------------
export function patchSnapshotterInjected(project: Project) {
	// Add source file to the project
	const snapshotterInjectedSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/trace/recorder/snapshotterInjected.ts");

	// ------- frameSnapshotStreamer Function -------
	const frameSnapshotStreamerFunction = snapshotterInjectedSourceFile.getFunctionOrThrow("frameSnapshotStreamer");
	// ------- Streamer Class -------
	const streamerClass = assertDefined(
		frameSnapshotStreamerFunction
			.getDescendantsOfKind(SyntaxKind.ClassDeclaration)
		  .find(c => c.getName() === "Streamer")
	);

	// Remove CSS monkey-patches from constructor
	const CTOR_STATEMENTS_TO_REMOVE = [
		"invalidateCSSGroupingRule",
		"this._interceptNativeMethod",
		"this._interceptNativeGetter",
		"this._interceptNativeAsyncMethod",
	];
	streamerClass
		.getConstructors()[0]
		.getStatements()
		.filter(stmt => CTOR_STATEMENTS_TO_REMOVE.some(term => stmt.getText().includes(term)))
		.reverse()
		.forEach(stmt => { stmt.remove() });

	// Remove properties and methods related to CSS interception
	streamerClass.getPropertyOrThrow("_staleStyleSheets").remove();
	streamerClass.getPropertyOrThrow("_readingStyleSheet").remove();
	streamerClass.getMethodOrThrow("_interceptNativeMethod").remove();
	streamerClass.getMethodOrThrow("_interceptNativeAsyncMethod").remove();
	streamerClass.getMethodOrThrow("_interceptNativeGetter").remove();
	streamerClass.getMethodOrThrow("_invalidateStyleSheet").remove();

	// -- _updateStyleElementStyleSheetTextIfNeeded Method --
	const updateStyleElementStyleMethod = streamerClass.getMethodOrThrow("_updateStyleElementStyleSheetTextIfNeeded");
	// always re-read
	updateStyleElementStyleMethod.setBodyText(`
		const data = ensureCachedData(sheet);
		try {
			data.cssText = this._getSheetText(sheet);
		} catch (e) {
			data.cssText = '';
		}
		return data.cssText;
	`);

	// -- _updateLinkStyleSheetTextIfNeeded Method --
	const updateLinkStyleMethod = streamerClass.getMethodOrThrow("_updateLinkStyleSheetTextIfNeeded");
	// always compare fresh
	updateLinkStyleMethod.setBodyText(`
		const data = ensureCachedData(sheet);
		try {
			const currentText = this._getSheetText(sheet);
			if (data.cssText === undefined) {
				data.cssText = currentText;
				return undefined;
			}
			if (currentText === data.cssText)
				return data.cssRef === undefined ? undefined : snapshotNumber - data.cssRef;
			data.cssText = currentText;
			data.cssRef = snapshotNumber;
			return data.cssText;
		} catch (e) {
			return undefined;
		}
	`);

	// -- _getSheetText Method --
	const getSheetTextMethod = streamerClass.getMethodOrThrow("_getSheetText");
	// direct read without _readingStyleSheet guard
	getSheetTextMethod.setBodyText(`
		const rules: string[] = [];
		for (const rule of sheet.cssRules)
			rules.push(rule.cssText);
		return rules.join('\\n');
	`);

	// -- captureSnapshot Method --
	const captureMethod = streamerClass.getMethodOrThrow("captureSnapshot");
	// iterate document.styleSheets instead of _modifiedStyleSheets
	const forOfStatement = assertDefined(
			captureMethod
			.getStatements()
			.find(s => s.getText().includes("this._modifiedStyleSheets"))
	);
	forOfStatement.replaceWithText(forOfStatement.getText().replace("this._modifiedStyleSheets", "document.styleSheets"));

	// -- reset Method --
	const resetMethod = streamerClass.getMethodOrThrow("reset");
	// remove _staleStyleSheets.clear()
	const staleStylesheetsClearStatement = assertDefined(
		resetMethod
			.getStatements()
			.find(s => s.getText().includes("this._staleStyleSheets.clear();"))
	);
	staleStylesheetsClearStatement.remove();
}