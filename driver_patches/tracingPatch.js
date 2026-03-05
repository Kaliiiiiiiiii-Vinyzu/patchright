import { SyntaxKind } from "ts-morph";

// ----------------------------
// server/trace/recorder/tracing.ts
// ----------------------------
export function patchTracing(project) {
  const sourceFile = project.addSourceFileAtPath(
    "packages/playwright-core/src/server/trace/recorder/tracing.ts"
  );

  // We want to ignore Patchright-Internal Route.continue Calls in the Tracing
  const funcNamesToPatch = ["createBeforeActionTraceEvent", "createInputActionTraceEvent", "createActionLogTraceEvent", "createAfterActionTraceEvent"];
  for (const funcName of funcNamesToPatch) {
    const func = sourceFile.getFunction(funcName);
    const body = func.getBody();
    body.insertStatements(0, `// Filter out internal fallback Route.continue calls from Patchright's inject routing\nif (metadata.type === 'Route' && metadata.method === 'continue' && metadata.params?.isFallback)\n  return null;`);
  }
}
