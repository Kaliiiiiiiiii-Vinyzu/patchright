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
    sourceFile.getFunction(funcName);
    const body = func.getBody();
    body.insertStatements(0, `// Filter out Route.continue calls - they are internal routing operations\nif (metadata.type === 'Route' && metadata.method === 'continue')\n  return null;`);
  }
}
