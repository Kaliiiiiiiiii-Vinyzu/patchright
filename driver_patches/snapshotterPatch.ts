import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ------------------------------------
// server/trace/recorder/snapshotter.ts
// ------------------------------------
export function patchSnapshotter(project: Project) {
	// Add source file to the project
	const snapshotterSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/trace/recorder/snapshotter.ts");
	// Remove unneeded imports
	const initScriptImport = assertDefined(
		snapshotterSourceFile
			.getImportDeclarations()
			.find(imp => imp.getNamedImports().some(n => n.getName() === "InitScript"))
	);
	initScriptImport.remove();
	
	// ------- Snapshotter Class -------
	const snapshotterClass = snapshotterSourceFile.getClassOrThrow("Snapshotter");

	// Replace _initScript type, add _initScriptSource, remove InitScript import
	snapshotterClass
		.getPropertyOrThrow("_initScript")
		.setType("boolean | undefined");
	snapshotterClass.addProperty({
		name: "_initScriptSource",
		type: "string | undefined",
	});

	// -- reset Method --
	const resetMethod = snapshotterClass.getMethodOrThrow("reset");
	// switch from 'main' to 'utility' world
	const mainWorldLiteral = assertDefined(
		resetMethod
			.getDescendantsOfKind(SyntaxKind.StringLiteral)
			.find(s => s.getLiteralText() === "main")
	);
	mainWorldLiteral.replaceWithText("'utility'");

	// -- _initialize Method --
	const initializeMethod = snapshotterClass.getMethodOrThrow("_initialize");
	// store source directly instead of addInitScript, use utility world
	initializeMethod.setBodyText(`
		const { javaScriptEnabled } = this._context._options;
		this._initScriptSource = \`(\${frameSnapshotStreamer})("\${this._snapshotStreamer}", \${javaScriptEnabled || javaScriptEnabled === undefined})\`;
		this._initScript = true;
		for (const page of this._context.pages())
			this._onPage(page);
		this._eventListeners = [
			eventsHelper.addEventListener(this._context, BrowserContext.Events.Page, this._onPage.bind(this)),
		];
		await this._context.safeNonStallingEvaluateInAllFrames(this._initScriptSource, 'utility');
	`);

	// -- resetForReuse Method --
	const resetForReuseMethod = snapshotterClass.getMethodOrThrow("resetForReuse");
	// clean up without removeInitScripts
	resetForReuseMethod.setBodyText(`
		if (this._initScript) {
			eventsHelper.removeEventListeners(this._eventListeners);
			this._initScript = undefined;
			this._initScriptSource = undefined;
		}
	`);

	// -- _captureFrameSnapshot Method --
	const captureFrameMethod = snapshotterClass.getMethodOrThrow("_captureFrameSnapshot");
	// use nonStallingEvaluateInExistingContext in utility world
	const rawEvaluateCall = assertDefined(
		captureFrameMethod
			.getDescendantsOfKind(SyntaxKind.CallExpression)
			.find(c => c.getText().includes("nonStallingRawEvaluateInExistingMainContext"))
	);
	rawEvaluateCall.replaceWithText("frame.nonStallingEvaluateInExistingContext(expression, 'utility')");

	// -- _onPage Method --
	const onPageMethod = snapshotterClass.getMethodOrThrow("_onPage");
	// re-inject streamer script on navigation
	onPageMethod.addStatements(
		"this._eventListeners.push(eventsHelper.addEventListener(page, Page.Events.InternalFrameNavigatedToNewDocument, (frame: Frame) => this._onFrameNavigated(frame)));"
	);

	// -- _onFrameNavigated Method --
	snapshotterClass.addMethod({
		name: "_onFrameNavigated",
		isAsync: true,
		parameters: [{ name: "frame", type: "Frame" }],
	});
	const onFrameNavigatedMethod = snapshotterClass.getMethodOrThrow("_onFrameNavigated");
	// re-inject streamer after navigation
	onFrameNavigatedMethod.setBodyText(`
		if (!this._initScriptSource)
			return;
		try {
			await frame.nonStallingEvaluateInExistingContext(this._initScriptSource, 'utility');
		} catch (e) {}
	`);

	// -- _annotateFrameHierarchy Method --
	const annotateMethod = snapshotterClass.getMethodOrThrow("_annotateFrameHierarchy");
	// use utility context instead of main
	const mainContextIdentifier = assertDefined(
		annotateMethod
			.getDescendantsOfKind(SyntaxKind.Identifier)
			.find(id => id.getText() === "_mainContext")
	);
	mainContextIdentifier.replaceWithText("_utilityContext");
}