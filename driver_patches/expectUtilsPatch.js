import { SyntaxKind } from 'ts-morph';

// ----------------------------
// server/utils/expectUtils.ts
// ----------------------------
export function patchExpectUtils(project) {
  // Add source file to the project
  const sourceFile = project.addSourceFileAtPath('packages/playwright-core/src/server/utils/expectUtils.ts');
  // ------- formatMatcherMessage Function -------
  const formatFn = sourceFile.getFunctionOrThrow('formatMatcherMessage');
  const alignDecl = formatFn
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .find(d => d.getName() === 'align');
  alignDecl.setInitializer(
    "!details.errorMessage && details.printedExpected?.startsWith('Expected:') && (!details.printedReceived || details.printedReceived.startsWith('Received:'))"
  );
}
