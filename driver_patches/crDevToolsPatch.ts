import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// -----------------------------
// server/chromium/crDevTools.ts
// -----------------------------
export function patchCRDevTools(project: Project) {
	// Add source file to the project
	const crDevToolsSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crDevTools.ts");

	// ------- CRDevTools Class -------
	const crDevToolsClass = crDevToolsSourceFile.getClassOrThrow("CRDevTools");

	// -- Install Method --
	const installMethod = crDevToolsClass.getMethodOrThrow("install");
	// Find the specific `Promise.all` call
	const promiseAllCalls = installMethod
		.getDescendantsOfKind(SyntaxKind.CallExpression)
		.filter((call) => call.getExpression().getText() === "Promise.all");
	// Removing Runtime.enable from the Promise.all call
	promiseAllCalls.forEach((call) => {
		const arrayLiteral = assertDefined(call.getFirstDescendantByKind(SyntaxKind.ArrayLiteralExpression));
		arrayLiteral
			.getElements()
			.filter((element) => element.getText().includes("session.send('Runtime.enable'"))
			.forEach((element) => { arrayLiteral.removeElement(element); });
	});
}