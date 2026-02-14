import { SyntaxKind } from "ts-morph";

export function patchSnapshotter(project) {
  const sourceFile = project.addSourceFileAtPath(
    "packages/playwright-core/src/server/trace/recorder/snapshotter.ts"
  );
  const snapshotterClass = sourceFile.getClass("Snapshotter");

  // 1a. Change _initScript type from InitScript to boolean, add _initScriptSource, remove InitScript import
  snapshotterClass.getProperty("_initScript").setType("boolean | undefined");
  snapshotterClass.addProperty({
    name: "_initScriptSource",
    type: "string | undefined",
  });
  const initScriptImport = sourceFile.getImportDeclarations()
    .find(imp => imp.getNamedImports().some(n => n.getName() === "InitScript"));
  if (initScriptImport) initScriptImport.remove();

  // 1b. reset() — change 'main' to 'utility'
  const resetMethod = snapshotterClass.getMethod("reset");
  const resetMainLiteral = resetMethod.getDescendantsOfKind(SyntaxKind.StringLiteral)
    .find(s => s.getLiteralText() === "main");
  if (resetMainLiteral) resetMainLiteral.replaceWithText("'utility'");

  // 1c. Rewrite _initialize() — remove addInitScript, store source, use utility world
  snapshotterClass.getMethod("_initialize").setBodyText(
    "const { javaScriptEnabled } = this._context._options;\n" +
    "this._initScriptSource = `(${frameSnapshotStreamer})(\"${this._snapshotStreamer}\", ${javaScriptEnabled || javaScriptEnabled === undefined})`;\n" +
    "this._initScript = true;\n" +
    "for (const page of this._context.pages())\n" +
    "  this._onPage(page);\n" +
    "this._eventListeners = [\n" +
    "  eventsHelper.addEventListener(this._context, BrowserContext.Events.Page, this._onPage.bind(this)),\n" +
    "];\n" +
    "await this._context.safeNonStallingEvaluateInAllFrames(this._initScriptSource, 'utility');"
  );

  // 1d. Rewrite resetForReuse() — remove removeInitScripts call
  snapshotterClass.getMethod("resetForReuse").setBodyText(
    "if (this._initScript) {\n" +
    "  eventsHelper.removeEventListeners(this._eventListeners);\n" +
    "  this._initScript = undefined;\n" +
    "  this._initScriptSource = undefined;\n" +
    "}"
  );

  // 1e. _captureFrameSnapshot() — switch evaluation method + world
  const captureFrameMethod = snapshotterClass.getMethod("_captureFrameSnapshot");
  const evalCall = captureFrameMethod.getDescendantsOfKind(SyntaxKind.CallExpression)
    .find(c => c.getText().includes("nonStallingRawEvaluateInExistingMainContext"));
  if (evalCall) evalCall.replaceWithText("frame.nonStallingEvaluateInExistingContext(expression, 'utility')");

  // 1f. _onPage() — add InternalFrameNavigatedToNewDocument listener
  snapshotterClass.getMethod("_onPage").getBody().addStatements(
    "this._eventListeners.push(eventsHelper.addEventListener(page, Page.Events.InternalFrameNavigatedToNewDocument, (frame: Frame) => this._onFrameNavigated(frame)));"
  );

  // 1g. Add _onFrameNavigated() method
  snapshotterClass.addMethod({
    name: "_onFrameNavigated",
    isAsync: true,
    parameters: [{ name: "frame", type: "Frame" }],
  });
  snapshotterClass.getMethod("_onFrameNavigated").setBodyText(
    "if (!this._initScriptSource)\n" +
    "  return;\n" +
    "try {\n" +
    "  await frame.nonStallingEvaluateInExistingContext(this._initScriptSource, 'utility');\n" +
    "} catch (e) {\n" +
    "}"
  );

  // 1h. _annotateFrameHierarchy() — use utility context
  const annotateMethod = snapshotterClass.getMethod("_annotateFrameHierarchy");
  const mainContextId = annotateMethod.getDescendantsOfKind(SyntaxKind.Identifier)
    .find(id => id.getText() === "_mainContext");
  if (mainContextId) mainContextId.replaceWithText("_utilityContext");
}
