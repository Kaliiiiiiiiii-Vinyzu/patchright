import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/registry/index.ts
// ----------------------------
export function patchRecorder(project) {
  const sourceFile = project.addSourceFileAtPath("packages/recorder/src/recorder.tsx");

  // ------- Recorder Const -------
  const recorderDecl = sourceFile.getVariableDeclarationOrThrow("Recorder");
  // Get the arrow function assigned to Recorder
  const recorderFn = recorderDecl.getInitializerIfKindOrThrow(SyntaxKind.ArrowFunction);
  const recorderBody = recorderFn.getBody();

  // Add try-catch block around the existing React.useEffect body
  const useEffectCall = recorderBody.getDescendantsOfKind(SyntaxKind.CallExpression).find(call => call.getExpression().getText() === "React.useEffect");
  const effectCallback = useEffectCall.getArguments()[0];
  effectCallback.setBodyText(`try { window.dispatch({ event: 'setAutoExpect', params: { autoExpect } }); } catch {}`);

}
