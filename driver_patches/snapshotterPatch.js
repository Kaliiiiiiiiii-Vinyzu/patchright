import { SyntaxKind } from "ts-morph";

export function patchSnapshotter(project) {
  const sourceFile = project.addSourceFileAtPath(
    "packages/playwright-core/src/server/trace/recorder/snapshotter.ts"
  );
  const snapshotterClass = sourceFile.getClass("Snapshotter");

  // Replace _initScript type, add _initScriptSource, remove InitScript import
  snapshotterClass.getProperty("_initScript").setType("boolean | undefined");
  snapshotterClass.addProperty({
    name: "_initScriptSource",
    type: "string | undefined",
  });
  const initScriptImport = sourceFile.getImportDeclarations()
    .find(imp => imp.getNamedImports().some(n => n.getName() === "InitScript"));
  if (initScriptImport) initScriptImport.remove();

  // -- reset Method -- switch from 'main' to 'utility' world
  const resetMethod = snapshotterClass.getMethod("reset");
  const resetMainLiteral = resetMethod.getDescendantsOfKind(SyntaxKind.StringLiteral)
    .find(s => s.getLiteralText() === "main");
  if (resetMainLiteral) resetMainLiteral.replaceWithText("'utility'");

  // -- _initialize Method -- store source directly instead of addInitScript, use utility world
  snapshotterClass.getMethod("_initialize").setBodyText(`
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

  // -- resetForReuse Method -- clean up without removeInitScripts
  snapshotterClass.getMethod("resetForReuse").setBodyText(`
    if (this._initScript) {
      eventsHelper.removeEventListeners(this._eventListeners);
      this._initScript = undefined;
      this._initScriptSource = undefined;
    }
  `);

  // -- _captureFrameSnapshot Method -- use nonStallingEvaluateInExistingContext in utility world
  const captureFrameMethod = snapshotterClass.getMethod("_captureFrameSnapshot");
  const evalCall = captureFrameMethod.getDescendantsOfKind(SyntaxKind.CallExpression)
    .find(c => c.getText().includes("nonStallingRawEvaluateInExistingMainContext"));
  if (evalCall) evalCall.replaceWithText("frame.nonStallingEvaluateInExistingContext(expression, 'utility')");

  // -- _onPage Method -- re-inject streamer script on navigation
  snapshotterClass.getMethod("_onPage").getBody().addStatements(
    "this._eventListeners.push(eventsHelper.addEventListener(page, Page.Events.InternalFrameNavigatedToNewDocument, (frame: Frame) => this._onFrameNavigated(frame)));"
  );

  // -- _onFrameNavigated Method (new) -- re-inject streamer after navigation
  snapshotterClass.addMethod({
    name: "_onFrameNavigated",
    isAsync: true,
    parameters: [{ name: "frame", type: "Frame" }],
  });
  snapshotterClass.getMethod("_onFrameNavigated").setBodyText(`
    if (!this._initScriptSource)
      return;
    try {
      await frame.nonStallingEvaluateInExistingContext(this._initScriptSource, 'utility');
    } catch (e) {}
  `);

  // -- _annotateFrameHierarchy Method -- use utility context instead of main
  const annotateMethod = snapshotterClass.getMethod("_annotateFrameHierarchy");
  const mainContextId = annotateMethod.getDescendantsOfKind(SyntaxKind.Identifier)
    .find(id => id.getText() === "_mainContext");
  if (mainContextId) mainContextId.replaceWithText("_utilityContext");
}