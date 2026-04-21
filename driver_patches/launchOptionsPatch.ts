import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ---------------------------------
// server/types.ts — LaunchOptions
// ---------------------------------
export function patchLaunchOptions(project: Project) {
	const typesSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/types.ts");

	// Find the LaunchOptions type alias
	const launchOptionsDecl = typesSourceFile.getTypeAliasOrThrow("LaunchOptions");
	const intersectionType = launchOptionsDecl.getTypeNodeOrThrow().asKindOrThrow(SyntaxKind.IntersectionType);

	// The second member is the object literal { cdpPort?, ... }; Omit<> is a TypeReference, not TypeLiteral
	const objectType = assertDefined(
		intersectionType
			.getTypeNodes()
			.find(t => t.getKind() === SyntaxKind.TypeLiteral)
	).asKindOrThrow(SyntaxKind.TypeLiteral);

	// Add disablePopupBlocking?: boolean
	objectType.addProperty({
		name: "disablePopupBlocking",
		type: "boolean",
		hasQuestionToken: true,
	});
}
