import { type Project, SyntaxKind } from "ts-morph";

// ------------------------
// server/registry/index.ts
// ------------------------
export function patchServerRegistryIndex(project: Project) {
	// Add source file to the project
	const serverRegistryIndexSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/registry/index.ts");

	// ------- buildPlaywrightCLICommand Function -------
	const buildPlaywrightCLICommandFunction = serverRegistryIndexSourceFile.getFunctionOrThrow("buildPlaywrightCLICommand");

	const buildPlaywrightReturnStatement = buildPlaywrightCLICommandFunction
		.getFirstDescendantByKindOrThrow(SyntaxKind.SwitchStatement)
		.getFirstDescendantByKindOrThrow(SyntaxKind.DefaultClause)
		.getFirstDescendantByKindOrThrow(SyntaxKind.ReturnStatement)

	// Replace Playwright with Patchright in the Build CLI Command
	buildPlaywrightReturnStatement
		.replaceWithText(
			buildPlaywrightReturnStatement.getText().replace("playwright", "patchright")
		)
}
