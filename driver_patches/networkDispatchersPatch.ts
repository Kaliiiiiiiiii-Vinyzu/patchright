import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ----------------------------------------
// server/dispatchers/networkDispatchers.ts
// ----------------------------------------
export function patchNetworkDispatchers(project: Project) {
	// Add source file to the project
	const networkDispatchersSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/dispatchers/networkDispatchers.ts");

	// ------- RouteDispatcher Class -------
	const routeDispatcherClass = networkDispatchersSourceFile.getClassOrThrow("RouteDispatcher");

	// -- continue Method --
	const continueMethod = routeDispatcherClass.getMethodOrThrow("continue");
	const continueCall = assertDefined(
		continueMethod.getFirstDescendant(node =>
			node.isKind(SyntaxKind.CallExpression) &&
			node.getExpression().getText() === "this._object.continue"
		)
	).asKindOrThrow(SyntaxKind.CallExpression);
	const continueOptions = continueCall.getArguments()[0].asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
	if (!continueOptions.getProperty("patchrightInitScript")) {
		continueOptions.addPropertyAssignment({
			name: "patchrightInitScript",
			initializer: "(params as any).patchrightInitScript",
		});
	}
}
