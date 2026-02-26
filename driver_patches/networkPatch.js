import { SyntaxKind } from "ts-morph";

// ----------------------------
// client/network.ts
// ----------------------------
export function patchNetwork(project) {
  const sourceFile = project.addSourceFileAtPath(
    "packages/playwright-core/src/client/network.ts"
  );

  const requestClass = sourceFile.getClass("Request");
  const allHeadersMethod = requestClass.getMethod("allHeaders");
  allHeadersMethod.setBodyText(`
    const headers = await this._actualHeaders();
    const page = this._safePage();
    if (page?._closeWasCalled)
      throw new TargetClosedError();
    return headers.headers();
  `);

  const targetClosedImport = sourceFile.getImportDeclaration(
    (decl) => decl.getModuleSpecifierValue() === "./errors"
  );
  if (targetClosedImport && !targetClosedImport.getNamedImports().some(i => i.getName() === "TargetClosedError")) {
    targetClosedImport.addNamedImport("TargetClosedError");
  }
}
