import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/chromium/chromiumSwitches.ts
// ----------------------------
export function patchChromiumSwitches(project) {
    // Add source file to the project
    const chromiumSwitchesSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/chromiumSwitches.ts");

    // -- chromiumSwitches Array Variable --
    const chromiumSwitchesArray = chromiumSwitchesSourceFile
      .getVariableDeclarationOrThrow("chromiumSwitches")
      .getInitializerIfKindOrThrow(SyntaxKind.ArrowFunction)
      .getBody()
      .getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)[0];
    // Patchright defined switches to disable
    const switchesToDisable = [
        "assistantMode ? '' : '--enable-automation'",
        "'--disable-popup-blocking'",
        "'--disable-component-update'",
        "'--disable-default-apps'",
        "'--disable-extensions'",
        "'--disable-client-side-phishing-detection'",
        "'--disable-component-extensions-with-background-pages'",
        "'--allow-pre-commit-input'",
        "'--disable-ipc-flooding-protection'",
        "'--metrics-recording-only'",
        "'--unsafely-disable-devtools-self-xss-warnings'",
        "'--disable-back-forward-cache'",
        "'--disable-features=ImprovedCookieControls,LazyFrameLoading,GlobalMediaControls,DestroyProfileOnBrowserClose,MediaRouter,DialMediaRouteProvider,AcceptCHFrame,AutoExpandDetailsElement,CertificateTransparencyComponentUpdater,AvoidUnnecessaryBeforeUnloadCheckSync,Translate,HttpsUpgrades,PaintHolding,ThirdPartyStoragePartitioning,LensOverlay,PlzDedicatedWorker'"
    ];
    chromiumSwitchesArray.getElements().forEach((element) => {
      if (switchesToDisable.includes(element.getText())) {
        chromiumSwitchesArray.removeElement(element);
      }
    });
    // Add custom switches to the array
    chromiumSwitchesArray.addElement(
      `'--disable-blink-features=AutomationControlled'`,
    );
}