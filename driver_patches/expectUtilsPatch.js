import { SyntaxKind } from 'ts-morph';

// ----------------------------
// server/utils/expectUtils.ts
// ----------------------------
export function patchExpectUtils(project) {
  const sourceFile = project.addSourceFileAtPath('packages/playwright-core/src/server/utils/expectUtils.ts');
  const formatFn = sourceFile.getFunction('formatMatcherMessage');
  if (!formatFn)
    throw new Error('patchExpectUtils: function formatMatcherMessage not found');

  const alignDecl = formatFn
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .find(d => d.getName() === 'align');

  if (!alignDecl)
    throw new Error('patchExpectUtils: const align not found');

  alignDecl.setInitializer(
    "!details.errorMessage && details.printedExpected?.startsWith('Expected:') && (!details.printedReceived || details.printedReceived.startsWith('Received:'))"
  );
}
