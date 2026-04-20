import type { Project } from "ts-morph";

// -------------------
// server/launchApp.ts
// -------------------
export function patchLaunchApp(project: Project) {
	// Add source file to the project
	const launchAppSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/launchApp.ts");
	
	// ------- syncLocalStorageWithSettings Function -------
	const syncLocalStorageWithSettings = launchAppSourceFile.getFunctionOrThrow("syncLocalStorageWithSettings");
	// Add a type check before calling _saveSerializedSettings to prevent runtime errors when the function is not defined
	syncLocalStorageWithSettings.replaceWithText(
		syncLocalStorageWithSettings.getText().replace(
			`(window as any)._saveSerializedSettings(JSON.stringify({ ...localStorage }));`,
			`if (typeof (window as any)._saveSerializedSettings === 'function')
				(window as any)._saveSerializedSettings(JSON.stringify({ ...localStorage }));`,
		)
	);
}
