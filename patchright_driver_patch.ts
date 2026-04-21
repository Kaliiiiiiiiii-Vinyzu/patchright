import fs from "node:fs/promises";
import { IndentationText, Project } from "ts-morph";
import YAML from "yaml";

import * as patches from "./driver_patches/index.ts";
import * as clientPatches from "./patchright-nodejs/index.ts";

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

// ------------------------------------
// server/chromium/chromium.ts (call site)
// ------------------------------------
patches.patchChromiumLaunchArgs(project);

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

// ---------------------------
// server/utils/expectUtils.ts
// ---------------------------
patches.patchExpectUtils(project);

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

// --------------------
// server/launchOptions.ts
// --------------------
patches.patchLaunchOptions(project);

// -------------------------------------
// server/dispatchers/frameDispatcher.ts
// -------------------------------------
patches.patchFrameDispatcher(project);

// ----------------------------------------------
// server/dispatchers/browserContextDispatcher.ts
// ----------------------------------------------
patches.patchBrowserContextDispatcher(project);

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

// -------------------------
// protocol/protocol.yml
// -------------------------
const protocol = YAML.parse(await fs.readFile("packages/protocol/src/protocol.yml", "utf8"));

// isolatedContext parameters
for (const type of ["Frame", "JSHandle", "Worker"]) {
	const commands = protocol[type].commands;
	commands.evaluateExpression.parameters.isolatedContext = "boolean?";
	commands.evaluateExpressionHandle.parameters.isolatedContext = "boolean?";
}
protocol.Frame.commands.evalOnSelectorAll.parameters.isolatedContext = "boolean?";

// focusControl parameter
protocol.ContextOptions.properties.focusControl = "boolean?";

// Internal init-script route marker
protocol.Route.commands.continue.parameters.patchrightInitScript = "boolean?";

await fs.writeFile("packages/protocol/src/protocol.yml", YAML.stringify(protocol));

// Save the changes without reformatting
await project.save();
