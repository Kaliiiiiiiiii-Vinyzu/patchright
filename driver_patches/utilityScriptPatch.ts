import { type Project, Scope, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// -----------------------------
// injected/src/utilityScript.ts
// -----------------------------
export function patchUtilityScript(project: Project) {
	const utilityScriptSourceFile = project.addSourceFileAtPath("packages/injected/src/utilityScript.ts");
	const utilityScriptClass = utilityScriptSourceFile.getClassOrThrow("UtilityScript");
	const globalProperty = utilityScriptClass.getPropertyOrThrow("global");
	utilityScriptClass.insertProperty(utilityScriptClass.getMembers().indexOf(globalProperty) + 1, {
		name: "_functionCallbacks",
		type: "Map<string, Function>",
		initializer: "new Map()",
		scope: Scope.Private,
	});

	const evaluateMethod = utilityScriptClass.getMethodOrThrow("evaluate");
	const parseCall = assertDefined(
		evaluateMethod
			.getDescendantsOfKind(SyntaxKind.CallExpression)
			.find(call => call.getExpression().getText() === "parseEvaluationResultValue"),
	);
	parseCall.addArguments(["new Map()", "(name, callback) => this._functionCallbacks.set(name, callback)"]);

	utilityScriptClass.addMethod({
		name: "takeFunctionCallback",
		parameters: [{ name: "name", type: "string" }],
		returnType: "Function | undefined",
		statements: `
			const callback = this._functionCallbacks.get(name);
			this._functionCallbacks.delete(name);
			return callback;
		`,
	});
}
