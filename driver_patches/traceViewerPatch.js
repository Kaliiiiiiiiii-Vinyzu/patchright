import { SyntaxKind } from "ts-morph";

// ----------------------------
// server/trace/viewer/traceViewer.ts
// ----------------------------
export function patchTraceViewer(project) {
  const sourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/trace/viewer/traceViewer.ts");
  const openTraceViewerAppFunction = sourceFile.getFunction("openTraceViewerApp");
  const call = openTraceViewerAppFunction
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((expression) => expression.getExpression().getText().includes("launchApp("));

  if (!call)
    return;

  const objectArgument = call.getArguments()[1];
  if (!objectArgument || !objectArgument.asKind)
    return;

  const optionsObject = objectArgument.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!optionsObject)
    return;

  const persistentContextOptions = optionsObject.getProperty("persistentContextOptions");
  if (!persistentContextOptions || !persistentContextOptions.asKind)
    return;

  const persistentContextObject = persistentContextOptions
    .asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);

  if (!persistentContextObject)
    return;

  const cdpPortProperty = persistentContextObject.getProperty("cdpPort");
  if (cdpPortProperty && cdpPortProperty.asKind(SyntaxKind.PropertyAssignment)) {
    cdpPortProperty.asKind(SyntaxKind.PropertyAssignment).setInitializer("0");
  }
}
