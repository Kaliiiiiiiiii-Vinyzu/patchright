import { SyntaxKind } from "ts-morph";

export function patchNetwork(project) {
  const sourceFile = project.addSourceFileAtPath(
    "packages/playwright-core/src/server/network.ts",
  );

  // ------- Route Class -------
  const routeClass = sourceFile.getClass("Route");

  // -- continue Method --
  // patchright: clear internal URL override so Response.url() reports the original URL
  const continueMethod = routeClass.getMethod("continue");
  const continueBody = continueMethod.getBody();
  const statements = continueBody.getStatements();

  // Find the statement: overrides = this._request._applyOverrides(overrides);
  const applyOverridesStatement = statements.find(s =>
    s.getText().includes("this._request._applyOverrides(overrides)")
  );

  if (applyOverridesStatement) {
    const index = applyOverridesStatement.getChildIndex();
    continueBody.insertStatements(index + 1, `
    // patchright: clear internal URL override so Response.url() reports the original URL
    if (overrides.url === 'http://patchright-init-script-inject.internal/' || overrides.url === 'https://patchright-init-script-inject.internal/')
      this._request._applyOverrides({ url: undefined });
    `);
  }

  sourceFile.saveSync();
}