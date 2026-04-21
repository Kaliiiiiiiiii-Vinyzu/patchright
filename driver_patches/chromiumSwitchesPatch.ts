import { type Project, SyntaxKind } from "ts-morph";

// -----------------------------------
// server/chromium/chromiumSwitches.ts
// -----------------------------------
export function patchChromiumSwitches(project: Project) {
	// Add source file to the project
	const chromiumSwitchesSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/chromiumSwitches.ts");

	// -- chromiumSwitches Array Variable --
	const chromiumSwitchesArrow = chromiumSwitchesSourceFile
		.getVariableDeclarationOrThrow("chromiumSwitches")
		.getInitializerIfKindOrThrow(SyntaxKind.ArrowFunction);

	// Add disablePopupBlocking parameter to the arrow function
	chromiumSwitchesArrow.addParameter({ name: "disablePopupBlocking", type: "boolean", hasQuestionToken: true });

	const chromiumSwitchesArray = chromiumSwitchesArrow
		.getBody()
		.getFirstDescendantByKindOrThrow(SyntaxKind.ArrayLiteralExpression);

	// Patchright defined switches to disable
	const switchesToDisable = [
		"assistantMode ? '' : '--enable-automation'",
		// '--disable-popup-blocking' intentionally NOT removed here — handled conditionally below
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
	chromiumSwitchesArray
		.getElements()
		.filter((element) => switchesToDisable.includes(element.getText()))
		.forEach((element) => { chromiumSwitchesArray.removeElement(element); });

	// Replace '--disable-popup-blocking' with a conditional: only include when explicitly requested
	const popupBlockingElement = chromiumSwitchesArray
		.getElements()
		.find((element) => element.getText() === "'--disable-popup-blocking'");
	if (!popupBlockingElement)
		throw new Error("Expected '--disable-popup-blocking' element not found in chromiumSwitches array");
	popupBlockingElement.replaceWithText("disablePopupBlocking ? '--disable-popup-blocking' : ''");

	// Add custom switches to the array
	chromiumSwitchesArray.addElement(`'--disable-blink-features=AutomationControlled'`);
}
