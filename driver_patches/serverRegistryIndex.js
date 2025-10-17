import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/registry/index.ts
// ----------------------------
export function patchServerRegistryIndex(project) {
  const sourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/registry/index.ts");

  const fn = sourceFile.getFunctionOrThrow("buildPlaywrightCLICommand");

  const switchStmt = fn.getFirstDescendantByKindOrThrow(SyntaxKind.SwitchStatement);

  const defaultClause = switchStmt.getFirstDescendantByKindOrThrow(SyntaxKind.DefaultClause);

  const returnStmt = defaultClause.getFirstDescendantByKindOrThrow(SyntaxKind.ReturnStatement);

  const oldText = returnStmt.getText();
  const newText = oldText.replace("playwright", "patchright");
  returnStmt.replaceWithText(newText);
}
