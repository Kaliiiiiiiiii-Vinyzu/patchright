import { type Project, SyntaxKind } from "ts-morph";

// --------------------
// utils/build/build.js
// --------------------
export function patchBuild(project: Project) {
	const buildSourceFile = project.addSourceFileAtPath("utils/build/build.js");
	const bundleAssertion = buildSourceFile.getFunctionOrThrow("assertCoreBundleHasNoNodeModules");
	const markerSearch = bundleAssertion
		.getDescendantsOfKind(SyntaxKind.VariableDeclaration)
		.find(declaration => declaration.getName() === "idx")
		?.getInitializerOrThrow();
	if (!markerSearch) throw new Error("Could not find the coreBundle node_modules marker check");
	markerSearch.replaceWithText("lines[i].search(/(?:require|import)\\s*\\(\\s*['\"][^'\"]*node_modules\\//)");
	buildSourceFile.replaceWithText(
		buildSourceFile
			.getFullText()
			.replace("coreBundle.js contains 'node_modules/' references", "coreBundle.js contains runtime node_modules paths")
			.replace("coreBundle.js: no node_modules/ references", "coreBundle.js: no runtime node_modules paths"),
	);
}
