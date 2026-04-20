import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ----------------------------------
// server/chromium/crServiceWorker.ts
// ----------------------------------
export function patchCRServiceWorker(project: Project) {
	// Add source file to the project.
	const crServiceWorkerSourceFile = project.addSourceFileAtPath('packages/playwright-core/src/server/chromium/crServiceWorker.ts');

	// ------- CRServiceWorker Class -------
	const crServiceWorkerClass = crServiceWorkerSourceFile.getClassOrThrow("CRServiceWorker");

	// -- CRServiceWorker Constructor --
	const crServiceWorkerConstructorDeclaration = assertDefined(
		crServiceWorkerClass
			.getConstructors()
			.find((ctor) => {
				const params = ctor.getParameters();
				return params[0]?.getName() === "browserContext" && params[1]?.getName() === "session" && params[2]?.getName() === "url";
			})
	);
	const crServiceWorkerConstructorBody = crServiceWorkerConstructorDeclaration.getBodyOrThrow().asKindOrThrow(SyntaxKind.Block);
		
	// Find the Runtime.enable statement to remove
	assertDefined(
		crServiceWorkerConstructorBody
			.getStatements()
			.find((s) => s.getText().includes("session.send") && s.getText().includes("Runtime.enable"))
	).remove();

	crServiceWorkerConstructorBody.addStatements(`
		session._sendMayFail("Runtime.evaluate", {
			expression: "globalThis",
			serializationOptions: { serialization: "idOnly" }
		}).then(globalThis => {
			if (globalThis && globalThis.result) {
				var globalThisObjId = globalThis.result.objectId;
				var executionContextId = parseInt(globalThisObjId.split(".")[1], 10);
				this.createExecutionContext(new CRExecutionContext(session, { id: executionContextId }));
			}
		});
	`);
}