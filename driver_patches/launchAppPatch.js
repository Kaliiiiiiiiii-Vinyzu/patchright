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
      "(window as any)._saveSerializedSettings(JSON.stringify({ ...localStorage }));",
      "if (typeof (window as any)._saveSerializedSettings === 'function')\n            (window as any)._saveSerializedSettings(JSON.stringify({ ...localStorage }));",
    )
  );
}
