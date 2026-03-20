import { type Project, SyntaxKind } from "ts-morph";

// --------------------------------
// server/trace/recorder/tracing.ts
// --------------------------------
export function patchTracing(project: Project) {
	// Add source file to the project
	const tracingSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/trace/recorder/tracing.ts");

	// ------- createBeforeActionTraceEvent Function -------
	// ------- createInputActionTraceEvent Function -------
	// ------- createActionLogTraceEvent Function -------
	// ------- createAfterActionTraceEvent Function -------
	const eventFunctionNamesToPatch = ["createBeforeActionTraceEvent", "createInputActionTraceEvent", "createActionLogTraceEvent", "createAfterActionTraceEvent"];
	for (const eventFunctionName of eventFunctionNamesToPatch) {
		const eventFunction = tracingSourceFile.getFunctionOrThrow(eventFunctionName);
		// We want to ignore Patchright-Internal Route.continue Calls in the Tracing
		eventFunction
			.getBodyOrThrow()
			.asKindOrThrow(SyntaxKind.Block)
			.insertStatements(0, `
				// Filter out internal fallback Route.continue calls from Patchright's inject routing
				if (metadata.type === 'Route' && metadata.method === 'continue' && metadata.params?.isFallback)
					return null;
			`);
	}
}
