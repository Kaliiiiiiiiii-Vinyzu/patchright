import type { Project } from "ts-morph";

// ----------------------------
// server/chromium/crBrowser.ts
// ----------------------------
export function patchCRBrowser(project: Project) {
	// Add source file to the project
	const crBrowserSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crBrowser.ts");

	// ------- CRDevTools Class -------
	const crBrowserContextClass = crBrowserSourceFile.getClassOrThrow("CRBrowserContext");

	// -- doRemoveInitScripts Method --
	const doRemoveInitScriptsMethod = crBrowserContextClass.getMethodOrThrow("doRemoveInitScripts");
	doRemoveInitScriptsMethod.setBodyText(`
		for (const page of this.pages())
			await (page.delegate as CRPage).removeInitScripts();
	`);

	// -- doExposeBinding Method --
	crBrowserContextClass.addMethod({
		name: "doExposeBinding",
		isAsync: true,
		parameters: [{ name: "binding", type: "PageBinding" }],
	});
	const doExposeBindingMethod = crBrowserContextClass.getMethodOrThrow("doExposeBinding");
	doExposeBindingMethod.setBodyText(`
		for (const page of this.pages())
			await (page.delegate as CRPage).exposeBinding(binding);
	`);

	// -- doRemoveExposedBindings Method --
	crBrowserContextClass.addMethod({
		name: "doRemoveExposedBindings",
		isAsync: true,
	});
	const doRemoveExposedBindingsMethod = crBrowserContextClass.getMethodOrThrow("doRemoveExposedBindings");
	doRemoveExposedBindingsMethod.setBodyText(`
		for (const page of this.pages())
			await (page.delegate as CRPage).removeExposedBindings();
	`);
}