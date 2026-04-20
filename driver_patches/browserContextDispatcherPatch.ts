import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ----------------------------------------------
// server/dispatchers/browserContextDispatcher.ts
// ----------------------------------------------
export function patchBrowserContextDispatcher(project: Project) {
	// Add source file to the project
	const contextDispatcherSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/dispatchers/browserContextDispatcher.ts");

	// ------- BrowserContextDispatcher Class -------
	const contextDispatcherClass = contextDispatcherSourceFile.getClassOrThrow("BrowserContextDispatcher");

	// -- constructor --
	const contextDispatcherConstructor = assertDefined(contextDispatcherClass.getConstructors()[0]);
	// Replace the dialog handler assignment to dispatch dialog events with DialogDispatcher wrapper
	const dialogHandlerAssignment = assertDefined(
		contextDispatcherConstructor
			.getBodyOrThrow()
			.getDescendantsOfKind(SyntaxKind.ExpressionStatement)
			.find((stmt) => stmt.getText().startsWith("this._dialogHandler =")),
	);
	dialogHandlerAssignment.replaceWithText(`
		this._dialogHandler = dialog => {
			this._dispatchEvent('dialog', { dialog: new DialogDispatcher(this, dialog) });
			return true;
		};
	`);
}
