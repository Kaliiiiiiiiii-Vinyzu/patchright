import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// -------------------------
// recorder/src/recorder.tsx
// -------------------------
export function patchRecorder(project: Project) {
	// Add source file to the project
	const recorderSourceFile = project.addSourceFileAtPath("packages/recorder/src/recorder.tsx");

	// ------- Recorder Const -------
	const recorderDecl = recorderSourceFile.getVariableDeclarationOrThrow("Recorder");
	// Get the arrow function assigned to Recorder
	const recorderFn = recorderDecl.getInitializerIfKindOrThrow(SyntaxKind.ArrowFunction);

	// Add try-catch block around the existing React.useEffect body
	const useEffectCall = assertDefined(
		recorderFn.getDescendantsOfKind(SyntaxKind.CallExpression).find(call => call.getExpression().getText() === "React.useEffect")
	);
	useEffectCall
		.getArguments()[0]
		.asKindOrThrow(SyntaxKind.ArrowFunction)
		.setBodyText(`try { window.dispatch({ event: 'setAutoExpect', params: { autoExpect } }); } catch {}		`);

}
