import { SyntaxKind } from "ts-morph";

export function patchSnapshotterInjected(project) {
  const sourceFile = project.addSourceFileAtPath(
    "packages/playwright-core/src/server/trace/recorder/snapshotterInjected.ts"
  );

  const func = sourceFile.getFunction("frameSnapshotStreamer");
  const streamerClass = func.getDescendantsOfKind(SyntaxKind.ClassDeclaration)
    .find(c => c.getName() === "Streamer");

  // Remove CSS monkey-patches from constructor
  const ctor = streamerClass.getConstructors()[0];
  const ctorStmtsToRemove = ctor.getStatements().filter(stmt => {
    const text = stmt.getText();
    return text.includes("invalidateCSSGroupingRule") ||
      text.includes("this._interceptNativeMethod") ||
      text.includes("this._interceptNativeGetter") ||
      text.includes("this._interceptNativeAsyncMethod");
  });
  for (let i = ctorStmtsToRemove.length - 1; i >= 0; i--)
    ctorStmtsToRemove[i].remove();

  // Remove properties and methods related to CSS interception
  streamerClass.getProperty("_staleStyleSheets").remove();
  streamerClass.getProperty("_readingStyleSheet").remove();
  streamerClass.getMethod("_interceptNativeMethod").remove();
  streamerClass.getMethod("_interceptNativeAsyncMethod").remove();
  streamerClass.getMethod("_interceptNativeGetter").remove();
  streamerClass.getMethod("_invalidateStyleSheet").remove();

  // -- _updateStyleElementStyleSheetTextIfNeeded Method -- always re-read
  streamerClass.getMethod("_updateStyleElementStyleSheetTextIfNeeded").setBodyText(`
    const data = ensureCachedData(sheet);
    try {
      data.cssText = this._getSheetText(sheet);
    } catch (e) {
      data.cssText = '';
    }
    return data.cssText;
  `);

  // -- _updateLinkStyleSheetTextIfNeeded Method -- always compare fresh
  streamerClass.getMethod("_updateLinkStyleSheetTextIfNeeded").setBodyText(`
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

  // -- _getSheetText Method -- direct read without _readingStyleSheet guard
  streamerClass.getMethod("_getSheetText").setBodyText(`
    const rules: string[] = [];
    for (const rule of sheet.cssRules)
      rules.push(rule.cssText);
    return rules.join('\\n');
  `);

  // -- captureSnapshot Method -- iterate document.styleSheets instead of _staleStyleSheets
  const captureMethod = streamerClass.getMethod("captureSnapshot");
  const forOfStmt = captureMethod.getStatements()
    .find(s => s.getText().includes("this._staleStyleSheets"));
  if (forOfStmt) {
    forOfStmt.replaceWithText(
      forOfStmt.getText().replace("this._staleStyleSheets", "document.styleSheets")
    );
  }

  // -- reset Method -- remove _staleStyleSheets.clear()
  const resetMethod = streamerClass.getMethod("reset");
  const clearStmt = resetMethod.getStatements()
    .find(s => s.getText().includes("this._staleStyleSheets.clear()"));
  if (clearStmt) clearStmt.remove();
}
