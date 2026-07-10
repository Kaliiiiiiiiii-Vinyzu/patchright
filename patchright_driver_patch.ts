import fs from "node:fs/promises";
import { IndentationText, Project } from "ts-morph";
import YAML from "yaml";

import * as patches from "./driver_patches/index.ts";
import * as clientPatches from "./patchright-nodejs/index.ts";
import { formatFiles } from "./utils/format-indentation.ts";

const project = new Project({
	manipulationSettings: {
		indentationText: IndentationText.TwoSpaces,
	},
});

// ------------------------
// client/browserContext.ts
// ------------------------
clientPatches.patchBrowserContext(project);

// ----------------------
// client/clientHelper.ts
// ----------------------
clientPatches.patchClientHelper(project);

// ---------------
// client/clock.ts
// ---------------
clientPatches.patchClock(project);

// ---------------
// client/frame.ts
// ---------------
clientPatches.patchFrame(project);

// ------------------
// client/jsHandle.ts
// ------------------
clientPatches.patchJsHandle(project);

// -----------------
// client/locator.ts
// -----------------
clientPatches.patchLocator(project);

// -----------------
// client/network.ts
// -----------------
clientPatches.patchNetwork(project);

// --------------
// client/page.ts
// --------------
clientPatches.patchPage(project);

// ----------------------
// client/tracing.ts
// ----------------------
clientPatches.patchTracing(project);

// ----------------
// client/worker.ts
// ----------------
clientPatches.patchWorker(project);

// ------------------------
// server/browserContext.ts
// ------------------------
patches.patchBrowserContext(project);

// ---------------------------
// server/chromium/chromium.ts
// ---------------------------
patches.patchChromium(project);

// -----------------------------------
// server/chromium/chromiumSwitches.ts
// -----------------------------------
patches.patchChromiumSwitches(project);

// ----------------------------
// server/chromium/crBrowser.ts
// ----------------------------
patches.patchCRBrowser(project);

// -----------------------------
// server/chromium/crDevTools.ts
// -----------------------------
patches.patchCRDevTools(project);

// -----------------------------------
// server/chromium/crNetworkManager.ts
// -----------------------------------
patches.patchCRNetworkManager(project);

// -----------------------------
// server/chromium/crCoverage.ts
// -----------------------------
patches.patchCRCoverage(project);

// ----------------------------------
// server/chromium/crServiceWorker.ts
// ----------------------------------
patches.patchCRServiceWorker(project);

// ---------------------
// server/credentials.ts
// ---------------------
patches.patchCredentials(project);

// ----------------
// server/frames.ts
// ----------------
patches.patchFrames(project);

// -------------------------
// server/frameSelectors.ts
// -------------------------
patches.patchFrameSelectors(project);

// -------------------------
// server/chromium/crPage.ts
// -------------------------
patches.patchCRPage(project);

// --------------
// server/page.ts
// --------------
patches.patchPage(project);

// ---------------------------------------------
// utils/isomorphic/utilityScriptSerializers.ts
// --------------------------------------------
patches.patchUtilityScriptSerializers(project);

// ---------------------
// server/pageBinding.ts
// ---------------------
patches.patchPageBinding(project);

// ---------------
// server/clock.ts
// --------------
patches.patchClock(project);

// ----------------------
// Patchright CLI Aliases
// ----------------------
patches.patchCliAlias(project);

// --------------------
// server/javascript.ts
// --------------------
patches.patchJavascript(project);

// -------------------
// server/launchApp.ts
// -------------------
patches.patchLaunchApp(project);

// -------------------------------------
// server/dispatchers/frameDispatcher.ts
// -------------------------------------
patches.patchFrameDispatcher(project);

// ----------------------------------------------
// server/dispatchers/browserContextDispatcher.ts
// ----------------------------------------------
patches.patchBrowserContextDispatcher(project);

// -----------------
// server/network.ts
// -----------------
patches.patchNetwork(project);

// ---------------------------------------------
// server/dispatchers/networkDispatchers.ts
// ---------------------------------------------
patches.patchNetworkDispatchers(project);

// ----------------------------------------
// server/dispatchers/jsHandleDispatcher.ts
// ----------------------------------------
patches.patchJSHandleDispatcher(project);

// ------------------------------------
// server/dispatchers/pageDispatcher.ts
// ------------------------------------
patches.patchPageDispatcher(project);

// -----------------------------------
// injected/src/xpathSelectorEngine.ts
// -----------------------------------
patches.patchXPathSelectorEngine(project);

// -------------------------
// recorder/src/recorder.tsx
// -------------------------
patches.patchRecorder(project);

// -----------------------
// server/screenshotter.ts
// -----------------------
patches.patchScreenshotter(project);

// ------------------------------------
// server/trace/recorder/snapshotter.ts
// ------------------------------------
patches.patchSnapshotter(project);

// --------------------------------------------
// server/trace/recorder/snapshotterInjected.ts
// --------------------------------------------
patches.patchSnapshotterInjected(project);

// --------------------------------
// server/trace/recorder/tracing.ts
// --------------------------------
patches.patchTracing(project);

// ----------------------
// protocol/spec/*.yml
// ----------------------
async function mutateYaml(path: string, callback: (document: any) => void) {
	const document = YAML.parse(await fs.readFile(path, "utf8"));
	callback(document);
	await fs.writeFile(path, YAML.stringify(document));
}

await mutateYaml("packages/protocol/spec/frame.yml", protocol => {
	protocol.Frame.commands.evaluateExpression.parameters.isolatedContext = "boolean?";
	protocol.Frame.commands.evaluateExpressionHandle.parameters.isolatedContext = "boolean?";
	protocol.Frame.commands.evalOnSelectorAll.parameters.isolatedContext = "boolean?";
});
await mutateYaml("packages/protocol/spec/handles.yml", protocol => {
	protocol.JSHandle.commands.evaluateExpression.parameters.isolatedContext = "boolean?";
	protocol.JSHandle.commands.evaluateExpressionHandle.parameters.isolatedContext = "boolean?";
});
await mutateYaml("packages/protocol/spec/worker.yml", protocol => {
	protocol.Worker.commands.evaluateExpression.parameters.isolatedContext = "boolean?";
	protocol.Worker.commands.evaluateExpressionHandle.parameters.isolatedContext = "boolean?";
});
await mutateYaml("packages/protocol/spec/mixins.yml", protocol => {
	protocol.ContextOptions.properties.focusControl = "boolean?";
});
await mutateYaml("packages/protocol/spec/network.yml", protocol => {
	protocol.Route.commands.continue.parameters.patchrightInitScript = "boolean?";
});

// Save and format all patched TypeScript sources before they are built.
await project.save();
await formatFiles(
	project.getSourceFiles().map(sourceFile => sourceFile.getFilePath()),
	{
		arrowParens: "avoid",
		printWidth: 120,
		singleQuote: true,
		tabWidth: 2,
		useTabs: false,
	},
);
