import { SyntaxKind } from "ts-morph";

export function patchSnapshotterInjected(project) {
  const sourceFile = project.addSourceFileAtPath(
    "packages/playwright-core/src/server/trace/recorder/snapshotterInjected.ts"
  );

  const func = sourceFile.getFunction("frameSnapshotStreamer");
  const streamerClass = func.getDescendantsOfKind(SyntaxKind.ClassDeclaration)
    .find(c => c.getName() === "Streamer");

  // 2a. Remove CSS monkey-patches from constructor
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

  // 2b. Remove _staleStyleSheets and _readingStyleSheet properties
  streamerClass.getProperty("_staleStyleSheets").remove();
  streamerClass.getProperty("_readingStyleSheet").remove();

  // 2c. Remove helper methods
  streamerClass.getMethod("_interceptNativeMethod").remove();
  streamerClass.getMethod("_interceptNativeAsyncMethod").remove();
  streamerClass.getMethod("_interceptNativeGetter").remove();
  streamerClass.getMethod("_invalidateStyleSheet").remove();

  // 2d. Simplify _updateStyleElementStyleSheetTextIfNeeded — always re-read
  streamerClass.getMethod("_updateStyleElementStyleSheetTextIfNeeded").setBodyText(
    "const data = ensureCachedData(sheet);\n" +
    "try {\n" +
    "  data.cssText = this._getSheetText(sheet);\n" +
    "} catch (e) {\n" +
    "  data.cssText = '';\n" +
    "}\n" +
    "return data.cssText;"
  );

  // 2e. Simplify _updateLinkStyleSheetTextIfNeeded — always compare fresh
  streamerClass.getMethod("_updateLinkStyleSheetTextIfNeeded").setBodyText(
    "const data = ensureCachedData(sheet);\n" +
    "try {\n" +
    "  const currentText = this._getSheetText(sheet);\n" +
    "  if (currentText === data.cssText)\n" +
    "    return data.cssRef === undefined ? undefined : snapshotNumber - data.cssRef;\n" +
    "  data.cssText = currentText;\n" +
    "  data.cssRef = snapshotNumber;\n" +
    "  return data.cssText;\n" +
    "} catch (e) {\n" +
    "  return undefined;\n" +
    "}"
  );

  // 2f. Simplify _getSheetText — remove _readingStyleSheet guard
  streamerClass.getMethod("_getSheetText").setBodyText(
    "const rules: string[] = [];\n" +
    "for (const rule of sheet.cssRules)\n" +
    "  rules.push(rule.cssText);\n" +
    "return rules.join('\\n');"
  );

  // 2g. captureSnapshot() — iterate document.styleSheets instead of this._staleStyleSheets
  const captureMethod = streamerClass.getMethod("captureSnapshot");
  const forOfStmt = captureMethod.getStatements()
    .find(s => s.getText().includes("this._staleStyleSheets"));
  if (forOfStmt) {
    forOfStmt.replaceWithText(
      forOfStmt.getText().replace("this._staleStyleSheets", "document.styleSheets")
    );
  }

  // 2h. reset() — remove this._staleStyleSheets.clear()
  const resetMethod = streamerClass.getMethod("reset");
  const clearStmt = resetMethod.getStatements()
    .find(s => s.getText().includes("this._staleStyleSheets.clear()"));
  if (clearStmt) clearStmt.remove();
}
