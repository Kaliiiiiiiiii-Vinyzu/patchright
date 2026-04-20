import { type Project, SyntaxKind } from 'ts-morph';
import { assertDefined } from './utils.ts';

// ---------------------------
// server/utils/expectUtils.ts
// ---------------------------
export function patchExpectUtils(project: Project) {
	// Add source file to the project
	const expectUtilsSourceFile = project.addSourceFileAtPath('packages/playwright-core/src/server/utils/expectUtils.ts');

	// ------- formatMatcherMessage Function -------
	const formatMatcherMessageFunction = expectUtilsSourceFile.getFunctionOrThrow('formatMatcherMessage');
	const formatMatcherMessageAlignDecl = assertDefined(
		formatMatcherMessageFunction
			.getDescendantsOfKind(SyntaxKind.VariableDeclaration)
			.find(d => d.getName() === 'align')
	);
	formatMatcherMessageAlignDecl.setInitializer(
		"!details.errorMessage && details.printedExpected?.startsWith('Expected:') && (!details.printedReceived || details.printedReceived.startsWith('Received:'))"
	);
}
