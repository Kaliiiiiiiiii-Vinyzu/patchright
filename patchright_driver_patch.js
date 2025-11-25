import fs from "node:fs/promises";
import path from "path";
import { Project, SyntaxKind, IndentationText, ObjectLiteralExpression } from "ts-morph";
import YAML from "yaml";

import * as patches from "./driver_patches/index.js";

const project = new Project({
  manipulationSettings: {
    indentationText: IndentationText.TwoSpaces,
  },
});

// ----------------------------
// server/browserContext.ts
// ----------------------------
patches.patchBrowserContext(project);

// ----------------------------
// server/chromium/chromium.ts
// ----------------------------
patches.patchChromium(project);

// ----------------------------
// server/chromium/chromiumSwitches.ts
// ----------------------------
patches.patchChromiumSwitches(project);

// ----------------------------
// server/chromium/crBrowser.ts
// ----------------------------
patches.patchCRBrowser(project);

// ----------------------------
// server/chromium/crDevTools.ts
// ----------------------------
patches.patchCRDevTools(project);

// ----------------------------
// server/chromium/crNetworkManager.ts
// ----------------------------
patches.patchCRNetworkManager(project);

// ----------------------------
// server/chromium/crServiceWorker.ts
// ----------------------------
patches.patchCRServiceWorker(project);

// ----------------------------
// server/frames.ts
// ----------------------------
patches.patchFrames(project);

// ----------------------------
// server/frameSelectors.ts
// ----------------------------
patches.patchFrameSelectors(project);

// ----------------------------
// server/chromium/crPage.ts
// ----------------------------
patches.patchCRPage(project);

// ----------------------------
// server/page.ts
// ----------------------------
patches.patchPage(project);

// ----------------------------
// utils/isomorphic/utilityScriptSerializers.ts
// ----------------------------
patches.patchUtilityScriptSerializers(project);

// ----------------------------
// server/pageBinding.ts
// ----------------------------
patches.patchPageBinding(project);
// ----------------------------
// server/clock.ts
// ----------------------------
patches.patchClock(project);

// ----------------------------
// server/javascript.ts
// ----------------------------
patches.patchJavascript(project);

// ----------------------------
// server/dispatchers/frameDispatcher.ts
// ----------------------------
patches.patchFrameDispatcher(project);

// ----------------------------
// server/dispatchers/jsHandleDispatcher.ts
// ----------------------------
patches.patchJSHandleDispatcher(project);

// ----------------------------
// server/dispatchers/pageDispatcher.ts
// ----------------------------
patches.patchPageDispatcher(project);

// ----------------------------
// injected/src/xpathSelectorEngine.ts
// ----------------------------
patches.patchXPathSelectorEngine(project);

// ----------------------------
// server/registry/index.ts
// ----------------------------
patches.patchServerRegistryIndex(project);

// ----------------------------
// recorder/src/recorder.tsx
// ----------------------------
patches.patchRecorder(project);

// Save the changes without reformatting
project.saveSync();

// ----------------------------
// protocol/protocol.yml
// ----------------------------
// isolatedContext parameters
const protocol = YAML.parse(await fs.readFile("packages/protocol/src/protocol.yml", "utf8"));
for (const type of ["Frame", "JSHandle", "Worker"]) {
  const commands = protocol[type].commands;
  commands.evaluateExpression.parameters.isolatedContext = "boolean?";
  commands.evaluateExpressionHandle.parameters.isolatedContext = "boolean?";
}
protocol["Frame"].commands.evalOnSelectorAll.parameters.isolatedContext = "boolean?";
// focusControl parameter
protocol["ContextOptions"].properties.focusControl = "boolean?";

await fs.writeFile("packages/protocol/src/protocol.yml", YAML.stringify(protocol));
