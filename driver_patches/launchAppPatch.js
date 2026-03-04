// ----------------------------
// server/launchApp.ts
// ----------------------------
export function patchLaunchApp(project) {
  const launchAppSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/launchApp.ts");
  // ------- syncLocalStorageWithSettings Function -------
  const syncLocalStorageWithSettings = launchAppSourceFile.getFunctionOrThrow("syncLocalStorageWithSettings");

  const functionText = syncLocalStorageWithSettings.getText();
  syncLocalStorageWithSettings.replaceWithText(
    functionText.replace(
      "'_saveSerializedSettings'",
      "'__pw_saveSerializedSettings'",
    ).replace(
      "(window as any)._saveSerializedSettings(JSON.stringify({ ...localStorage }));",
      "(window as any).__pw_saveSerializedSettings(JSON.stringify({ ...localStorage }));",
    ).replace(
      "Object.entries(settings).map(([k, v]) => localStorage[k] = v);",
      "Object.entries(settings).map(([k, v]) => localStorage[k] = v);\n          if (typeof (window as any).__pw_saveSerializedSettings === 'function')\n            (window as any)._saveSerializedSettings = (window as any).__pw_saveSerializedSettings;",
    ),
  );
}
